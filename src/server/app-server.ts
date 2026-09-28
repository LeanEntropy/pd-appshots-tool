import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { draftState } from "../projects/state.ts";
import { homeHtml } from "../view/home-html.ts";
import { wizardHtml } from "../view/wizard-html.ts";
import type { ApiResponse } from "./api.ts";
import { type AppContext, type AppOptions, createAppContext } from "./app-context.ts";
import { redirect, send, sendHtml, writeRequest } from "./http-util.ts";
import { getImport, getJobs, getProjects, postArchive, postImport } from "./routes-home.ts";
import { getCountries, getLookup, getSearch, postProject } from "./routes-play.ts";
import { projectRoute } from "./routes-project.ts";
import { setupRoute } from "./routes-setup.ts";

const PROJECT_PATH = /^\/p\/([^/]+)(\/.*)?$/;

type PlayGet = (app: AppContext, q: URLSearchParams) => ApiResponse | Promise<ApiResponse>;
const PLAY_GETS: Record<string, PlayGet> = {
  "/api/play/lookup": getLookup,
  "/api/play/search": getSearch,
  "/api/countries": (app) => getCountries(app),
};

/** Paths of the single-project server before this version (plan 6.2, route inventory). */
function isOldPath(p: string): boolean {
  return (
    (p.startsWith("/api/") &&
      ![
        "/api/projects",
        "/api/jobs",
        "/api/health",
        "/api/import",
        ...Object.keys(PLAY_GETS),
      ].includes(p)) ||
    p.startsWith("/views/") ||
    p.startsWith("/images/") ||
    p.startsWith("/own/")
  );
}

/** The home, the placeholder wizard, and the routes shared by all projects. */
async function globalRoute(
  app: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const p = url.pathname;
  const get = req.method === "GET";
  if (p === "/" && get) {
    sendHtml(res, homeHtml(app.token));
    return true;
  }
  if (p === "/new" && get) {
    sendHtml(res, wizardHtml(app.token, null));
    return true;
  }
  const play = PLAY_GETS[p];
  if (play && get) {
    const r = await play(app, url.searchParams);
    send(res, r.status, r.body);
    return true;
  }
  if (p === "/api/projects" && req.method === "POST") {
    const w = await writeRequest(req, res, app.token);
    if (!w) return true;
    const r = await postProject(app, w.body);
    send(res, r.status, r.body);
    return true;
  }
  if (p === "/api/health" && get) {
    send(res, 200, { nonce: app.nonce });
    return true;
  }
  if (p === "/api/projects" && get) {
    const r = getProjects(app);
    send(res, r.status, r.body);
    return true;
  }
  if (p === "/api/jobs" && get) {
    const r = getJobs(app);
    send(res, r.status, r.body);
    return true;
  }
  if (p === "/api/import") {
    if (get) {
      const r = getImport(app);
      send(res, r.status, r.body);
      return true;
    }
    if (req.method === "POST") {
      const w = await writeRequest(req, res, app.token);
      if (!w) return true;
      const r = await postImport(app, w.body);
      send(res, r.status, r.body);
      return true;
    }
  }
  if (isOldPath(p)) {
    // A tab left open from before the upgrade: reads go to the latest project, writes are refused.
    const recent = app.recent();
    if (get && recent) redirect(res, `/p/${recent}${p}${url.search}`);
    else send(res, 410, { problems: ["This page is out of date. Reload it."] });
    return true;
  }
  return false;
}

/** One local server for all projects (plan 6.1): the home, and each project under /p/<id>/. */
export function createAppServer(app: AppContext): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (host !== "127.0.0.1" && host !== "localhost")
      return send(res, 403, { problems: ["Only local requests are allowed."] });
    try {
      if (await globalRoute(app, req, res, url)) return;
      const m = PROJECT_PATH.exec(url.pathname);
      if (!m) return send(res, 404, { problems: ["Not found."] });
      const id = m[1] ?? "";
      const rest = m[2] ?? "/";
      const found = app.load(id);
      if (!found) return send(res, 404, { problems: ["There is no such project."] });
      if (rest === "/api/archive" && req.method === "POST") {
        const w = await writeRequest(req, res, app.token);
        if (!w) return;
        const r = postArchive(app, id, w.body);
        return send(res, r.status, r.body);
      }
      if (await setupRoute(app, id, found, rest, req, res)) return;
      if ("draft" in found) {
        const s = draftState(id, found.draft);
        if (rest === "/api/state") return send(res, 200, s);
        if (rest === "/" || rest === "/status")
          return sendHtml(res, app.pages.status(id, found.draft.name, s, app.token));
        return send(res, 409, { problems: ["Add at least one competitor first."] });
      }
      return await projectRoute(app, found.loaded, rest, req, res, url);
    } catch (e) {
      send(res, 500, { problems: [e instanceof Error ? e.message : String(e)] });
    }
  });
}

/** Listens on 127.0.0.1 at the preferred port, or any free port if it is taken. */
export async function listen(server: Server, preferredPort: number): Promise<number> {
  const valid = Number.isInteger(preferredPort) && preferredPort >= 0 && preferredPort <= 65535;
  const at = (p: number) =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(p, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  try {
    await at(valid ? preferredPort : 4777);
  } catch {
    await at(0);
  }
  return (server.address() as AddressInfo).port;
}

/** Tests and embedding: a server with its context, listening. */
export async function startAppServer(
  opts: AppOptions,
  port = 0,
): Promise<{ server: Server; app: AppContext; origin: string }> {
  const app = createAppContext(opts);
  const server = createAppServer(app);
  const actual = await listen(server, port);
  return { server, app, origin: `http://127.0.0.1:${actual}` };
}
