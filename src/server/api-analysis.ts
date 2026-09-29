import { z } from "zod";
import { batchSpend } from "../analysis/attempts.ts";
import { ExpansionBody, expansionOptions, saveExpansion } from "../analysis/expansion.ts";
import { fitProblem } from "../analysis/job.ts";
import { type AnalysisPlan, buildAnalysisPlan } from "../analysis/plan.ts";
import { readRecord } from "../analysis/records.ts";
import { describeAnalysisPlan } from "../analysis/report.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { cancel, enqueue, type RunnerOptions, status } from "../jobs/index.ts";
import { readJournal } from "../jobs/journal.ts";
import { workspaceStorage } from "../storage/index.ts";
import type { ApiResponse } from "./api.ts";

/** Project names for plain messages ("Rogue Legend is using the AI now"). */
export type Names = (id: string) => string;

const Stage = z.enum(["pilot", "core"]);
const BatchId = z.string().regex(/^[0-9A-Za-z-]{1,80}$/);
const PlanBody = z.strictObject({ stage: Stage, continueBatch: BatchId.optional() });
const RunBody = z.strictObject({
  stage: Stage,
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
  continueBatch: BatchId.optional(),
});

/**
 * "Already analysed, free" on the approval screen (plan 12A, A6): images whose analysis exists,
 * split by who paid for it. Images repeated within the batch are analysed once.
 */
export function freeImages(loaded: LoadedConfig, plan: AnalysisPlan, names: Names) {
  const paths = projectPaths(loaded);
  let thisProject = 0;
  let sameInBatch = 0;
  let sameScreen = 0;
  const others = new Map<string, number>();
  for (const it of plan.items) {
    if (it.tier !== "identical") continue;
    // The same screen in another size in its deck: the earlier copy's analysis is reused.
    if (it.repeatOf && it.basedOn !== it.imageId) {
      sameScreen++;
      continue;
    }
    if (it.reason !== "already analysed") {
      sameInBatch++;
      continue;
    }
    const by = readRecord(paths, it.imageId)?.paidBy?.projectId;
    if (!by || by === paths.projectId) thisProject++;
    else others.set(by, (others.get(by) ?? 0) + 1);
  }
  return {
    thisProject,
    sameInBatch,
    sameScreen,
    others: [...others].map(([projectId, count]) => ({ projectId, name: names(projectId), count })),
  };
}

/** Approval numbers for a batch (no AI). Saves the plan as the one the user is shown. */
export function postAnalysisPlan(
  loaded: LoadedConfig,
  raw: unknown,
  names: Names = (id) => id,
): ApiResponse {
  const parsed = PlanBody.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { problems: ["Unknown batch."] } };
  const { stage, continueBatch } = parsed.data;
  const guard = fitProblem(loaded, stage);
  if (guard) return { status: 409, body: { problems: [guard] } };
  let continuing = null;
  if (continueBatch) {
    const paths = projectPaths(loaded);
    const b = readJournal(workspaceStorage(paths.workspace), paths).batches.find(
      (x) => x.id === continueBatch && x.stage === stage,
    );
    if (!b) return { status: 409, body: { problems: ["That batch is not known any more."] } };
    const spent = batchSpend(paths, b.id, b.imageIds);
    continuing = {
      batchId: b.id,
      spentUsd: spent.usd,
      interrupted: spent.interrupted,
      limitUsd: b.limitUsd,
      leftUsd: Math.max(0, Math.round((b.limitUsd - spent.usd) * 100) / 100),
    };
  }
  const plan = buildAnalysisPlan(loaded, stage, { save: true });
  return {
    status: 200,
    body: {
      plan,
      text: describeAnalysisPlan(plan),
      free: freeImages(loaded, plan, names),
      continuing,
    },
  };
}

/**
 * Starts an approved batch through the jobs module. Only the page's "Approve and run" button
 * calls this, with the fingerprint of the plan it showed; any change since then is refused.
 */
export function postAnalysisRun(
  loaded: LoadedConfig,
  raw: unknown,
  opts: RunnerOptions & { names?: Names; onEnd?: () => void } = {},
): ApiResponse {
  const parsed = RunBody.safeParse(raw);
  if (!parsed.success)
    return { status: 400, body: { problems: ["The approval could not be read."] } };
  const r = enqueue(loaded, "analysis", parsed.data, opts);
  if (!r.ok) return { status: r.status, body: { problems: [r.problem] } };
  // A crash of the run itself is recorded in the journal; nothing waits for it here. When it
  // ends (finished, stopped or failed), the caller refreshes what depends on it (the home card).
  const ended = () => {
    try {
      opts.onEnd?.();
    } catch {
      // The next page load refreshes it.
    }
  };
  r.done.then(ended, ended);
  return { status: 202, body: { started: true, jobId: r.jobId } };
}

/** The running job, or how the last one ended, with Continue and the batch's spend. */
export function getAnalysisStatus(loaded: LoadedConfig, names?: Names): ApiResponse {
  return { status: 200, body: status(loaded, names) };
}

/** Stop after the current image (the page's Stop button). */
export function postAnalysisStop(loaded: LoadedConfig): ApiResponse {
  if (cancel(loaded))
    return {
      status: 202,
      body: {
        stopping: true,
        message: "Stopping: nothing new starts; the work in progress finishes and is kept.",
      },
    };
  return {
    status: 409,
    body: {
      problems: [
        "No analysis of this project runs in this window. A run started in a terminal is stopped there with Ctrl+C.",
      ],
    },
  };
}

export function getExpansion(loaded: LoadedConfig): ApiResponse {
  return { status: 200, body: expansionOptions(loaded) };
}

/** Saves the expansion choice; running expansions is the next stage. */
export function postExpansion(loaded: LoadedConfig, raw: unknown): ApiResponse {
  const parsed = ExpansionBody.safeParse(raw);
  if (!parsed.success)
    return { status: 400, body: { problems: ["The page sent a choice the tool cannot read."] } };
  const r = saveExpansion(loaded, parsed.data);
  if ("problem" in r) return { status: 400, body: { problems: [r.problem] } };
  return { status: 200, body: r };
}
