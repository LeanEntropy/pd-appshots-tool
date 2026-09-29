import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { readRegistry } from "../config/registry.ts";
import { appIconBytes, ensureAppIcon } from "../library/app-icon.ts";
import { readIndex } from "../library/games-index.ts";
import { projectInfos } from "../library/image-uses.ts";
import { latestDecks } from "../library/project-decks.ts";
import type { AppContext } from "./app-context.ts";
import { send, writeRequest } from "./http-util.ts";

const ICON_PATH = /^\/app-icons\/([0-9a-f]{64})\.webp$/;
const Body = z.strictObject({ projectId: z.string().regex(/^[a-z0-9-]{1,60}$/) });
const APP_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

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
  if (p === "/api/games/icon" && req.method === "POST") {
    await gameIcon(app, req, res);
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
  send(res, 200, { src: await iconOf(app, e.ourAppId) });
  return true;
}

/** Stored icon URL first (store reads note it), else the cached Google Play details. */
const iconOf = (app: AppContext, appId: string) =>
  ensureAppIcon(app.storage, appId, {
    details: (id) => app.play.details(id, "background"),
    ...(app.fetcher ? { fetcher: app.fetcher } : {}),
  });

const GameBody = z.strictObject({ appId: z.string().regex(APP_ID) });

/** True when a project holds store pages of the game (the saved list first, else the decks). */
function heldGame(app: AppContext, appId: string): boolean {
  if (readIndex(app.storage)?.games.some((g) => g.appId === appId)) return true;
  return projectInfos(app.storage).some((p) =>
    latestDecks(app.storage, p.id).some((d) => d.appId === appId),
  );
}

/**
 * POST /api/games/icon: the games directory and the game page ask for a game's icon in the
 * background (a few at a time); only games a project holds are fetched.
 */
async function gameIcon(app: AppContext, req: IncomingMessage, res: ServerResponse) {
  const w = await writeRequest(req, res, app.token);
  if (!w) return;
  const parsed = GameBody.safeParse(w.body);
  if (!parsed.success) return send(res, 400, { problems: ["The request was not clear."] });
  if (!heldGame(app, parsed.data.appId))
    return send(res, 404, { problems: ["We hold no game with this address."] });
  send(res, 200, { src: await iconOf(app, parsed.data.appId) });
}
