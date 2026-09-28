import { fitProblem } from "../analysis/job.ts";
import { analysisKey, currentPipeline } from "../analysis/pipeline.ts";
import { buildAnalysisPlan, type Stage } from "../analysis/plan.ts";
import { configHash, type LoadedConfig } from "../config/load.ts";
import type { Config } from "../config/schema.ts";
import { mainMarket } from "../core/targets.ts";
import { secondOpinionOn } from "./access.ts";
import { AI_STEPS, modelName, STEP_LABELS } from "./schema.ts";

/**
 * What a settings change will cost, shown before it is saved (plan-reports 5B): a new model or
 * second-opinion setting for screenshots means the saved analyses are not reused; a new main
 * country moves the Pilot and the Full check; a second opinion switched on costs per use.
 * Counted by the same planner as the approval screen (code only, no AI).
 */
export interface Consequence {
  text: string;
  images?: number;
  usd?: [number, number];
}

export const usdRange = ([lo, hi]: readonly [number, number] | readonly number[]) =>
  lo === hi ? `$${(lo ?? 0).toFixed(2)}` : `$${(lo ?? 0).toFixed(2)} to $${(hi ?? 0).toFixed(2)}`;

interface Work {
  stage: Stage;
  images: number;
  usd: [number, number];
}

/** The images the next Full check (else the Pilot) would analyse, and its cost; null if none can run. */
function nextWork(loaded: LoadedConfig): Work | null {
  for (const stage of ["core", "pilot"] as const) {
    try {
      if (fitProblem(loaded, stage)) continue;
      const p = buildAnalysisPlan(loaded, stage);
      return { stage, images: p.counts.newImages, usd: p.estimate.usd };
    } catch {}
  }
  return null;
}

const STAGE_NAME: Record<Stage, string> = { core: "the Full check", pilot: "the Pilot" };
const round = (n: number) => Math.max(0, Math.round(n * 100) / 100);

/** The same project with other settings (nothing is written). */
export function withConfig(loaded: LoadedConfig, config: Config): LoadedConfig {
  return { ...loaded, config, hash: configHash(config) };
}

/** Text steps' cost per use: the batch's text-only estimate covers about four calls. */
export function textUsdPerUse(c: Config): [number, number] {
  const [lo, hi] = c.estimates.synthesisUsd;
  return [round(lo / 4), round(hi / 4)];
}

export function consequences(loaded: LoadedConfig, after: Config): Consequence[] {
  const before = loaded.config;
  const out: Consequence[] = [];
  const oldMain = mainMarket(before);
  const newMain = mainMarket(after);
  const keyChanged = analysisKey(currentPipeline(before)) !== analysisKey(currentPipeline(after));
  const moved = oldMain.gl !== newMain.gl;
  if (keyChanged || moved) {
    const now = nextWork(loaded);
    const next = nextWork(withConfig(loaded, after));
    const extra = now && next && now.stage === next.stage ? next.images - now.images : null;
    const usd: [number, number] | null =
      now && next ? [round(next.usd[0] - now.usd[0]), round(next.usd[1] - now.usd[1])] : null;
    const cost =
      next && extra !== null && usd
        ? `: ${extra} ${extra === 1 ? "image" : "images"} would be analysed again (about ${usdRange(usd)}) the next time you run ${STAGE_NAME[next.stage]}`
        : "";
    if (moved)
      out.push({
        text:
          `The Pilot and the Full check will be for ${newMain.label} from now on. Your ${oldMain.label} reports stay as they are. ` +
          (next
            ? `Running ${STAGE_NAME[next.stage]} there would analyse ${next.images} images (about ${usdRange(next.usd)}).`
            : `Its store pages must be downloaded and its competitors picked before a check can run there; the approval screen then shows the cost.`),
        ...(next ? { images: next.images, usd: next.usd } : {}),
      });
    // This project keeps its own earlier analyses; only analyses shared by other projects under
    // the old settings stop being reused. Nothing to say when that is no image at all.
    else if (extra === null || !usd)
      out.push({
        text: "Screenshots analysed with the old settings by other projects are not reused, so some may be analysed again the next time you run a check. Its approval screen shows the exact count and cost.",
      });
    else if (extra > 0)
      out.push({
        text: `Screenshots analysed with the old settings are not reused${cost}.`,
        images: extra,
        usd,
      });
  }
  for (const step of AI_STEPS) {
    if (secondOpinionOn(before, step) || !secondOpinionOn(after, step)) continue;
    const perImage = step === "screenshotAnalysis" || step === "textLayer";
    const reviewer = perImage ? after.models.imageReview : after.models.recommendationReview;
    const usd = perImage
      ? step === "textLayer"
        ? after.estimates.layerDiffUsdPerImage
        : after.estimates.fullAnalysisUsdPerImage
      : textUsdPerUse(after);
    out.push({
      text: `A second opinion on ${STEP_LABELS[step].toLowerCase()} by ${modelName(reviewer)} costs about ${usdRange(usd)} per ${perImage ? "image" : "use"}. It is part of the next approval.`,
    });
  }
  return out;
}
