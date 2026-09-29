import type { IncomingMessage, ServerResponse } from "node:http";
import { indexStale, readIndex, rebuildIndex, rebuildProgress } from "../library/games-index.ts";
import { dataStamp } from "../storage/changes.ts";
import { gameHtml } from "../view/game-html.ts";
import { gamesHtml } from "../view/games-html.ts";
import { imageHtml } from "../view/image-html.ts";
import type { AppContext } from "./app-context.ts";
import { gamePage } from "./game-view.ts";
import { send, sendHtml, writeRequest } from "./http-util.ts";
import { type ImageQuery, imagePage, workspaceOf } from "./image-view.ts";

/**
 * The library pages (plan-games-library 6): the image page, the games directory and the game
 * page, all global (not under /p/<id>/). Every input is checked before any storage access;
 * pictures are only ever served through the viewed project's reference-gated image route.
 */
const IMAGE = /^\/(api\/)?image\/([^/]*)$/;
const GAME = /^\/(api\/)?games\/([^/]+)$/;
const SHA = /^[0-9a-f]{64}$/;
const APP_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const CHECKS: Record<keyof ImageQuery, RegExp> = {
  project: /^[a-z0-9-]{1,60}$/,
  app: APP_ID,
  gl: /^[a-z]{2}$/,
  hl: /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/,
  pos: /^([1-9]|[1-9][0-9])$/,
};

/** The query's context fields, or null when one is malformed. */
export function imageQuery(q: URLSearchParams): ImageQuery | null {
  const out: ImageQuery = {};
  for (const k of Object.keys(CHECKS) as (keyof ImageQuery)[]) {
    const v = q.get(k);
    if (v === null || v === "") continue;
    if (!CHECKS[k].test(v)) return null;
    out[k] = v;
  }
  return out;
}

const notFound = (res: ServerResponse, api: boolean, text: string) =>
  api ? send(res, 404, { problems: [text] }) : sendPlain(res, 404, text);

function sendPlain(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

/** The saved list at once; a background update when the data changed since it was saved. */
const checkedAt = new Map<string, string>();
function gamesList(app: AppContext): unknown {
  const ws = workspaceOf(app);
  const saved = readIndex(app.storage);
  const stamp = dataStamp(ws);
  if (!rebuildProgress(ws)?.running && checkedAt.get(ws) !== stamp) {
    checkedAt.set(ws, stamp);
    if (indexStale(app.storage, saved)) void rebuildIndex(ws, app.storage, loadedOf(app), false);
  }
  return {
    games: saved?.games ?? null,
    builtAt: saved?.builtAt ?? null,
    progress: rebuildProgress(ws),
  };
}

const loadedOf = (app: AppContext) => (id: string) => {
  const f = app.load(id);
  return f && "loaded" in f ? f.loaded : null;
};

export async function libraryPagesRoute(
  app: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const p = url.pathname;
  const get = req.method === "GET";
  if (p === "/games" && get) {
    sendHtml(res, gamesHtml(app.token));
    return true;
  }
  if (p === "/api/games" && get) {
    send(res, 200, gamesList(app));
    return true;
  }
  if (p === "/api/games/rebuild" && req.method === "POST") {
    const w = await writeRequest(req, res, app.token);
    if (!w) return true;
    const ws = workspaceOf(app);
    void rebuildIndex(ws, app.storage, loadedOf(app), true);
    send(res, 202, { progress: rebuildProgress(ws) });
    return true;
  }
  const im = get ? IMAGE.exec(p) : null;
  if (im) {
    const api = !!im[1];
    const sha = im[2] ?? "";
    const q = imageQuery(url.searchParams);
    if (!SHA.test(sha) || !q) {
      if (api) send(res, 400, { problems: ["The address of this picture is not valid."] });
      else notFound(res, false, "We hold no picture with this address.");
      return true;
    }
    const data = await imagePage(app, sha, q);
    if (!data) notFound(res, api, "We hold no picture with this address.");
    else if (api) send(res, 200, data);
    else sendHtml(res, imageHtml(data, app.token));
    return true;
  }
  const gm = get ? GAME.exec(p) : null;
  if (gm) {
    const api = !!gm[1];
    const appId = decodeURIComponentSafe(gm[2] ?? "");
    const project = url.searchParams.get("project") ?? "";
    if (!APP_ID.test(appId) || (project && !CHECKS.project.test(project))) {
      if (api) send(res, 400, { problems: ["The address of this game is not valid."] });
      else notFound(res, false, "We hold no game with this address.");
      return true;
    }
    const data = await gamePage(app, appId, project);
    // The API answers only for a project that holds the game; the page says what it shows instead.
    if (!data || (api && project && data.project.id !== project))
      notFound(res, api, "We hold no game with this address.");
    else if (api) send(res, 200, data);
    else sendHtml(res, gameHtml(data, app.token));
    return true;
  }
  return false;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return "";
  }
}
