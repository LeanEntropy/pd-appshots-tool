import { randomBytes } from "node:crypto";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import {
  type Launcher,
  NoBrowserError,
  type RenderHooks,
  type RenderRequest,
  renderPdf,
} from "./pdf.ts";
import {
  type ExportOptions,
  exportHash,
  printQuery,
  type ReportRef,
  reportSource,
} from "./report-source.ts";

/**
 * The PDF export job (plan 6.3): kind "pdf-export" in its own "export" lane, one export at a
 * time across all projects, independent of the AI and store lanes. The same report, options
 * and renderer give the same file, so a repeated export returns the saved PDF at once. Jobs
 * live in this process (an export takes seconds and leaves nothing half-written: the file is
 * written in one step at the end).
 */
export interface ExportJobView {
  id: string;
  kind: "pdf-export";
  state: "waiting" | "running" | "finished" | "stopped" | "failed";
  message: string;
  done: number;
  total: number;
  /** The download name, "<report name> <date>.pdf". */
  fileName: string;
  /** Where the PDF is saved in the project's workspace (when finished). */
  path: string | null;
  sizeBytes: number | null;
  /** True when the same export was saved before and is returned at once. */
  existing: boolean;
  error: string | null;
  /** Neither Chrome nor Edge could be started: the page offers the browser's own print. */
  noBrowser: boolean;
}

interface ExportJob extends ExportJobView {
  projectId: string;
  key: string;
  controller: AbortController;
}

/** Test and terminal hooks: the PDF writer, and a browser path the user set. */
export interface ExportDeps {
  render?: (req: RenderRequest, hooks: RenderHooks) => Promise<Buffer>;
  launch?: Launcher;
  browserPath?: string | null;
}

export type ExportResult =
  | { ok: true; job: ExportJobView; done: Promise<ExportJobView> }
  | { ok: false; status: number; problem: string };

const jobs = new Map<string, ExportJob>();
const KEEP = 50;
/** The export lane: each job starts when the one before it has ended. */
let lane: Promise<unknown> = Promise.resolve();

function view(j: ExportJob): ExportJobView {
  const { projectId: _p, key: _k, controller: _c, ...v } = j;
  return { ...v };
}

function remember(j: ExportJob): void {
  jobs.set(j.id, j);
  for (const id of jobs.keys()) {
    if (jobs.size <= KEEP) break;
    const old = jobs.get(id);
    if (old && old.state !== "waiting" && old.state !== "running") jobs.delete(id);
  }
}

/**
 * Starts (or finds) the PDF export of one report. `origin` is this server's own address: the
 * headless browser opens the report's print page there and loads nothing else.
 */
export function exportReport(
  loaded: LoadedConfig,
  ref: ReportRef,
  options: ExportOptions,
  ctx: { origin: string },
  deps: ExportDeps = {},
): ExportResult {
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const src = reportSource(loaded, ref, options);
  if ("problem" in src) return { ok: false, status: src.status, problem: src.problem };
  const key = `${src.folder}/${exportHash(src, options)}.pdf`;
  const same = [...jobs.values()].find(
    (j) => j.key === key && (j.state === "waiting" || j.state === "running"),
  );
  if (same) return { ok: true, job: view(same), done: finished(same) };
  const job: ExportJob = {
    id: randomBytes(8).toString("hex"),
    kind: "pdf-export",
    state: "waiting",
    message: "Waiting for another PDF export to finish",
    done: 0,
    total: 0,
    fileName: src.fileName,
    path: null,
    sizeBytes: null,
    existing: false,
    error: null,
    noBrowser: false,
    projectId: paths.projectId,
    key,
    controller: new AbortController(),
  };
  remember(job);
  if (storage.exists(key)) {
    Object.assign(job, {
      state: "finished",
      message: "Saved",
      existing: true,
      path: storage.localPath(key),
      sizeBytes: storage.getBytes(key)?.length ?? null,
    });
    return { ok: true, job: view(job), done: Promise.resolve(view(job)) };
  }
  const base = `${ctx.origin}/p/${paths.projectId}/`;
  const req: RenderRequest = {
    url: `${base}views/report-print.html?${printQuery(ref, options)}`,
    allowPrefix: base,
    paper: options.paper,
    landscape: options.landscape,
    title: src.page.title,
    browserPath: deps.browserPath ?? null,
  };
  const run = async (): Promise<void> => {
    if (job.controller.signal.aborted) return;
    Object.assign(job, { state: "running", message: "Starting" });
    try {
      const pdf = await (deps.render ?? renderPdf)(req, {
        signal: job.controller.signal,
        launch: deps.launch,
        onProgress: (message, done = 0, total = 0) => Object.assign(job, { message, done, total }),
      });
      if (job.controller.signal.aborted) throw new Error("Stopped");
      storage.putBlob(key, pdf);
      Object.assign(job, {
        state: "finished",
        message: "Saved",
        path: storage.localPath(key),
        sizeBytes: pdf.length,
      });
    } catch (e) {
      if (job.controller.signal.aborted)
        Object.assign(job, {
          state: "stopped",
          message: "Stopped",
          error: "Stopped: you pressed Stop.",
        });
      else
        Object.assign(job, {
          state: "failed",
          message: "Failed",
          noBrowser: e instanceof NoBrowserError,
          error:
            e instanceof NoBrowserError
              ? e.message
              : `The PDF could not be written: ${e instanceof Error ? e.message : String(e)}`,
        });
    }
  };
  const mine = lane.then(run);
  lane = mine.catch(() => {});
  return { ok: true, job: view(job), done: mine.then(() => view(job)) };
}

/** Resolves when this job has ended (it may already have). */
function finished(j: ExportJob): Promise<ExportJobView> {
  return new Promise((resolve) => {
    const tick = () =>
      j.state === "waiting" || j.state === "running" ? setTimeout(tick, 100) : resolve(view(j));
    tick();
  });
}

function mine(loaded: LoadedConfig, jobId: string | null): ExportJob | null {
  const j = jobId ? jobs.get(jobId) : undefined;
  return j && j.projectId === projectPaths(loaded).projectId ? j : null;
}

/** A job of this project as the page shows it, or null when it is not known (any more). */
export function exportStatus(loaded: LoadedConfig, jobId: string | null): ExportJobView | null {
  const j = mine(loaded, jobId);
  return j ? view(j) : null;
}

/** Stops a waiting or running export (the browser is closed). False when there is none. */
export function stopExport(loaded: LoadedConfig, jobId: string | null): boolean {
  const j = mine(loaded, jobId);
  if (!j || (j.state !== "waiting" && j.state !== "running")) return false;
  j.controller.abort();
  if (j.state === "waiting")
    Object.assign(j, { state: "stopped", message: "Stopped", error: "Stopped: you pressed Stop." });
  return true;
}

/** The saved PDF of a finished job: its storage key and download name. */
export function exportFile(
  loaded: LoadedConfig,
  jobId: string | null,
): { key: string; fileName: string } | null {
  const j = mine(loaded, jobId);
  return j?.state === "finished" ? { key: j.key, fileName: j.fileName } : null;
}
