import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoadedConfig } from "../config/load.ts";
import { projectPaths } from "../config/load.ts";
import { type ProjectState, projectState } from "../projects/state.ts";
import { GALLERY_BOOT, GALLERY_BOOT_DONE, galleryRest, galleryTop } from "../view/gallery-html.ts";
import { escHtml } from "../view/shell.ts";
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
import { getLayoutBackfill, postLayoutBackfill, postLayoutBackfillStop } from "./layout-api.ts";
import { pageView, sameScreens, sameScreensRunning } from "./project-data.ts";
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
  "/api/layout-backfill": (l) => getLayoutBackfill(l),
  // Starts the same-screen check if it has not run for the current data; the page shows a note
  // while it runs and refreshes the reports after it.
  "/api/same-screens": (l, _q, a) => ({
    status: 200,
    body: { running: sameScreensRunning(a, l) },
  }),
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
  "/api/layout-backfill": (l, b) => postLayoutBackfill(l, b),
  "/api/layout-backfill/stop": (l) => postLayoutBackfillStop(l),
};

/** Derived state, with the home card's cached summary refreshed at the same time. */
export function stateFor(app: AppContext, loaded: LoadedConfig): ProjectState {
  const s = projectState(loaded, app.names);
  app.remember(projectPaths(loaded).projectId, s);
  return s;
}

/**
 * The same, kept a few seconds while the data is unchanged: opening a project asks for it three
 * times (the redirect, the page's step bar, the Reports tab) and the home card once more.
 */
export async function stateNow(app: AppContext, loaded: LoadedConfig): Promise<ProjectState> {
  const { workspace, projectId } = projectPaths(loaded);
  const s = await app.computed.get(
    workspace,
    `${projectId}:state`,
    () => projectState(loaded, app.names),
    STATE_KEEP_MS,
  );
  app.remember(projectId, s);
  return s;
}
const STATE_KEEP_MS = 5000;

/**
 * The project page: its top (bar and steps) goes out at once, the rest when the view model is
 * ready; the view model is kept while the data is unchanged, so a second visit is immediate.
 */
async function sendGallery(
  app: AppContext,
  loaded: LoadedConfig,
  res: ServerResponse,
): Promise<void> {
  const id = projectPaths(loaded).projectId;
  const s = await stateNow(app, loaded);
  const served = { name: app.names(id), apiBase: `/p/${id}/api`, steps: s.steps, stage: s.stage };
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.write(galleryTop(app.token, served) + GALLERY_BOOT);
  try {
    const vm = await pageView(app, loaded);
    res.end(GALLERY_BOOT_DONE + galleryRest(vm, served));
  } catch (e) {
    console.error(`GET /p/${id}/views/gallery.html:`, e);
    res.end(
      `<p class="warn" role="alert">The project could not be loaded: ${escHtml(e instanceof Error ? e.message : String(e))} Reload the page; if it keeps happening, restart the tool (npm start).</p></body></html>`,
    );
  }
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
    return redirect(res, landing(id, await stateNow(app, loaded)));
  }
  if (rest === "/views/gallery.html" && req.method === "GET") return sendGallery(app, loaded, res);
  if (rest === "/api/state" && req.method === "GET")
    return send(res, 200, await stateNow(app, loaded));
  if (rest === "/status" && req.method === "GET")
    return sendHtml(res, app.pages.status(id, app.names(id), stateFor(app, loaded), app.token));
  // Several reports per project (plan-reports R1).
  if (isReportsPath(rest)) return reportsRoute(app, loaded, rest, req, res);
  // PDF export (milestone R2): the print page and the export job's endpoints.
  if (await exportRoute(app, loaded, rest, req, res, url)) return;
  // "Same screen uploaded twice" (free, cached per pair): a batch plan or run waits for it; page
  // reads (the run panel's status, the report) only start it (its first run takes minutes).
  if (/^\/api\/(analysis|report)\//.test(rest)) {
    const check = sameScreens(app, loaded);
    if (req.method === "POST" && (rest === "/api/analysis/plan" || rest === "/api/analysis/run"))
      await check;
  }
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
