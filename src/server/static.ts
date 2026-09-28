import type { ServerResponse } from "node:http";
import { extname } from "node:path";
import type { ProjectPaths } from "../config/load.ts";
import { libraryImageKey } from "../library/serve.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import { send, TYPES } from "./http-util.ts";

const ROOTS = ["images", "views", "own", "icons"];

/**
 * The storage key behind a project's static URL (images/, views/, own/, icons/), or null. Only
 * data files are served: no page, script or SVG may run from them. For a project in the shared
 * library, images/... resolve to library files the project references, and nothing else.
 */
export function staticKey(paths: ProjectPaths, urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const segs = rel.split("/").filter((s) => s.length > 0);
  const top = segs[0] ?? "";
  if (!ROOTS.includes(top)) return null;
  if (segs.some((s) => s === "." || s === ".." || /[\\:]/.test(s))) return null;
  const ext = extname(rel).toLowerCase();
  if (!TYPES[ext] || ext === ".html") return null;
  if (top === "images" && paths.library) return libraryImageKey(paths, segs.join("/"));
  try {
    const k = projectKey(paths, ...segs);
    return workspaceStorage(paths.workspace).exists(k) ? k : null;
  } catch {
    return null;
  }
}

/** Streams a static file through storage (plan 12B, B2). */
export function serveStatic(res: ServerResponse, paths: ProjectPaths, urlPath: string): void {
  const k = staticKey(paths, urlPath);
  if (!k) {
    send(res, 404, { problems: ["Not found."] });
    return;
  }
  const stream = workspaceStorage(paths.workspace).readStream(k);
  let started = false;
  stream.once("error", () => {
    if (!started) send(res, 404, { problems: ["Not found."] });
    else res.destroy();
  });
  stream.once("data", (first) => {
    started = true;
    res.writeHead(200, {
      "Content-Type": TYPES[extname(k).toLowerCase()] ?? "application/octet-stream",
    });
    res.write(first);
    stream.pipe(res);
  });
  stream.once("end", () => {
    if (!started) {
      started = true;
      res.writeHead(200, { "Content-Type": TYPES[extname(k).toLowerCase()] ?? "text/plain" });
      res.end();
    }
  });
}
