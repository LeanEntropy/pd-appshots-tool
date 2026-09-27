import { join } from "node:path";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { readJsonIfExists, writeJsonAtomic } from "../util/fsx.ts";
import { type AnalysisPlan, buildAnalysisPlan, readSavedPlan, type Stage } from "./plan.ts";
import { providerFor } from "./providers.ts";
import { type Progress, type RunDeps, type RunError, runAnalysis } from "./run.ts";

export interface JobState {
  running: boolean;
  stage: Stage | null;
  progress: Progress | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Last known cost, kept after the run ends. */
  spentUsd: number;
  errors: RunError[];
  /** Path of the final markdown report. */
  report: string | null;
  /** True when the batch stopped early (repeated identical errors or the spending limit). */
  aborted: boolean;
  /** Why the run stopped early, or a crash message. */
  error: string | null;
  synthesisSkipped: string | null;
}

const EMPTY: JobState = {
  running: false,
  stage: null,
  progress: null,
  startedAt: null,
  finishedAt: null,
  spentUsd: 0,
  errors: [],
  report: null,
  aborted: false,
  error: null,
  synthesisSkipped: null,
};
const state: JobState = { ...EMPTY };
let statusFile: string | null = null;

function persist(): void {
  if (statusFile) writeJsonAtomic(statusFile, state);
}

/** The current run, or the last one saved on disk (so the page is never blank after a restart). */
export function jobState(loaded?: LoadedConfig): JobState {
  if (!state.running && !state.startedAt && loaded) {
    const saved = readJsonIfExists(join(projectPaths(loaded).pending, "analysis-status.json")) as
      | JobState
      | undefined;
    if (saved) return { ...saved, running: false };
  }
  return { ...state, errors: [...state.errors] };
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
  if (current.counts.newImages === 0 && !current.synthesisNeeded)
    return "Everything in this batch is analysed and its report is written already.";
  if (current.counts.layerDiff > 0) {
    return "This batch needs marketing-layer diffs, which arrive with the country expansion step.";
  }
  return null;
}

export function defaultDeps(loaded: LoadedConfig, onProgress: (p: Progress) => void): RunDeps {
  const m = loaded.config.models;
  const schemaDir = join(projectPaths(loaded).objects, "schemas");
  const review = loaded.config.review.enabled;
  return {
    producer: providerFor(m.fullAnalysis, schemaDir),
    reviewer: review ? providerFor(m.imageReview, schemaDir) : null,
    adjudicator: providerFor(m.adjudicate, schemaDir),
    writer: providerFor(m.recommend, schemaDir),
    recommendationReviewer: review ? providerFor(m.recommendationReview, schemaDir) : null,
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
  statusFile = join(projectPaths(loaded).pending, "analysis-status.json");
  Object.assign(state, {
    ...EMPTY,
    errors: [],
    running: true,
    stage,
    startedAt: new Date().toISOString(),
    progress: {
      phase: "start",
      done: 0,
      total: current.counts.full,
      message: "Starting…",
      spentUsd: 0,
    },
  });
  persist();
  try {
    const deps = depsFor((p) => {
      state.progress = p;
      state.spentUsd = p.spentUsd;
      persist();
    });
    const inner = deps.onError;
    deps.onError = (e) => {
      state.errors.push(e);
      inner?.(e);
      persist();
    };
    const out = await runAnalysis(loaded, current, deps);
    Object.assign(state, {
      report: out.report,
      spentUsd: Math.round(out.spentUsd * 100) / 100,
      error:
        out.aborted ??
        (out.stoppedForBudget ? "Stopped: the spending limit for this batch was reached." : null),
      synthesisSkipped: out.synthesisSkipped,
      aborted: !!out.aborted || out.stoppedForBudget,
    });
    const ok = !state.error;
    return { ok, message: `${state.error ?? "Finished."} Report: ${out.report}` };
  } catch (e) {
    state.error = e instanceof Error ? e.message : String(e);
    state.aborted = true;
    return { ok: false, message: state.error };
  } finally {
    state.running = false;
    state.finishedAt = new Date().toISOString();
    persist();
  }
}
