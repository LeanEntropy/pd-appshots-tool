import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import pkg from "../../package.json" with { type: "json" };
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { collectProject, estimate } from "../share/collect.ts";
import { KindSchema, LIMITS, sizeText } from "../share/format.ts";
import { inspectPackage, UPLOAD_ID, uploadKey } from "../share/inspect.ts";
import {
  exportFileKey,
  exportTask,
  importTask,
  originalsTask,
  startExport,
  startImport,
  startOriginals,
} from "../share/jobs.ts";
import { type Fetch, previewOnly } from "../share/originals.ts";
import { PackageError } from "../share/read-zip.ts";
import { fileSize, freeDiskBytes, openShareWrite } from "../storage/share-files.ts";
import type { AppContext } from "./app-context.ts";
import { sameOrigin, send, writeRequest } from "./http-util.ts";

/**
 * Sharing a project (plan 12C, milestone 3b, adapted):
 *   GET  /p/<id>/api/share                 sizes of Light and Full, the running export, previews
 *   POST /p/<id>/api/share/export          { kind }  builds the file in the background
 *   GET  /p/<id>/api/share/file?id=<id>    the finished file, as a download
 *   POST /p/<id>/api/share/originals       downloads full-size pictures of preview-only images
 *   POST /api/share/upload                 the chosen zip (raw body, streamed to disk)
 *   POST /api/share/inspect                { uploadId }  what the file holds (writes nothing)
 *   POST /api/share/import                 { uploadId, mode }   GET: the running import
 */
export const shareHooks: { fetch?: Fetch } = {};
const sizeCache = new Map<string, { at: number; sizes: ReturnType<typeof estimate> }>();

const ExportBody = z.strictObject({ kind: KindSchema });
const InspectBody = z.strictObject({ uploadId: z.string().regex(UPLOAD_ID) });
const ImportBody = InspectBody.extend({ mode: z.enum(["new", "copy", "replace"]) });

const problem = (res: ServerResponse, text: string, status = 400) => {
  send(res, status, { problems: [text] });
  return true;
};

async function upload(app: AppContext, req: IncomingMessage, res: ServerResponse) {
  if (!sameOrigin(req) || req.headers["x-ssr-token"] !== app.token)
    return problem(res, "This request did not come from the tool's page.", 403);
  const declared = Number(req.headers["content-length"] ?? 0);
  const cap = Math.min(LIMITS.uploadBytes, freeDiskBytes(app.storage) - LIMITS.reserveBytes);
  if (declared > cap)
    return problem(
      res,
      `This file is too large (${sizeText(declared)}) for the free disk space.`,
      413,
    );
  const uploadId = randomBytes(10).toString("hex");
  const w = openShareWrite(app.storage, uploadKey(uploadId));
  let size = 0;
  try {
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > cap) throw new PackageError("This file is too large for the free disk space.");
      if (!w.stream.write(c)) await new Promise<void>((r) => w.stream.once("drain", () => r()));
    }
    await new Promise<void>((r, j) => {
      w.stream.once("error", j);
      w.stream.end(r);
    });
    w.commit();
  } catch (e) {
    w.abort();
    req.resume();
    return problem(
      res,
      e instanceof PackageError ? e.message : "The file could not be received.",
      413,
    );
  }
  send(res, 200, { uploadId, bytes: size });
  return true;
}

