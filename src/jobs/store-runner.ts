import { randomBytes } from "node:crypto";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { type ProjectContext, type Storage, workspaceStorage } from "../storage/index.ts";
import { acquireAll, HEARTBEAT_MS, LOCKS, type LockInfo, lockHolder } from "../storage/leases.ts";
import { type Job, readJournal, updateJournal } from "./journal.ts";
import type { EnqueueResult } from "./runner.ts";
import { isInterrupted } from "./status.ts";

/** A store job: reading one game's store pages, or downloading its approved images. */
export interface StoreInput {
  kind: "store-check" | "download";
  appId: string;
  /** Idempotency key: the approved plan's fingerprint (a store check uses its own key). */
  planHash: string;
  /** Storage key of the frozen approved plan (downloads only). */
  frozenInput: string | null;
  /** First progress line, e.g. "Checking the store pages of Capybara Go". */
  message: string;
}

export type StoreProgress = (done: number, total: number, message: string) => void;
export type StoreWork = (progress: StoreProgress) => Promise<void>;

interface Handle {
  jobId: string;
  key: string;
  done: Promise<Job>;
}

/** Store jobs running in this process, by project (one store job across all projects). */
export const storeRunning = new Map<string, Handle>();

const VERB: Record<string, string> = {
  "store-check": "checking the store",
  download: "downloading",
  import: "being imported",
};

function storeBusy(held: LockInfo | null, names: (id: string) => string): string {
  const later = "You can start this when it finishes.";
  if (!held?.projectId) return `Another project is reading Google Play now. ${later}`;
  return `${names(held.projectId)} is ${VERB[held.kind] ?? "using Google Play"} now. ${later}`;
}

const refuse = (status: number, problem: string): EnqueueResult => ({ ok: false, status, problem });

/**
 * Starts a store job in the background (plan 12B, B3): one store job across all projects, and
 * a download never while this project is analysing (the analysis plan reads the same decks).
 * The same key while it runs returns the running job.
 */
export function enqueueStore(
  loaded: LoadedConfig,
  input: StoreInput,
  work: StoreWork,
  opts: { names?: (id: string) => string } = {},
): EnqueueResult {
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const ctx: ProjectContext = { projectId: paths.projectId };
  const key = `${input.kind}:${input.appId}:${input.planHash}`;
  const mine = storeRunning.get(ctx.projectId);
  if (mine)
    return mine.key === key
      ? { ok: true, jobId: mine.jobId, done: mine.done, existing: true }
      : refuse(409, "This project is already checking the store or downloading. Wait for it.");
  const held = acquireAll(storage, [LOCKS.store], { projectId: ctx.projectId, kind: input.kind });
  if ("heldBy" in held) return refuse(409, storeBusy(held.heldBy, opts.names ?? ((id) => id)));
  if (input.kind === "download" && lockHolder(storage, LOCKS.ai)?.projectId === ctx.projectId) {
    held.release();
    return refuse(409, "This project is analysing images now. Download when the analysis ends.");
  }
  const now = new Date().toISOString();
  const job: Job = {
    id: randomBytes(8).toString("hex"),
    kind: input.kind,
    planHash: input.planHash,
    approvalId: "",
    appId: input.appId,
    batchId: null,
    frozenInput: input.frozenInput,
    lockNonce: held.leases[0]?.nonce ?? "",
    startedAt: now,
    heartbeatAt: now,
    finishedAt: null,
    progress: { phase: input.kind, done: 0, total: 0, message: input.message, spentUsd: 0 },
    state: "running",
    errors: [],
    error: null,
    report: null,
    synthesisSkipped: null,
    items: [],
    estimateUsd: null,
    cancelled: false,
  };
  updateJournal(storage, ctx, (j) => {
    j.jobs.store = job;
  });
  const handle: Handle = { jobId: job.id, key, done: Promise.resolve(job) };
  storeRunning.set(ctx.projectId, handle);
  handle.done = (async (): Promise<Job> => {
    let last = job;
    const save = (patch: Partial<Job>) => {
      const j = updateJournal(storage, ctx, (jj) => {
        if (jj.jobs.store?.id === job.id)
          Object.assign(jj.jobs.store, patch, { heartbeatAt: new Date().toISOString() });
      });
      last = j.jobs.store ?? last;
    };
    const beat = setInterval(() => save({}), HEARTBEAT_MS);
    beat.unref();
    try {
      await work((done, total, message) => {
        held.check();
        save({ progress: { phase: input.kind, done, total, message, spentUsd: 0 } });
      });
      held.check();
      save({ state: "finished", finishedAt: new Date().toISOString() });
    } catch (e) {
      save({
        state: "failed",
        error: e instanceof Error ? e.message : String(e),
        finishedAt: new Date().toISOString(),
      });
    } finally {
      clearInterval(beat);
      held.release();
      storeRunning.delete(ctx.projectId);
    }
    return last;
  })();
  return { ok: true, jobId: job.id, done: handle.done, existing: false };
}

/** The project's store job as the page shows it. */
export interface StoreStatus {
  jobId: string;
  kind: Job["kind"];
  appId: string | null;
  planHash: string;
  /** "stopped" means the tool was closed or crashed while it ran. */
  state: "running" | "finished" | "stopped" | "failed";
  progress: Job["progress"];
  error: string | null;
}

export function storeStatus(storage: Storage, ctx: ProjectContext): StoreStatus | null {
  const job = readJournal(storage, ctx).jobs.store;
  if (!job) return null;
  const inThisProcess = storeRunning.get(ctx.projectId)?.jobId === job.id;
  const stopped = !inThisProcess && isInterrupted(storage, ctx.projectId, job);
  return {
    jobId: job.id,
    kind: job.kind,
    appId: job.appId ?? null,
    planHash: job.planHash,
    state: stopped ? "stopped" : job.state,
    progress: job.progress,
    error: stopped ? "The tool stopped while this was running. Start it again." : job.error,
  };
}
