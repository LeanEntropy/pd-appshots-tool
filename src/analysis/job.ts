import { join } from "node:path";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { type AnalysisPlan, buildAnalysisPlan, readSavedPlan, type Stage } from "./plan.ts";
import { providerFor } from "./providers.ts";
import { writeRunReport } from "./report.ts";
import { type Progress, type RunDeps, runAnalysis } from "./run.ts";

export interface JobState {
  running: boolean;
  stage: Stage | null;
  progress: Progress | null;
  report: string | null;
  error: string | null;
}

const state: JobState = { running: false, stage: null, progress: null, report: null, error: null };

export function jobState(): JobState {
  return { ...state };
}

/**
 * Why an approved run must not start, or null. The approval refers to the exact plan shown:
 * the plan is rebuilt and must have the same fingerprint as the saved one the user saw.
 */
export function approvalProblem(
  saved: AnalysisPlan | undefined,
  current: AnalysisPlan,
  shownHash: string,
): string | null {
  if (!saved) return "No approval screen was shown for this batch yet.";
  if (saved.planHash !== shownHash) return "The approval was for an older version of this batch.";
  if (current.planHash !== shownHash)
    return "The batch changed since the approval screen was shown. Review the new numbers.";
  if (!current.withinCap)
    return `This batch would take the core above its cap of ${current.cap} images.`;
  if (current.counts.newImages === 0) return "There is nothing new to analyse in this batch.";
  if (current.counts.layerDiff > 0) {
    return "This batch needs marketing-layer diffs, which arrive with the country expansion step.";
  }
  return null;
}

export function defaultDeps(loaded: LoadedConfig, onProgress: (p: Progress) => void): RunDeps {
  const m = loaded.config.models;
  const schemaDir = join(projectPaths(loaded).objects, "schemas");
  return {
    producer: providerFor(m.fullAnalysis, schemaDir),
    reviewer: loaded.config.review.enabled ? providerFor(m.imageReview, schemaDir) : null,
    adjudicator: providerFor(m.adjudicate, schemaDir),
    onProgress,
  };
}

/** Starts an approved batch. Only called after an explicit approval (page button or "yes"). */
export async function runApproved(
  loaded: LoadedConfig,
  stage: Stage,
  shownHash: string,
  depsFor: (onProgress: (p: Progress) => void) => RunDeps = (cb) => defaultDeps(loaded, cb),
): Promise<{ ok: boolean; message: string }> {
  if (state.running) return { ok: false, message: "An analysis is already running." };
  const saved = readSavedPlan(loaded, stage);
  const current = buildAnalysisPlan(loaded, stage);
  const problem = approvalProblem(saved, current, shownHash);
  if (problem) return { ok: false, message: problem };
  Object.assign(state, { running: true, stage, progress: null, report: null, error: null });
  try {
    const out = await runAnalysis(
      loaded,
      current,
      depsFor((p) => {
        state.progress = p;
      }),
    );
    state.report = writeRunReport(loaded, current, out.runId, out.records, out.spentUsd);
    return { ok: true, message: `Finished. Report: ${state.report}` };
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    return { ok: false, message: state.error };
  } finally {
    state.running = false;
  }
}
