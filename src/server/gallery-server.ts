import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { renderGalleryHtml } from "../steps/deck-view.ts";
import {
  type ApiResponse,
  getAnalyses,
  getAnalysisStatus,
  getReport,
  getSelection,
  postAnalysisPlan,
  postAnalysisRun,
  postSelection,
} from "./api.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const STATIC_ROOTS = ["images", "views", "own"];
const MAX_BODY = 64 * 1024;
const POSTS: Record<string, (l: LoadedConfig, body: unknown) => ApiResponse> = {
  "/api/selection": postSelection,
  "/api/analysis/plan": postAnalysisPlan,
  "/api/analysis/run": (l, b) => postAnalysisRun(l, b),
};

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error("too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Only requests addressed to this machine by name are served (blocks DNS-rebinding pages). */
function localHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  return host === "127.0.0.1" || host === "localhost";
}

/** Resolves a URL path to a file under the project's image, view or own-asset folders. */
export function staticFile(base: string, urlPath: string): string | null {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^[\\/]+/, "");
  const top = rel.split(/[\\/]/)[0] ?? "";
  if (!STATIC_ROOTS.includes(top) || rel.split(/[\\/]/).includes("..")) return null;
  // Only the generated gallery page is served as a page; no other file may run script here.
  if ([".html", ".htm", ".svg", ".js", ".mjs"].includes(extname(rel).toLowerCase())) return null;
  const file = join(base, rel);
  if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

/** Browsers send Origin on cross-site requests; only this server's own origin is accepted. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return (
      (o.hostname === "127.0.0.1" || o.hostname === "localhost") && o.host === req.headers.host
    );
  } catch {
    return false;
  }
}

/** The token is written into the served page and required on every save or analysis request. */
export function createGalleryServer(
  loaded: LoadedConfig,
  token = randomBytes(16).toString("hex"),
): Server {
  const base = projectPaths(loaded).base;
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!localHost(req)) return send(res, 403, { problems: ["Only local requests are allowed."] });
    try {
      if (url.pathname === "/" || url.pathname === "/views/gallery.html") {
        if (url.pathname === "/") {
          res.writeHead(302, { Location: "/views/gallery.html" });
          return res.end();
        }
        res.writeHead(200, { "Content-Type": TYPES[".html"], "Cache-Control": "no-store" });
        return res.end(renderGalleryHtml(loaded, token));
      }
      if (url.pathname === "/api/selection" && req.method === "GET") {
        const r = getSelection(loaded);
        return send(res, r.status, r.body);
      }
      if (url.pathname === "/api/analysis/status" && req.method === "GET") {
        const r = getAnalysisStatus(loaded);
        return send(res, r.status, r.body);
      }
      if (url.pathname === "/api/analyses" && req.method === "GET") {
        const r = getAnalyses(loaded);
        return send(res, r.status, r.body);
      }
      if (url.pathname === "/api/report" && req.method === "GET") {
        const r = getReport(loaded, url.searchParams.get("stage"));
        return send(res, r.status, r.body);
      }
      const post = POSTS[url.pathname];
      if (post && req.method === "POST") {
        if (!sameOrigin(req) || req.headers["x-ssr-token"] !== token) {
          return send(res, 403, { problems: ["This request did not come from the gallery page."] });
        }
        if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
          return send(res, 415, { problems: ["Expected JSON."] });
        }
        let body: unknown;
        try {
          body = await readBody(req);
        } catch {
          return send(res, 400, { problems: ["The page sent something the tool cannot read."] });
        }
        const r = post(loaded, body);
        return send(res, r.status, r.body);
      }
      const file = req.method === "GET" ? staticFile(base, url.pathname) : null;
      if (!file) return send(res, 404, { problems: ["Not found."] });
      res.writeHead(200, {
        "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      });
      createReadStream(file).pipe(res);
    } catch (e) {
      send(res, 500, { problems: [e instanceof Error ? e.message : String(e)] });
    }
  });
}

export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/** Starts on 127.0.0.1 at the preferred port, or any free port if it is taken. */
export async function startGalleryServer(
  loaded: LoadedConfig,
  preferredPort: number,
  token?: string,
): Promise<{ server: Server; url: string }> {
  const server = createGalleryServer(loaded, token);
  const valid = Number.isInteger(preferredPort) && preferredPort >= 0 && preferredPort <= 65535;
  const port = valid ? preferredPort : 4777;
  const listen = (p: number) =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(p, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  try {
    await listen(port);
  } catch {
    await listen(0);
  }
  const { port: actual } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${actual}/views/gallery.html` };
}
