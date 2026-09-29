import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { readRegistry } from "../config/registry.ts";
import { appIconBytes, ensureAppIcon } from "../library/app-icon.ts";
import type { AppContext } from "./app-context.ts";
import { send, writeRequest } from "./http-util.ts";

const ICON_PATH = /^\/app-icons\/([0-9a-f]{64})\.webp$/;
const Body = z.strictObject({ projectId: z.string().regex(/^[a-z0-9-]{1,60}$/) });

/**
 * Game icons from the shared library: GET /app-icons/<sha>.webp serves a stored copy (never a
 * remote link), POST /api/app-icon downloads a project's game icon when it is missing or stale
 * (the home page asks in the background, one card at a time). Returns false for other paths.
 */
export async function appIconRoute(
  app: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  p: string,
): Promise<boolean> {
  const m = req.method === "GET" ? ICON_PATH.exec(p) : null;
  if (m) {
    const bytes = appIconBytes(app.storage, m[1] ?? "");
    if (!bytes) send(res, 404, { problems: ["Not found."] });
    else {
      res.writeHead(200, {
        "Content-Type": "image/webp",
        "Cache-Control": "max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(bytes);
    }
    return true;
  }
  if (p !== "/api/app-icon" || req.method !== "POST") return false;
  const w = await writeRequest(req, res, app.token);
  if (!w) return true;
  const parsed = Body.safeParse(w.body);
  if (!parsed.success) {
    send(res, 400, { problems: ["The request was not clear."] });
    return true;
  }
  const e = readRegistry(app.storage).projects.find((x) => x.id === parsed.data.projectId);
  if (!e) {
    send(res, 404, { problems: ["There is no such project."] });
    return true;
  }
  const src = await ensureAppIcon(app.storage, e.ourAppId, {
    details: (id) => app.play.details(id, "background"),
    ...(app.fetcher ? { fetcher: app.fetcher } : {}),
  });
  send(res, 200, { src });
  return true;
}
