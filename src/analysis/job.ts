import { join } from "node:path";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { fitFor } from "../core/selection.ts";
import { secondOpinionOn } from "../settings/access.ts";
import { latestRun } from "../view/model.ts";
import type { AnalysisPlan, Stage } from "./plan.ts";
import { providerFor } from "./providers.ts";
import type { Progress, RunDeps } from "./run.ts";

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

/**
 * The fit rule, enforced by the server and the terminal commands (plan 5.1): a batch needs a
 * finished download, and a pick whose whole English decks fit (the pilot needs its first
 * competitors, the core check the minimum number). Null when the batch may be planned.
 */
export function fitProblem(loaded: LoadedConfig, stage: Stage): string | null {
  if (!latestRun(projectPaths(loaded).runs))
    return "Nothing is downloaded for this project yet. Download the store pages first.";
  const { core } = loaded.config;
  const view = fitFor(loaded);
  const need = stage === "pilot" ? core.pilotCompetitors : core.minCompetitors;
  if (view.fit.selected.length < need || (stage === "core" && !view.fit.ok))
    return `Pick at least ${need} competitors whose whole English decks fit within ${core.imageCap} images (on the Competitors page).`;
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
    recommendationReviewer: secondOpinionOn(loaded.config, "recommendations")
      ? providerFor(m.recommendationReview, schemaDir)
      : null,
    onProgress,
  };
}
