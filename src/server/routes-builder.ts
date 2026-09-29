import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoadedConfig } from "../config/load.ts";
import { ensurePixelChecks } from "../reports/pixel-pairs.ts";
import { setDismissed, suggestionsView } from "../reports/suggest.ts";
import type { AppContext } from "./app-context.ts";
import { send, writeRequest } from "./http-util.ts";
import { postPairVerdicts } from "./pixel-api.ts";
import {
  getBuilder,
  getMatchCheck,
  getReportPlan,
  postBuild,
  postDraft,
  postMatchVerdict,
  postPlan,
} from "./reports-builder-api.ts";
import { postReportApproval, postReportRun } from "./reports-run-api.ts";
import { stateFor } from "./routes-project.ts";

export const GONE = { problems: ["This report no longer exists. Reload the page."] };

/** Suggested next research (plan-reports 5A.6): GET, and dismiss or restore one by its id. */
async function suggestionsRoute(
  app: AppContext,
  loaded: LoadedConfig,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (rest === "/api/suggestions" && req.method === "GET")
    return send(res, 200, suggestionsView(loaded));
  const m = /^\/api\/suggestions\/(s-[0-9a-f]{12})\/(dismiss|restore)$/.exec(rest);
  if (!m || req.method !== "POST") return send(res, 404, { problems: ["Not found."] });
  if (!(await writeRequest(req, res, app.token))) return;
  if (!setDismissed(loaded, m[1] as string, m[2] === "dismiss"))
    return send(res, 404, {
      problems: ["This suggestion is not listed any more. Reload the page."],
    });
  return send(res, 200, { id: m[1], dismissed: m[2] === "dismiss" });
}

/**
 * The builder's paths (milestone R3): GET reports/builder, POST reports (draft), POST
 * reports/plan, GET reports/<id>/plan, POST reports/<id>/build, GET and POST
 * reports/match-check, POST reports/match-check/pairs (several answers at once, e.g. the pixel
 * check's "Confirm all"), and the suggestions. False when the path is none of them. Writes need
 * the page's token. Nothing here calls an AI model. The pixel check (free, cached per pair) is
 * brought up to date before any plan or match list is read.
 */
export async function builderRoute(
  app: AppContext,
  loaded: LoadedConfig,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (rest === "/api/suggestions" || rest.startsWith("/api/suggestions/")) {
    await suggestionsRoute(app, loaded, rest, req, res);
    return true;
  }
  const write = async () => (await writeRequest(req, res, app.token))?.body;
  // A failed check never blocks the page: those pairs keep the fingerprint rule.
  if (rest.startsWith("/api/reports/")) await ensurePixelChecks(loaded).catch(() => 0);
  if (rest === "/api/reports/match-check/pairs" && req.method === "POST") {
    const body = await write();
    if (body === undefined) return true;
    const r = postPairVerdicts(loaded, body);
    send(res, r.status, r.body);
    return true;
  }
  if (rest === "/api/reports/builder" && req.method === "GET") {
    const r = getBuilder(loaded);
    send(res, r.status, r.body);
    return true;
  }
  if (rest === "/api/reports/match-check" && (req.method === "GET" || req.method === "POST")) {
    if (req.method === "GET") {
      const r = getMatchCheck(loaded);
      send(res, r.status, r.body);
      return true;
    }
    const body = await write();
    if (body === undefined) return true;
    const r = postMatchVerdict(loaded, body);
    send(res, r.status, r.body);
    return true;
  }
  const post = rest === "/api/reports" ? "draft" : rest === "/api/reports/plan" ? "plan" : null;
  if (post && req.method === "POST") {
    const body = await write();
    if (body === undefined) return true;
    const r = post === "draft" ? postDraft(loaded, body) : postPlan(loaded, body);
    send(res, r.status, r.body);
    return true;
  }
  const m = /^\/api\/reports\/(r-[a-z0-9-]{1,80})\/(plan|build|approval|run)$/.exec(rest);
  if (!m) return false;
  const id = m[1] as string;
  if (m[2] === "plan" && req.method === "GET") {
    const r = getReportPlan(loaded, id);
    send(res, r ? r.status : 404, r ? r.body : GONE);
    return true;
  }
  if (m[2] === "build" && req.method === "POST") {
    if ((await write()) === undefined) return true;
    const r = await postBuild(loaded, id);
    send(res, r ? r.status : 404, r ? r.body : GONE);
    return true;
  }
  if (m[2] === "approval" && req.method === "POST") {
    if ((await write()) === undefined) return true;
    const r = postReportApproval(loaded, id);
    send(res, r ? r.status : 404, r ? r.body : GONE);
    return true;
  }
  if (m[2] === "run" && req.method === "POST") {
    const body = await write();
    if (body === undefined) return true;
    const r = postReportRun(loaded, id, body, {
      ...app.runner,
      names: app.names,
      onEnd: () => stateFor(app, loaded),
    });
    send(res, r.status, r.body);
    return true;
  }
  send(res, 405, { problems: ["Not allowed."] });
  return true;
}
