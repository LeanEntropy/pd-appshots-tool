import { randomBytes } from "node:crypto";
import { batchSpend } from "../analysis/attempts.ts";
import { approvalProblem, defaultDeps, fitProblem } from "../analysis/job.ts";
import {
  type AnalysisPlan,
  buildAnalysisPlan,
  readSavedPlan,
  type Stage,
} from "../analysis/plan.ts";
import type { Provider } from "../analysis/providers.ts";
import {
  batchLimit,
  type Progress,
  type RunDeps,
  type RunError,
  type RunOutcome,
  runAnalysis,
} from "../analysis/run.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { type ProjectContext, projectKey, workspaceStorage } from "../storage/index.ts";
import { acquireAll, HEARTBEAT_MS, LOCKS, lockHolder } from "../storage/leases.ts";
import { busyMessage } from "./busy.ts";
import { type Batch, type Job, readJournal, updateJournal, writeJournal } from "./journal.ts";
import type { StartSpec } from "./start-spec.ts";

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
  /** The model providers of a report's AI batch, by model reference (tests use fakes). */
  reportProvider?: (ref: string) => Provider;
}

export { busyMessage } from "./busy.ts";
export type { RunEnd, StartSpec } from "./start-spec.ts";
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
  let batch: Batch | null = null;
  if (input.continueBatch) {
    batch = journal.batches.find((b) => b.id === input.continueBatch && b.stage === stage) ?? null;
    if (!batch) return refuse(409, "That batch is not known any more. Start a new batch instead.");
  }
  const full = current.items.filter((i) => i.tier === "full");
  return startJob(
    loaded,
    {
      stage,
      planHash,
      approvalId: `${planHash}@${saved.createdAt}`,
      frozen: saved,
      batch,
      newBatch: { suffix: stage, stage, limitUsd: batchLimit(loaded, current) },
      attemptIds: full.map((i) => i.imageId),
      items: current.items
        .filter((i) => i.tier !== "identical")
        .map((i) => ({ name: i.name, position: i.position, imageId: i.imageId })),
      total: full.length,
      estimateUsd: current.estimate.usd,
      exec: (deps) => (opts.run ?? runAnalysis)(loaded, current, deps),
    },
    opts,
  );
}

/**
 * Starts an approved batch as a job (plan 12B, B3): one approval starts one job, the batch's
 * spending limit and what it spent carry over, the AI lane is held (one AI job across all
 * projects), the frozen input is saved, and the run's end is kept in the journal.
 */
export function startJob(
  loaded: LoadedConfig,
  spec: StartSpec,
  opts: RunnerOptions & { names?: (id: string) => string } = {},
): EnqueueResult {
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const ctx: ProjectContext = { projectId: paths.projectId };
  const { planHash, approvalId } = spec;
  const journal = readJournal(storage, ctx);
  // One approval starts one job: a repeated or replayed request never pays twice.
  if (
    journal.jobs.ai?.approvalId === approvalId ||
    journal.batches.some((b) => b.approvals.includes(approvalId))
  )
    return refuse(
      409,
      "This approval was used already. Open the approval again to see the current numbers.",
    );
  let batch: Batch | undefined = spec.batch
    ? journal.batches.find((b) => b.id === spec.batch?.id)
    : undefined;
  if (spec.batch && !batch)
    return refuse(409, "That batch is not known any more. Start a new batch instead.");
  const spentBefore = batch ? batchSpend(paths, batch.id, batch.imageIds).usd : 0;
  const limit = batch ? batch.limitUsd : spec.newBatch.limitUsd;
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
  storage.putJsonOnce(frozen, spec.frozen);
  if (!batch) {
    batch = {
      id: `${now.replace(/[:.]/g, "-")}-${spec.newBatch.suffix}`,
      stage: spec.newBatch.stage,
      ...(spec.reportId ? { reportId: spec.reportId } : {}),
      firstApprovedPlanHash: planHash,
      limitUsd: round(limit),
      runs: [],
      approvals: [],
      imageIds: [],
      createdAt: now,
    };
    journal.batches.push(batch);
  }
  batch.approvals = [...batch.approvals, approvalId];
  batch.imageIds = [...new Set([...batch.imageIds, ...spec.attemptIds])];
  const job: Job = {
    id: randomBytes(8).toString("hex"),
    kind: "analysis",
    planHash,
    approvalId,
    ...(spec.stage ? { stage: spec.stage } : {}),
    ...(spec.reportId ? { reportId: spec.reportId } : {}),
    batchId: batch.id,
    frozenInput: frozen,
    lockNonce: held.leases[0]?.nonce ?? "",
    startedAt: now,
    heartbeatAt: now,
    finishedAt: null,
    progress: { phase: "start", done: 0, total: spec.total, message: "Starting…", spentUsd: 0 },
    state: "running",
    errors: [],
    error: null,
    report: null,
    synthesisSkipped: null,
    items: spec.items,
    estimateUsd: spec.estimateUsd,
    cancelled: false,
    outcomes: {},
    steps: [],
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
      const outcomes: Job["outcomes"] = {};
      deps.onItem = (id, state, note) => {
        outcomes[id] = { state, note: note ?? null };
        save({ outcomes: { ...outcomes } });
      };
      deps.onSteps = (steps) => save({ steps });
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
      const out = await spec.exec(deps);
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
