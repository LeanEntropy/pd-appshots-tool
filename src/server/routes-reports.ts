import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoadedConfig } from "../config/load.ts";
import { draftsFromExpansion } from "../reports/drafts.ts";
import type { AppContext } from "./app-context.ts";
import { send, writeRequest } from "./http-util.ts";
import { reportList } from "./project-data.ts";
import { getReportVersion, patchReport, removeReport, reportsResponse } from "./reports-api.ts";
import { saveScope } from "./reports-builder-api.ts";
import { deriveNow } from "./reports-derive-api.ts";
import { builderRoute, GONE } from "./routes-builder.ts";

const PATH = /^\/api\/reports(?:\/([^/]+)(?:\/versions\/([^/]+))?)?$/;
/** POST: "Make country reports now" on a comparison. */
const DERIVE = /^\/api\/reports\/(r-[a-z0-9-]{1,80})\/derive$/;

/** True for the paths this module answers (everything under /p/<id>/api/reports, suggestions). */
export const isReportsPath = (rest: string) =>
  rest === "/api/reports" ||
  rest.startsWith("/api/reports/") ||
  rest === "/api/suggestions" ||
  rest.startsWith("/api/suggestions/");

/**
 * GET reports, GET reports/<id>/versions/<vid>, PATCH reports/<id> (name, archived, scope) and
 * DELETE reports/<id> (plan-reports 8), plus the builder's paths (routes-builder.ts). Writes need
 * the page's token, like every other write.
 */
export async function reportsRoute(
  app: AppContext,
  loaded: LoadedConfig,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (await builderRoute(app, loaded, rest, req, res)) return;
  const dm = DERIVE.exec(rest);
  if (dm?.[1]) {
    if (req.method !== "POST") return send(res, 405, { problems: ["Not allowed."] });
    if (!(await writeRequest(req, res, app.token))) return;
    const r = deriveNow(loaded, dm[1]);
    return send(res, r.status, r.body);
  }
  const m = PATH.exec(rest);
  if (!m) return send(res, 404, { problems: ["Not found."] });
  let id: string | undefined;
  let vid: string | undefined;
  try {
    id = m[1] === undefined ? undefined : decodeURIComponent(m[1]);
    vid = m[2] === undefined ? undefined : decodeURIComponent(m[2]);
  } catch {
    return send(res, 400, { problems: ["Unreadable report address."] });
  }
  if (id === undefined) {
    if (req.method !== "GET") return send(res, 405, { problems: ["Not allowed."] });
    // Drafts first (a new draft is a data change), then the list kept for the current data.
    const drafts = draftsFromExpansion(loaded);
    const r = reportsResponse(loaded, drafts, await reportList(app, loaded));
    return send(res, r.status, r.body);
  }
  if (vid !== undefined) {
    if (req.method !== "GET") return send(res, 405, { problems: ["Not allowed."] });
    const r = getReportVersion(loaded, id, vid);
    return send(res, r.status, r.body);
  }
  if (req.method !== "PATCH" && req.method !== "DELETE")
    return send(res, 405, { problems: ["Not allowed."] });
  const w = await writeRequest(req, res, app.token);
  if (!w) return;
  if (req.method === "DELETE") {
    const r = removeReport(loaded, id);
    return send(res, r.status, r.body);
  }
  // The builder's autosave sends the scope, with the name when the user typed one.
  const body = w.body && typeof w.body === "object" ? (w.body as Record<string, unknown>) : {};
  const { scope, ...other } = body;
  if (scope !== undefined) {
    const s = /^r-[a-z0-9-]{1,80}$/.test(id) ? saveScope(loaded, id, scope) : null;
    if (!s) return send(res, 404, GONE);
    if (s.status !== 200 || !Object.keys(other).length) return send(res, s.status, s.body);
  }
  const r = patchReport(loaded, id, scope === undefined ? w.body : other);
  return send(res, r.status, r.body);
}
