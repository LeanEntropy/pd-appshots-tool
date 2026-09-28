import type { IncomingMessage, ServerResponse } from "node:http";
import type { LoadedConfig } from "../config/load.ts";
import type { AppContext } from "./app-context.ts";
import { send, writeRequest } from "./http-util.ts";
import { getReports, getReportVersion, patchReport, removeReport } from "./reports-api.ts";

const PATH = /^\/api\/reports(?:\/([^/]+)(?:\/versions\/([^/]+))?)?$/;

/** True for the paths this module answers (everything under /p/<id>/api/reports). */
export const isReportsPath = (rest: string) =>
  rest === "/api/reports" || rest.startsWith("/api/reports/");

/**
 * GET reports, GET reports/<id>/versions/<vid>, PATCH reports/<id> (name, archived) and
 * DELETE reports/<id> (plan-reports 8). Writes need the page's token, like every other write.
 */
export async function reportsRoute(
  app: AppContext,
  loaded: LoadedConfig,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
    const r = getReports(loaded);
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
  const r = req.method === "PATCH" ? patchReport(loaded, id, w.body) : removeReport(loaded, id);
  return send(res, r.status, r.body);
}
