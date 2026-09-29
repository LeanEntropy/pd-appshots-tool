import type { Storage } from "../storage/index.ts";
import { LOCKS, lockHolder } from "../storage/leases.ts";
import { listShared, removeShared, SHARE_PREFIX } from "../storage/share-files.ts";
import { type ExportResult, exportKey, writePackage } from "./export.ts";
import type { ShareKind } from "./format.ts";
import { type ImportMode, type ImportResult, importPackage } from "./import.ts";
import { type Fetch, type FetchOutcome, fetchOriginals } from "./originals.ts";
import { PackageError } from "./read-zip.ts";

/**
 * The share actions run in the background of the tool's process, one of each kind at a time,
 * with live progress for the page (plan 12C, C9). A restart of the tool forgets them; nothing is
 * half-applied (exports and imports commit by rename).
 */
export interface Progress {
  step: string;
  done: number;
  total: number;
}

export interface Task<R> {
  state: "running" | "done" | "failed";
  startedAt: string;
  progress: Progress;
  result: R | null;
  error: string | null;
}

const exports = new Map<string, Task<ExportResult & { kind: ShareKind }>>();
const originals = new Map<string, Task<FetchOutcome>>();
let importing: (Task<ImportResult> & { uploadId: string }) | null = null;

function start<R>(run: (p: (step: string, done: number, total: number) => void) => Promise<R>) {
  const t: Task<R> = {
    state: "running",
    startedAt: new Date().toISOString(),
    progress: { step: "Starting", done: 0, total: 0 },
    result: null,
    error: null,
  };
  const progress = (step: string, done: number, total: number) => {
    t.progress = { step, done, total };
  };
  // After this answer is sent, so the page shows the busy state at once.
  void new Promise<void>((r) => setImmediate(r))
    .then(() => run(progress))
    .then((r) => {
      t.result = r;
      t.state = "done";
    })
    .catch((e: unknown) => {
      t.state = "failed";
      // Checks of the package speak plain language; anything else gets a hint where to look.
      t.error =
        e instanceof PackageError
          ? e.message
          : `It stopped: ${e instanceof Error ? e.message : String(e)}`;
    });
  return t;
}

const DAY = 24 * 3_600_000;

/** Removes finished exports and abandoned uploads after a day (never anything else). */
export function cleanOld(storage: Storage, now = Date.now()): void {
  for (const folder of ["exports", "incoming", "staging"]) {
    const k = `${SHARE_PREFIX}/${folder}`;
    for (const f of listShared(storage, k))
      if (now - f.mtimeMs > DAY && !f.name.endsWith(".partial"))
        try {
          removeShared(storage, `${k}/${f.name}`);
        } catch {}
  }
}

export function startExport(
  storage: Storage,
  projectId: string,
  kind: ShareKind,
  o: { toolRoot: string; workspace: string; toolVersion: string },
): { ok: true; task: Task<unknown> } | { ok: false; problem: string } {
  if (exports.get(projectId)?.state === "running")
    return { ok: false, problem: "This project is being saved to a file already." };
  // A running analysis or download changes the files being saved: wait for it.
  if ([LOCKS.ai, LOCKS.store].some((k) => lockHolder(storage, k)?.projectId === projectId))
    return {
      ok: false,
      problem:
        "This project is analysing or downloading. Save it to a file when that has finished.",
    };
  cleanOld(storage);
  const t = start(async (progress) => ({
    ...(await writePackage(storage, projectId, { ...o, kind, progress })),
    kind,
  }));
  exports.set(projectId, t);
  return { ok: true, task: t };
}

export const exportTask = (projectId: string) => exports.get(projectId) ?? null;

/** The finished file of a project's latest export, by its id (never a path from a request). */
export function exportFileKey(projectId: string, exportId: string): string | null {
  const t = exports.get(projectId);
  return t?.state === "done" && t.result?.exportId === exportId ? exportKey(exportId) : null;
}

export function startImport(
  storage: Storage,
  uploadId: string,
  mode: ImportMode,
): { ok: true; task: Task<unknown> } | { ok: false; problem: string } {
  if (importing?.state === "running")
    return { ok: false, problem: "A shared project is being imported already." };
  const t = start((progress) => importPackage(storage, uploadId, mode, progress));
  importing = Object.assign(t, { uploadId });
  return { ok: true, task: t };
}

export const importTask = () => importing;

export function startOriginals(
  storage: Storage,
  projectId: string,
  fetch?: Fetch,
): { ok: true; task: Task<unknown> } | { ok: false; problem: string } {
  if (originals.get(projectId)?.state === "running")
    return { ok: false, problem: "The full-size pictures are being downloaded already." };
  const t = start((progress) =>
    fetchOriginals(storage, projectId, {
      ...(fetch ? { fetch } : { delayMs: 150 }),
      progress: (d, n) => progress("Downloading full-size pictures", d, n),
    }),
  );
  originals.set(projectId, t);
  return { ok: true, task: t };
}

export const originalsTask = (projectId: string) => originals.get(projectId) ?? null;
