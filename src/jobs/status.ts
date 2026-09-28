import { batchSpend } from "../analysis/attempts.ts";
import { buildAnalysisPlan } from "../analysis/plan.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { type ProjectContext, type Storage, workspaceStorage } from "../storage/index.ts";
import { LOCKS, lockHolder } from "../storage/leases.ts";
import { type Job, legacyAnalysisJob, readJournal } from "./journal.ts";
import { busyMessage, running } from "./runner.ts";

/** The analysis status the page shows (the run panel, Stop, and Continue). */
export interface AnalysisStatus {
  jobId: string | null;
  running: boolean;
  /** "stopped" also covers a job interrupted by a closed tool or a crash (see `interrupted`). */
  state: "none" | "running" | "finished" | "stopped" | "failed";
  interrupted: boolean;
  /** True while the job runs in this server (a terminal run cannot be stopped from the page). */
  stoppable: boolean;
  stage: "pilot" | "core" | null;
  progress: Job["progress"] | null;
  startedAt: string | null;
  finishedAt: string | null;
  spentUsd: number;
  errors: Job["errors"];
  report: string | null;
  aborted: boolean;
  error: string | null;
  synthesisSkipped: string | null;
  batch: { estimateUsd: [number, number] | null; items: Job["items"] } | null;
  /** The approved batch's spend ledger: what it spent across all its runs, and its limit. */
  ledger: { batchId: string; spentUsd: number; limitUsd: number; interrupted: number } | null;
  /** A stopped batch with work left: one click opens the approval for the rest. */
  continuable: { remaining: number; estimateUsd: [number, number]; leftUsd: number } | null;
  /** Another project is using the AI (one AI job across all projects). */
  otherAi: string | null;
}

/** A running journal job whose lock is gone (tool closed, crash, sleep) was interrupted. */
export function isInterrupted(storage: Storage, projectId: string, job: Job | undefined): boolean {
  if (job?.state !== "running") return false;
  if (running.get(projectId)?.jobId === job.id) return false;
  const holder = lockHolder(storage, job.kind === "analysis" ? LOCKS.ai : LOCKS.store);
  return holder?.nonce !== job.lockNonce;
}

export function analysisStatus(
  loaded: LoadedConfig,
  names: (id: string) => string = (id) => id,
): AnalysisStatus {
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const ctx: ProjectContext = { projectId: paths.projectId };
  const journal = readJournal(storage, ctx);
  const job = journal.jobs.ai ?? legacyAnalysisJob(storage, ctx) ?? undefined;
  const interrupted = isInterrupted(storage, ctx.projectId, job);
  const isRunning = job?.state === "running" && !interrupted;
  const holder = lockHolder(storage, LOCKS.ai);
  const otherAi =
    holder && holder.projectId !== ctx.projectId ? busyMessage(storage, holder, names) : null;
  const batch = job?.batchId ? journal.batches.find((b) => b.id === job.batchId) : undefined;
  const ledger = batch
    ? {
        batchId: batch.id,
        limitUsd: batch.limitUsd,
        ...(({ usd, interrupted: n }) => ({ spentUsd: usd, interrupted: n }))(
          batchSpend(paths, batch.id, batch.imageIds),
        ),
      }
    : null;
  let continuable: AnalysisStatus["continuable"] = null;
  const stopped = interrupted || job?.state === "stopped" || job?.state === "failed";
  if (stopped && job?.stage && ledger) {
    try {
      const plan = buildAnalysisPlan(loaded, job.stage);
      const left = Math.max(0, ledger.limitUsd - ledger.spentUsd);
      if ((plan.counts.full > 0 || plan.synthesisNeeded) && plan.withinCap)
        continuable = {
          remaining: plan.counts.full,
          estimateUsd: plan.estimate.usd,
          leftUsd: Math.round(left * 100) / 100,
        };
    } catch {}
  }
  const state: AnalysisStatus["state"] = !job ? "none" : interrupted ? "stopped" : job.state;
  return {
    jobId: job?.id ?? null,
    running: isRunning,
    state,
    interrupted,
    stoppable: isRunning && running.get(ctx.projectId)?.jobId === job?.id,
    stage: job?.stage ?? null,
    progress: job?.progress ?? null,
    startedAt: job?.startedAt ?? null,
    // An interrupted run has no end time: the page says the tool stopped during the run.
    finishedAt: interrupted ? null : (job?.finishedAt ?? null),
    spentUsd: job?.progress.spentUsd ?? 0,
    errors: job?.errors ?? [],
    report: job?.report ?? null,
    aborted: !!job && (job.state === "stopped" || job.state === "failed"),
    error: interrupted
      ? "The tool stopped during this run. Finished images are kept."
      : (job?.error ?? null),
    synthesisSkipped: job?.synthesisSkipped ?? null,
    batch: job ? { estimateUsd: job.estimateUsd, items: job.items } : null,
    ledger,
    continuable,
    otherAi,
  };
}

/** One lane's current job, for the "Working now" strip. */
export interface LaneView {
  lane: "ai" | "store";
  projectId: string;
  kind: string;
  message: string;
  done: number;
  total: number;
  spentUsd: number;
}

/** What runs in each lane right now, whichever project (or terminal) it belongs to. */
export function listJobs(storage: Storage): LaneView[] {
  const out: LaneView[] = [];
  for (const lane of ["ai", "store"] as const) {
    const h = lockHolder(storage, LOCKS[lane]);
    if (!h?.projectId) continue;
    let job: Job | undefined;
    try {
      job = readJournal(storage, { projectId: h.projectId }).jobs[lane];
    } catch {}
    const live = job?.state === "running" && job.lockNonce === h.nonce;
    out.push({
      lane,
      projectId: h.projectId,
      kind: h.kind,
      message: live && job ? job.progress.message : h.kind === "import" ? "Importing" : "Working",
      done: live && job ? job.progress.done : 0,
      total: live && job ? job.progress.total : 0,
      spentUsd: live && job ? job.progress.spentUsd : 0,
    });
  }
  return out;
}
