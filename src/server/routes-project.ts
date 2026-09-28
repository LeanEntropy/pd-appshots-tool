import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoadedConfig } from "../config/load.ts";
import { projectPaths } from "../config/load.ts";
import { type ProjectState, projectState } from "../projects/state.ts";
import { renderGalleryHtml } from "../steps/deck-view.ts";
import {
  type ApiResponse,
  getAnalyses,
  getAnalysisStatus,
  getExpansion,
  getOverview,
  getSelection,
  postAnalysisPlan,
  postAnalysisRun,
  postAnalysisStop,
  postExpansion,
  postOverview,
  postSelection,
} from "./api.ts";
import type { AppContext } from "./app-context.ts";
import { exportRoute } from "./export-api.ts";
import { redirect, send, sendHtml, writeRequest } from "./http-util.ts";
import { getReportCurrent, getReportRun } from "./report-api.ts";
import { isReportsPath, reportsRoute } from "./routes-reports.ts";
import { serveStatic } from "./static.ts";

type Get = (l: LoadedConfig, q: URLSearchParams, app: AppContext) => ApiResponse;
type Post = (l: LoadedConfig, body: unknown, app: AppContext) => ApiResponse | Promise<ApiResponse>;

/** The existing endpoints, unchanged in logic, now under /p/<id>/api/ (plan 6.2). */
const GETS: Record<string, Get> = {
  "/api/selection": (l) => getSelection(l),
  "/api/analysis/status": (l, _q, a) => getAnalysisStatus(l, a.names),
  "/api/job": (l, _q, a) => getAnalysisStatus(l, a.names),
  "/api/overview": (l) => getOverview(l),
  "/api/analyses": (l) => getAnalyses(l),
  "/api/report/current": (l, q) => getReportCurrent(l, q.get("stage")),
  // The report endpoint of the single-project page before this version.
  "/api/report": (l, q) => getReportCurrent(l, q.get("stage")),
  "/api/report/run": (l, q) => getReportRun(l, q.get("stage"), q.get("id")),
  "/api/expansion": (l) => getExpansion(l),
  "/api/state": (l, _q, a) => ({ status: 200, body: stateFor(a, l) }),
};

const POSTS: Record<string, Post> = {
  "/api/selection": (l, b) => postSelection(l, b),
  "/api/analysis/plan": (l, b, a) => postAnalysisPlan(l, b, a.names),
  // When the run ends, the home card's cached summary is refreshed (it holds the new report).
  "/api/analysis/run": (l, b, a) =>
    postAnalysisRun(l, b, { ...a.runner, names: a.names, onEnd: () => stateFor(a, l) }),
  "/api/analysis/stop": (l) => postAnalysisStop(l),
  "/api/overview": (l) => postOverview(l),
  "/api/expansion": (l, b) => postExpansion(l, b),
};

/** Derived state, with the home card's cached summary refreshed at the same time. */
export function stateFor(app: AppContext, loaded: LoadedConfig): ProjectState {
  const s = projectState(loaded, app.names);
  app.remember(projectPaths(loaded).projectId, s);
  return s;
}

/** Where a project opens (plan 5.2): the workspace for every stage that has a download. */
export function landing(id: string, s: ProjectState): string {
  if (s.stage === "setup" || s.stage === "preview") return `/p/${id}/status`;
  return s.next.href;
}

/** Everything under /p/<id>/ for a project that can be loaded (not a draft). */
export async function projectRoute(
  app: AppContext,
  loaded: LoadedConfig,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const id = projectPaths(loaded).projectId;
  if (rest === "/" || rest === "") {
    app.opened(id);
    return redirect(res, landing(id, stateFor(app, loaded)));
  }
  if (rest === "/views/gallery.html" && req.method === "GET") {
    const s = stateFor(app, loaded);
    return sendHtml(
      res,
      renderGalleryHtml(loaded, app.token, {
        name: app.names(id),
        apiBase: `/p/${id}/api`,
        steps: s.steps,
        stage: s.stage,
      }),
    );
  }
  if (rest === "/status" && req.method === "GET")
    return sendHtml(res, app.pages.status(id, app.names(id), stateFor(app, loaded), app.token));
  // Several reports per project (plan-reports R1).
  if (isReportsPath(rest)) return reportsRoute(app, loaded, rest, req, res);
  // PDF export (milestone R2): the print page and the export job's endpoints.
  if (await exportRoute(app, loaded, rest, req, res, url)) return;
  const get = GETS[rest];
  if (get && req.method === "GET") {
    const r = get(loaded, url.searchParams, app);
    return send(res, r.status, r.body);
  }
  const post = POSTS[rest];
  if (post && req.method === "POST") {
    const w = await writeRequest(req, res, app.token);
    if (!w) return;
    const r = await post(loaded, w.body, app);
    return send(res, r.status, r.body);
  }
  if (req.method === "GET") return serveStatic(res, projectPaths(loaded), rest);
  send(res, 404, { problems: ["Not found."] });
}
