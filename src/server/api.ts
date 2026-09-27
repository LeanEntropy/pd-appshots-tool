import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { approvalProblem, jobState, runApproved } from "../analysis/job.ts";
import { labeler } from "../analysis/labels.ts";
import {
  type AnalysisPlan,
  buildAnalysisPlan,
  readSavedPlan,
  type Stage,
} from "../analysis/plan.ts";
import { infoViews, summaries } from "../analysis/records.ts";
import { describeAnalysisPlan } from "../analysis/report.ts";
import { coreOrder, type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { type FitView, fitFor, resolvePick, savePick } from "../core/selection.ts";
import { overviewFile, writeOverview } from "../overview/overview-report.ts";
import { readJsonIfExists, writeJsonAtomic } from "../util/fsx.ts";
import { markdownToHtml } from "../view/md-html.ts";

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
  const approved = readSavedPlan(loaded, stage) as AnalysisPlan;
  writeJsonAtomic(batchFile(loaded), { stage, planHash, ...runBatch(approved) });
  void start(loaded, stage, planHash);
  return { status: 202, body: { started: true } };
}

/**
 * The running job, or the last one saved on disk, plus the images the run analyses (from the
 * approved plan) and its cost estimate, so the page can list each image's state after a reload.
 */
export function getAnalysisStatus(loaded?: LoadedConfig): ApiResponse {
  const job = jobState(loaded);
  if (!loaded || !job.stage) return { status: 200, body: { ...job, batch: null } };
  // The snapshot taken at approval; a plan shown later for the same stage does not change it.
  const snap = readJsonIfExists(batchFile(loaded)) as { stage?: string } | undefined;
  const plan = readSavedPlan(loaded, job.stage);
  const batch = snap?.stage === job.stage ? snap : plan ? runBatch(plan) : null;
  return { status: 200, body: { ...job, batch } };
}

function batchFile(loaded: LoadedConfig): string {
  return join(projectPaths(loaded).pending, "analysis-batch.json");
}

/** The images a run sends to AI, and its cost estimate. */
function runBatch(plan: AnalysisPlan) {
  return {
    estimateUsd: plan.estimate.usd,
    items: plan.items
      .filter((i) => i.tier !== "identical")
      .map((i) => ({ name: i.name, position: i.position, imageId: i.imageId })),
  };
}

/** Fresh analyses for the (i) popovers and thumbnail captions, without reloading the page. */
export function getAnalyses(loaded: LoadedConfig): ApiResponse {
  const paths = projectPaths(loaded);
  return {
    status: 200,
    body: {
      info: infoViews(paths, labeler(loadTaxonomy(loaded).taxonomy)),
      captions: Object.fromEntries(summaries(paths, labeler(loadTaxonomy(loaded).taxonomy))),
    },
  };
}

/** The free store overview (no AI) as HTML, or null if it was not built yet. */
export function getOverview(loaded: LoadedConfig): ApiResponse {
  const file = overviewFile(loaded);
  if (!existsSync(file)) return { status: 200, body: { overview: null } };
  return {
    status: 200,
    body: { overview: { file, html: markdownToHtml(readFileSync(file, "utf8")) } },
  };
}

let building: Promise<unknown> | null = null;

/** Rebuilds the overview from the downloaded data (no AI; about a minute the first time). */
export async function postOverview(loaded: LoadedConfig): Promise<ApiResponse> {
  if (building)
    return { status: 409, body: { problems: ["The overview is already being built."] } };
  try {
    building = writeOverview(loaded);
    await building;
    return getOverview(loaded);
  } catch (e) {
    return { status: 500, body: { problems: [e instanceof Error ? e.message : String(e)] } };
  } finally {
    building = null;
  }
}
