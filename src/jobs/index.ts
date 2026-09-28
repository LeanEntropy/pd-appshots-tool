import type { LoadedConfig } from "../config/load.ts";
import { projectPaths } from "../config/load.ts";
import { type Storage, workspaceStorage } from "../storage/index.ts";
import { readJournal } from "./journal.ts";
import {
  type AnalysisInput,
  cancelAnalysis,
  type EnqueueResult,
  enqueueAnalysis,
  type RunnerOptions,
} from "./runner.ts";
import { type AnalysisStatus, analysisStatus, type LaneView, listJobs } from "./status.ts";

/**
 * Jobs behind one interface (plan 12B, B3). Routes and terminal commands only call these; no
 * route starts work itself. The first implementation is the in-process runner with the two
 * lanes (one AI job and one store job across all projects), the locks and the job journal.
 * This stage runs analysis batches; store checks and downloads join in a later stage.
 */
export type { AnalysisInput, AnalysisStatus, EnqueueResult, LaneView, RunnerOptions };
export type JobKind = "analysis";

type Opts = RunnerOptions & { names?: (id: string) => string };

/** Starts a job for its approved, frozen input; the same key never starts two jobs. */
export function enqueue(
  loaded: LoadedConfig,
  _kind: JobKind,
  input: AnalysisInput,
  opts: Opts = {},
): EnqueueResult {
  return enqueueAnalysis(loaded, input, opts);
}

/** A project's job as the page shows it (running, stopped with Continue, finished). */
export function status(loaded: LoadedConfig, names?: (id: string) => string): AnalysisStatus {
  return analysisStatus(loaded, names);
}

/**
 * Continues a stopped analysis job with the user's one-click approval of the remaining work:
 * the batch's limit and what it spent carry over. A no-op if that job is running already.
 */
export function resume(
  loaded: LoadedConfig,
  jobId: string,
  approval: { planHash: string },
  opts: Opts = {},
): EnqueueResult {
  const paths = projectPaths(loaded);
  const job = readJournal(workspaceStorage(paths.workspace), paths).jobs.ai;
  if (!job || job.id !== jobId || !job.stage)
    return { ok: false, status: 404, problem: "That job is not known any more." };
  return enqueueAnalysis(
    loaded,
    { stage: job.stage, planHash: approval.planHash, continueBatch: job.batchId },
    opts,
  );
}

/** Stop after the current image; everything finished is kept. */
export function cancel(loaded: LoadedConfig): boolean {
  return cancelAnalysis(projectPaths(loaded).projectId);
}

export function list(storage: Storage): LaneView[] {
  return listJobs(storage);
}
