import { randomBytes } from "node:crypto";
import { batchSpend } from "../analysis/attempts.ts";
import { approvalProblem, defaultDeps, fitProblem } from "../analysis/job.ts";
import {
  type AnalysisPlan,
  buildAnalysisPlan,
  readSavedPlan,
  type Stage,
} from "../analysis/plan.ts";
import {
  batchLimit,
  type Progress,
  type RunDeps,
  type RunError,
  type RunOutcome,
  runAnalysis,
} from "../analysis/run.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import {
  type ProjectContext,
  projectKey,
  type Storage,
  workspaceStorage,
} from "../storage/index.ts";
import { acquireAll, HEARTBEAT_MS, LOCKS, type LockInfo, lockHolder } from "../storage/leases.ts";
import { type Batch, type Job, readJournal, updateJournal, writeJournal } from "./journal.ts";

export interface AnalysisInput {
  stage: Stage;
  /** Fingerprint of the approval screen the user accepted. */
  planHash: string;
  /** Continue this stopped batch (its limit and what it already spent carry over). */
  continueBatch?: string | null;
}

/** Test and terminal hooks: the model providers, and the analysis itself. */
export interface RunnerOptions {
  depsFor?: (onProgress: (p: Progress) => void) => RunDeps;
  run?: (loaded: LoadedConfig, plan: AnalysisPlan, deps: RunDeps) => Promise<RunOutcome>;
}

export type EnqueueResult =
  | { ok: true; jobId: string; done: Promise<Job>; existing: boolean }
  | { ok: false; status: number; problem: string };

interface Handle {
  jobId: string;
  planHash: string;
  cancel: boolean;
  done: Promise<Job>;
}

/** Jobs running in this process, by project (the AI lane allows one across all projects). */
export const running = new Map<string, Handle>();

