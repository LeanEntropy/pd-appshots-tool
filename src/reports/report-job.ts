import { layerAttemptId } from "../analysis/layer-diff-run.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { type EnqueueResult, type RunnerOptions, running, startJob } from "../jobs/runner.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import { eligibility, eligibilityProblem, scopeIncomplete } from "./eligibility.ts";
import { blocking, doubtfulInPlan, type MatchPair } from "./match-check.ts";
import { runReport } from "./report-run.ts";
import { buildScopePlan, type ScopePlan } from "./scope-plan.ts";
import { readDef } from "./store.ts";
import { isPreset, type ReportDef } from "./types.ts";

/**
 * The paid part of a One country or Compare countries report (plan-reports 1.2, 2.2, 2.3): the
 * approval screen's numbers (saved as the plan the user saw), the checks before a run starts,
 * and the run itself as a job in the AI lane.
 */
const planKey = (c: { projectId: string }, id: string) =>
  projectKey(c, "pending", `report-plan-${id}.json`);

interface Saved {
  plan: ScopePlan;
  createdAt: string;
}

export interface ReportApproval {
  plan: ScopePlan;
  /**
   * Doubtful picture matches of this plan not answered yet (shown first). They block the run,
   * except the pixel check's "moved" suggestions and its "decided" list (see MatchPair.group).
   */
  doubtful: MatchPair[];
}

function problemOf(loaded: LoadedConfig, def: ReportDef): string | null {
  if (isPreset(def.type)) return "The Pilot and the Full check are approved on the Analysis page.";
  return eligibilityProblem(eligibility(loaded), def.type) ?? scopeIncomplete(def.scope);
}

/** The approval screen of a report's AI batch (no AI): saved as the plan the user is shown. */
export function reportApproval(
  loaded: LoadedConfig,
  def: ReportDef,
): ReportApproval | { problem: string } {
  const problem = problemOf(loaded, def);
  if (problem) return { problem };
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const plan = buildScopePlan(loaded, def.scope);
  s.putJson(planKey(paths, def.id), { plan, createdAt: new Date().toISOString() } satisfies Saved);
  return { plan, doubtful: doubtfulInPlan(loaded, plan.items) };
}

/** Why the approved run must not start, or null (the approval is for exactly this plan). */
export function reportApprovalProblem(
  loaded: LoadedConfig,
  saved: Saved | undefined,
  current: ScopePlan,
  shownHash: string,
): string | null {
  if (!saved) return "No approval screen was shown for this report yet.";
  if (saved.plan.planHash !== shownHash)
    return "The approval was for an older version of this report.";
  if (current.planHash !== shownHash)
    return "The numbers changed since the approval screen was shown. Review the new numbers.";
  if (blocking(doubtfulInPlan(loaded, current.items)).length)
    return "Some picture matches are doubtful: answer Same screen or Different screens for each one first.";
  if (current.overLimit)
    return `This report would cost up to $${current.usd[1].toFixed(2)}, over its spending limit of $${current.limitUsd.toFixed(2)}. Leave some games or countries out first.`;
  return null;
}

/**
 * Starts a report's approved AI batch (only the approval dialog's "Approve and run" calls this,
 * with the fingerprint it showed). Refused, in plain words, when anything changed since.
 */
export function enqueueReport(
  loaded: LoadedConfig,
  input: { reportId: string; planHash: string },
  opts: RunnerOptions & { names?: (id: string) => string } = {},
): EnqueueResult {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const mine = running.get(paths.projectId);
  if (mine)
    return mine.planHash === input.planHash
      ? { ok: true, jobId: mine.jobId, done: mine.done, existing: true }
      : { ok: false, status: 409, problem: "An analysis is already running in this project." };
  const def = readDef(s, paths, input.reportId);
  if (!def)
    return { ok: false, status: 404, problem: "This report no longer exists. Reload the page." };
  const refused = problemOf(loaded, def);
  if (refused) return { ok: false, status: 409, problem: refused };
  const saved = s.getJson(planKey(paths, def.id)) as Saved | undefined;
  const current = buildScopePlan(loaded, def.scope);
  const problem = reportApprovalProblem(loaded, saved, current, input.planHash);
  if (problem || !saved) return { ok: false, status: 409, problem: problem ?? "No approval yet." };
  const paid = current.items.filter((i) => i.tier !== "identical");
  return startJob(
    loaded,
    {
      reportId: def.id,
      planHash: input.planHash,
      approvalId: `${input.planHash}@${saved.createdAt}`,
      frozen: saved,
      batch: null,
      newBatch: { suffix: def.id, stage: "report", limitUsd: current.limitUsd },
      attemptIds: paid.map((i) =>
        i.tier === "layer-diff" ? layerAttemptId(i.imageId) : i.imageId,
      ),
      items: paid.map((i) => ({
        name: `${i.name} (${i.country})`,
        position: i.position,
        imageId: i.imageId,
      })),
      total: paid.length,
      estimateUsd: current.usd,
      exec: (deps) => runReport(loaded, def, current, deps, opts.reportProvider),
    },
    opts,
  );
}
