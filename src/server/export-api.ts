import { spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname } from "node:path";
import { z } from "zod";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import {
  type ExportDeps,
  exportFile,
  exportReport,
  exportStatus,
  stopExport,
} from "../export/job.ts";
import {
  ExportOptionsSchema,
  exportOptions,
  parsePrintQuery,
  ReportRefSchema,
  reportSource,
} from "../export/report-source.ts";
import { workspaceStorage } from "../storage/index.ts";
import { reportPrintHtml } from "../view/report-print.ts";
import type { AppContext } from "./app-context.ts";
import { send, sendHtml, writeRequest } from "./http-util.ts";

/**
 * PDF export routes (plan 6.3), all under /p/<id>/:
 *   GET  views/report-print.html?report&version&images&hidden   the print page the export opens
 *   POST api/export/pdf          { report: { report, version }, images, paper, landscape, hiddenSections }
 * Options the page leaves out take the Settings page's PDF defaults.
 *   GET  api/export/pdf/status?job=<id>
 *   POST api/export/pdf/stop     { job }
 *   GET  api/export/pdf/file?job=<id>                      the PDF as a download
 *   POST api/export/pdf/open     { job, reveal }            open it, or show it in its folder
 * Files are found by job id only; no path is ever taken from a request.
 */
const StartBody = ExportOptionsSchema.extend({ report: ReportRefSchema });
const JobBody = z.strictObject({ job: z.string().regex(/^[0-9a-f]{16}$/) });
const OpenBody = JobBody.extend({ reveal: z.boolean().default(false) });

export type Opener = (path: string, reveal: boolean) => void;

/** Opens the PDF in the default viewer, or shows it selected in its folder. */
export const openFile: Opener = (path, reveal) => {
  const detached = { detached: true, stdio: "ignore", windowsHide: false } as const;
  if (process.platform === "win32")
    spawn("explorer.exe", [reveal ? `/select,"${path}"` : `"${path}"`], {
      ...detached,
      windowsVerbatimArguments: true,
    }).unref();
  else if (process.platform === "darwin")
    spawn("open", reveal ? ["-R", path] : [path], detached).unref();
  else spawn("xdg-open", [reveal ? dirname(path) : path], detached).unref();
};

/** Tests: a fake PDF writer and opener. */
export const exportHooks: { deps: ExportDeps; open: Opener } = { deps: {}, open: openFile };

/** Answers with a plain-language problem; true (the request was handled). */
function bad(res: ServerResponse, problem: string, status = 400): true {
  send(res, status, { problems: [problem] });
  return true;
}

function download(res: ServerResponse, loaded: LoadedConfig, jobId: string | null): true {
  const f = exportFile(loaded, jobId);
  if (!f) return bad(res, "This PDF is not ready or no longer known. Export it again.", 404);
  const storage = workspaceStorage(projectPaths(loaded).workspace);
  const bytes = storage.getBytes(f.key);
  if (!bytes) return bad(res, "The saved PDF is missing. Export it again.", 404);
  const ascii = f.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  res.writeHead(200, {
    "Content-Type": "application/pdf",
    "Content-Length": bytes.length,
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
    "Cache-Control": "no-store",
  });
  res.end(bytes);
  return true;
}

/** Handles the export routes; false when the path is not one of them. */
export async function exportRoute(
  app: AppContext,
  loaded: LoadedConfig,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  const get = req.method === "GET";
  if (rest === "/views/report-print.html" && get) {
    const p = parsePrintQuery(loaded.config, url.searchParams);
    if (!p) return bad(res, "Unknown report.");
    const src = reportSource(loaded, p.ref, p.options);
    if ("problem" in src) return bad(res, src.problem, src.status);
    sendHtml(res, reportPrintHtml(src.page));
    return true;
  }
  if (rest === "/api/export/pdf/status" && get) {
    const job = exportStatus(loaded, url.searchParams.get("job"));
    if (!job) return bad(res, "This export is no longer known. Export it again.", 404);
    send(res, 200, { job });
    return true;
  }
  if (rest === "/api/export/pdf/file" && get) {
    return download(res, loaded, url.searchParams.get("job"));
  }
  if (req.method !== "POST" || !rest.startsWith("/api/export/pdf")) return false;
  if (!["/api/export/pdf", "/api/export/pdf/stop", "/api/export/pdf/open"].includes(rest))
    return false;
  const w = await writeRequest(req, res, app.token);
  if (!w) return true;
  if (rest === "/api/export/pdf") {
    const b = StartBody.safeParse(w.body);
    if (!b.success) return bad(res, "The page sent export options the tool cannot read.");
    const { report, ...options } = b.data;
    const r = exportReport(
      loaded,
      report,
      exportOptions(loaded.config, options),
      // The address this server listens on (never the request's Host header).
      { origin: `http://127.0.0.1:${req.socket.localPort}` },
      exportHooks.deps,
    );
    if (!r.ok) return bad(res, r.problem, r.status);
    send(res, 200, { job: r.job });
    return true;
  }
  const b = (rest.endsWith("/open") ? OpenBody : JobBody).safeParse(w.body);
  if (!b.success) return bad(res, "The page sent a request the tool cannot read.");
  if (rest.endsWith("/stop")) {
    const stopped = stopExport(loaded, b.data.job);
    send(res, 200, { stopped, job: exportStatus(loaded, b.data.job) });
    return true;
  }
  const f = exportFile(loaded, b.data.job);
  if (!f) return bad(res, "This PDF is not ready or no longer known. Export it again.", 404);
  const path = workspaceStorage(projectPaths(loaded).workspace).localPath(f.key);
  const reveal = "reveal" in b.data && b.data.reveal === true;
  try {
    exportHooks.open(path, reveal);
  } catch (e) {
    return bad(
      res,
      `The PDF could not be opened: ${e instanceof Error ? e.message : String(e)}`,
      500,
    );
  }
  send(res, 200, { opened: true, path, reveal });
  return true;
}
