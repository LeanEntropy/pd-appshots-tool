import { z } from "zod";
import { approvalProblem, jobState, runApproved } from "../analysis/job.ts";
import { buildAnalysisPlan, readSavedPlan, type Stage } from "../analysis/plan.ts";
import { describeAnalysisPlan } from "../analysis/report.ts";
import { coreOrder, type LoadedConfig, projectPaths } from "../config/load.ts";
import { type FitView, fitFor, resolvePick, savePick } from "../core/selection.ts";

export interface ApiResponse {
  status: number;
  body: unknown;
}

/** Body of a selection save from the page. Limits keep a bad request from doing harm. */
export const SelectionBody = z.strictObject({
  coreCompetitors: z.array(z.string().min(1).max(200)).max(100),
});

export function fitSummary(r: FitView): string {
  const extra =
    r.wholeDeckTotal !== r.fit.total ? ` (${r.wholeDeckTotal} including tablet-shaped)` : "";
  return `${r.fit.selected.length} competitor decks plus ours = ${r.fit.total} images${extra}. ${r.fit.ok ? "Ready." : r.fit.message}`;
}

function fitBody(r: FitView) {
  return {
    ok: r.fit.ok,
    total: r.fit.total,
    wholeDeckTotal: r.wholeDeckTotal,
    slots: r.slots,
    selected: r.fit.selected.map((c) => ({ appId: c.appId, name: c.name, images: c.deckLength })),
    skipped: r.fit.skipped.map((s) => ({
      appId: s.candidate.appId,
      name: s.candidate.name,
      reason: s.reason,
    })),
    summary: fitSummary(r),
  };
}

export function getSelection(loaded: LoadedConfig): ApiResponse {
  const ids = coreOrder(loaded, projectPaths(loaded));
  return { status: 200, body: { coreCompetitors: ids, ...fitBody(fitFor(loaded, ids)) } };
}

/** Validates and saves a pick sent by the page; writes the run config directly. */
export function postSelection(loaded: LoadedConfig, raw: unknown): ApiResponse {
  const parsed = SelectionBody.safeParse(raw);
  if (!parsed.success) {
    return { status: 400, body: { problems: ["The page sent a selection the tool cannot read."] } };
  }
  const { ids, problems } = resolvePick(loaded.config, parsed.data.coreCompetitors);
  if (problems.length) return { status: 400, body: { problems } };
  const r = savePick(loaded, ids, "page");
  return { status: 200, body: { saved: true, coreCompetitors: ids, ...fitBody(r) } };
}

const StageBody = z.strictObject({ stage: z.enum(["pilot", "core"]) });
const RunBody = z.strictObject({
  stage: z.enum(["pilot", "core"]),
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Approval numbers for a batch (no AI). Saves the plan as the one the user is shown. */
export function postAnalysisPlan(loaded: LoadedConfig, raw: unknown): ApiResponse {
  const parsed = StageBody.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { problems: ["Unknown batch."] } };
  const plan = buildAnalysisPlan(loaded, parsed.data.stage, { save: true });
  return { status: 200, body: { plan, text: describeAnalysisPlan(plan) } };
}

export type Starter = (loaded: LoadedConfig, stage: Stage, planHash: string) => Promise<unknown>;

/**
 * Starts an approved batch in the background. Only the page's "Approve and run" button calls
 * this, with the fingerprint of the plan it showed; any change since then is refused.
 */
export function postAnalysisRun(
  loaded: LoadedConfig,
  raw: unknown,
  start: Starter = runApproved,
): ApiResponse {
  const parsed = RunBody.safeParse(raw);
  if (!parsed.success)
    return { status: 400, body: { problems: ["The approval could not be read."] } };
  if (jobState().running)
    return { status: 409, body: { problems: ["An analysis is already running."] } };
  const { stage, planHash } = parsed.data;
  const problem = approvalProblem(
    readSavedPlan(loaded, stage),
    buildAnalysisPlan(loaded, stage),
    planHash,
  );
  if (problem) return { status: 409, body: { problems: [problem] } };
  void start(loaded, stage, planHash);
  return { status: 202, body: { started: true } };
}

export function getAnalysisStatus(): ApiResponse {
  return { status: 200, body: jobState() };
}