/** Routes for every project (the home page's "Open a shared project"). */
export async function shareGlobalRoute(
  app: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  p: string,
): Promise<boolean> {
  if (!p.startsWith("/api/share/")) return false;
  if (p === "/api/share/upload" && req.method === "POST") return upload(app, req, res);
  if (p === "/api/share/import" && req.method === "GET") {
    const t = importTask();
    send(res, 200, { importing: t ? { ...t, uploadId: undefined } : null });
    return true;
  }
  if (req.method !== "POST" || !["/api/share/inspect", "/api/share/import"].includes(p))
    return problem(res, "Not found.", 404);
  const w = await writeRequest(req, res, app.token);
  if (!w) return true;
  if (p === "/api/share/inspect") {
    const b = InspectBody.safeParse(w.body);
    if (!b.success) return problem(res, "This upload is not known.");
    try {
      const r = await inspectPackage(app.storage, b.data.uploadId);
      r.ix.close();
      send(res, 200, { inspection: r.inspection });
    } catch (e) {
      if (!(e instanceof PackageError)) throw e;
      problem(res, e.message, 422);
    }
    return true;
  }
  const b = ImportBody.safeParse(w.body);
  if (!b.success) return problem(res, "The page sent a choice the tool cannot read.");
  if (fileSize(app.storage, uploadKey(b.data.uploadId)) === undefined)
    return problem(res, "The uploaded file is no longer here. Choose it again.", 404);
  const r = startImport(app.storage, b.data.uploadId, b.data.mode);
  if (!r.ok) return problem(res, r.problem, 409);
  send(res, 202, { started: true });
  return true;
}

/** Routes under /p/<id>/: sizes, the export and its file, and the full-size pictures. */
export async function shareProjectRoute(
  app: AppContext,
  loaded: LoadedConfig,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!rest.startsWith("/api/share")) return false;
  const paths = projectPaths(loaded);
  const id = paths.projectId;
  if (rest === "/api/share" && req.method === "GET") {
    let sizes = null;
    let problemText = null;
    try {
      // Polling while a file is written skips the sizes (they are read once per visit).
      if (url.searchParams.get("sizes") !== "0") {
        // Counting thousands of files takes seconds: kept for a minute.
        const hit = sizeCache.get(id);
        sizes =
          hit && Date.now() - hit.at < 60_000
            ? hit.sizes
            : estimate(await collectProject(app.storage, id));
        sizeCache.set(id, { at: hit?.sizes === sizes ? hit.at : Date.now(), sizes });
      }
    } catch (e) {
      problemText = e instanceof Error ? e.message : String(e);
    }
    const shared = app.storage.getJson(`projects/${id}/state/shared-from.json`) ?? null;
    send(res, 200, {
      sizes,
      problem: problemText,
      export: exportTask(id),
      previewOnly: previewOnly(app.storage, id).length,
      originals: originalsTask(id),
      shared,
    });
    return true;
  }
  if (rest === "/api/share/file" && req.method === "GET") {
    const exportId = url.searchParams.get("id") ?? "";
    const k = /^[0-9a-f]{20}$/.test(exportId) ? exportFileKey(id, exportId) : null;
    const size = k ? fileSize(app.storage, k) : undefined;
    if (!k || size === undefined)
      return problem(res, "This file is no longer here. Save the project to a file again.", 404);
    const t = exportTask(id);
    const name = t?.result?.fileName ?? `${id}.zip`;
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": size,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    });
    app.storage.readStream(k).pipe(res);
    return true;
  }
  if (req.method !== "POST") return problem(res, "Not found.", 404);
  const w = await writeRequest(req, res, app.token);
  if (!w) return true;
  if (rest === "/api/share/export") {
    const b = ExportBody.safeParse(w.body);
    if (!b.success) return problem(res, "Choose Light or Full.");
    const r = startExport(app.storage, id, b.data.kind, {
      toolRoot: app.root,
      workspace: paths.workspace,
      toolVersion: pkg.version,
    });
    if (!r.ok) return problem(res, r.problem, 409);
    send(res, 202, { started: true });
    return true;
  }
  if (rest === "/api/share/originals") {
    if (!previewOnly(app.storage, id).length)
      return problem(res, "Every picture of this project is already at full size.", 409);
    const r = startOriginals(app.storage, id, shareHooks.fetch);
    if (!r.ok) return problem(res, r.problem, 409);
    send(res, 202, { started: true });
    return true;
  }
  return problem(res, "Not found.", 404);
}