const round = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toFixed(2)}`;

/** "Rogue Legend is using the AI now (image 5 of 17)." from the lock and its project's journal. */
export function busyMessage(
  storage: Storage,
  held: LockInfo | null,
  names: (id: string) => string,
): string {
  const later = "You can start this when it finishes.";
  if (!held?.projectId) return `Another job is using the AI now. ${later}`;
  const name = names(held.projectId);
  if (held.kind === "import") return `${name} is being imported right now. ${later}`;
  let where = "";
  try {
    const other = readJournal(storage, { projectId: held.projectId }).jobs.ai;
    if (other?.state === "running" && other.progress.total)
      where = ` (image ${Math.min(other.progress.done + 1, other.progress.total)} of ${other.progress.total})`;
  } catch {}
  return `${name} is using the AI now${where}. ${later}`;
}

function refuse(status: number, problem: string): EnqueueResult {
  return { ok: false, status, problem };
}

/**
 * Starts an approved analysis batch in the background (plan 12B, B3). Idempotent by the plan
 * fingerprint: the same approval never starts two jobs. Refused, in plain words, when the pick
 * fails the fit rule, the approval is out of date, the batch has used its spending limit, the AI
 * is busy (one AI job across all projects, terminal included), or this project is downloading.
 */
export function enqueueAnalysis(
  loaded: LoadedConfig,
  input: AnalysisInput,
  opts: RunnerOptions & { names?: (id: string) => string } = {},
): EnqueueResult {
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const ctx: ProjectContext = { projectId: paths.projectId };
  const { stage, planHash } = input;
  const mine = running.get(ctx.projectId);
  if (mine)
    return mine.planHash === planHash
      ? { ok: true, jobId: mine.jobId, done: mine.done, existing: true }
      : refuse(409, "An analysis is already running in this project.");
  const guard = fitProblem(loaded, stage);
  if (guard) return refuse(409, guard);
  const saved = readSavedPlan(loaded, stage);
  const current = buildAnalysisPlan(loaded, stage);
  const problem = approvalProblem(saved, current, planHash);
  if (problem || !saved) return refuse(409, problem ?? "No approval screen was shown yet.");

  const journal = readJournal(storage, ctx);
  // One approval starts one job: a repeated or replayed request never pays twice.
  const approvalId = `${planHash}@${saved.createdAt}`;
  if (journal.jobs.ai?.approvalId === approvalId)
    return refuse(
      409,
      "This approval was used already. Press Start analysis to see the current numbers.",
    );
  let batch: Batch | undefined;
  if (input.continueBatch) {
    batch = journal.batches.find((b) => b.id === input.continueBatch && b.stage === stage);
    if (!batch) return refuse(409, "That batch is not known any more. Start a new batch instead.");
  }
  const spentBefore = batch ? batchSpend(paths, batch.id, batch.imageIds).usd : 0;
  const limit = batch ? batch.limitUsd : batchLimit(loaded, current);
  if (limit - spentBefore <= 0.01)
    return refuse(
      409,
      `This batch has used its spending limit of ${money(limit)}. Start a new batch to approve a new limit.`,
    );

  const held = acquireAll(storage, [LOCKS.ai], { projectId: ctx.projectId, kind: "analysis" });
  if ("heldBy" in held)
    return refuse(409, busyMessage(storage, held.heldBy, opts.names ?? ((id) => id)));
  // Checked while holding the AI lane (a store job checks the AI lane the same way after taking
  // its own), so a download and an analysis can never both start in one project.
  if (lockHolder(storage, LOCKS.store)?.projectId === ctx.projectId) {
    held.release();
    return refuse(409, "This project is downloading. Start the analysis when the download ends.");
  }

  const now = new Date().toISOString();
  const frozen = projectKey(ctx, "state", "approved", `analysis-${planHash}.json`);
  storage.putJsonOnce(frozen, saved);
  const full = current.items.filter((i) => i.tier === "full");
  if (!batch) {
    batch = {
      id: `${now.replace(/[:.]/g, "-")}-${stage}`,
      stage,
      firstApprovedPlanHash: planHash,
      limitUsd: round(limit),
      runs: [],
      imageIds: [],
      createdAt: now,
    };
    journal.batches.push(batch);
  }
  batch.imageIds = [...new Set([...batch.imageIds, ...full.map((i) => i.imageId)])];
  const job: Job = {
    id: randomBytes(8).toString("hex"),
    kind: "analysis",
    planHash,
    approvalId,
    stage,
    batchId: batch.id,
    frozenInput: frozen,
    lockNonce: held.leases[0]?.nonce ?? "",
    startedAt: now,
    heartbeatAt: now,
    finishedAt: null,
    progress: { phase: "start", done: 0, total: full.length, message: "Startingâ€¦", spentUsd: 0 },
    state: "running",
    errors: [],
    error: null,
    report: null,
    synthesisSkipped: null,
    items: current.items
      .filter((i) => i.tier !== "identical")
      .map((i) => ({ name: i.name, position: i.position, imageId: i.imageId })),
    estimateUsd: current.estimate.usd,
    cancelled: false,
  };
  journal.jobs.ai = job;
  writeJournal(storage, ctx, journal);

  const handle: Handle = { jobId: job.id, planHash, cancel: false, done: Promise.resolve(job) };
  running.set(ctx.projectId, handle);
  const budget = limit - spentBefore;
  const batchId = batch.id;
  handle.done = (async (): Promise<Job> => {
    let last = job;
    const save = (patch: Partial<Job>) => {
      const j = updateJournal(storage, ctx, (jj) => {
        if (jj.jobs.ai?.id === job.id)
          Object.assign(jj.jobs.ai, patch, { heartbeatAt: new Date().toISOString() });
      });
      last = j.jobs.ai ?? last;
    };
    const beat = setInterval(() => save({}), HEARTBEAT_MS);
    beat.unref();
    const errors: RunError[] = [];
    let lost = false;
    try {
      const deps = (opts.depsFor ?? ((cb) => defaultDeps(loaded, cb)))((p) =>
        save({ progress: { ...p, spentUsd: round(p.spentUsd) } }),
      );
      const inner = deps.onError;
      deps.onError = (e) => {
        errors.push(e);
        inner?.(e);
        save({ errors: [...errors] });
      };
      deps.budgetUsd = budget;
      deps.batchId = batchId;
      deps.shouldStop = () => {
        try {
          held.check();
        } catch {
          lost = true;
        }
        return handle.cancel || lost;
      };
      const out = await (opts.run ?? runAnalysis)(loaded, current, deps);
      updateJournal(storage, ctx, (jj) => {
        const b = jj.batches.find((x) => x.id === batchId);
        if (b && !b.runs.includes(out.runId)) b.runs.push(out.runId);
      });
      const error = lost
        ? "Stopped: the tool lost its hold on the AI lane. Finished images are kept."
        : out.cancelled
          ? "Stopped: you pressed Stop. Finished images are kept."
          : (out.aborted ??
            (out.stoppedForBudget
              ? "Stopped: the spending limit for this batch was reached."
              : null));
      save({
        state: error ? "stopped" : "finished",
        error,
        cancelled: out.cancelled,
        report: out.report,
        synthesisSkipped: out.synthesisSkipped,
        finishedAt: new Date().toISOString(),
      });
    } catch (e) {
      save({
        state: "failed",
        error: e instanceof Error ? e.message : String(e),
        finishedAt: new Date().toISOString(),
      });
    } finally {
      clearInterval(beat);
      held.release();
      running.delete(ctx.projectId);
    }
    return last;
  })();
  return { ok: true, jobId: job.id, done: handle.done, existing: false };
}

/** Stop after the current image. False when no job of this project runs in this process. */
export function cancelAnalysis(projectId: string): boolean {
  const h = running.get(projectId);
  if (!h) return false;
  h.cancel = true;
  return true;
}
