import type { Config, Market } from "../config/schema.ts";
import { mainMarket } from "../core/targets.ts";
import { AI_STEPS, type AiStep, type Options, type TrafficLevel } from "./schema.ts";

export interface StepSettings {
  /** Model reference, e.g. "claude:claude-opus-5-5". */
  model: string;
  /** The second-opinion model (the other family). */
  reviewer: string;
  secondOpinion: boolean;
  /** Reads images (a model change then means re-analysis) or text only. */
  perImage: boolean;
}

/** Everything the Settings page controls, in one typed view for the rest of the pipeline. */
export interface ToolSettings {
  mainMarket: Market;
  steps: Record<AiStep, StepSettings>;
  earlyStop: { minDecks: number; window: number; maxShareShift: number };
  spending: { perBatchUsd: number; perReportUsd: number };
  coreSize: { target: number; cap: number };
  suggestions: Options["suggestions"];
  /** Store visitors per month in a country; "unknown" counts as low for the A/B tests. */
  traffic: (gl: string) => TrafficLevel;
  pdf: Options["pdf"];
}

/**
 * Is a step's second opinion on? The screenshot one is the older review coverage (the user
 * paused it by setting coverage to 0); the text steps have their own switches. The config's
 * review.enabled stays a master switch for all of them.
 */
export function secondOpinionOn(config: Config, step: AiStep): boolean {
  const r = config.review;
  if (!r.enabled) return false;
  if (step === "screenshotAnalysis") return r.coreCoverage > 0 || r.expansionCoverage > 0;
  return config.options.secondOpinion[step];
}

function stepSettings(config: Config, step: AiStep): StepSettings {
  const m = config.models;
  const o = config.options.models;
  const on = secondOpinionOn(config, step);
  switch (step) {
    case "screenshotAnalysis":
      return { model: m.fullAnalysis, reviewer: m.imageReview, secondOpinion: on, perImage: true };
    case "textLayer":
      return { model: m.layerDiff, reviewer: m.imageReview, secondOpinion: on, perImage: true };
    case "patterns":
    case "recommendations":
      // One writer does the pattern wording and the recommendations today.
      return {
        model: m.recommend,
        reviewer: m.recommendationReview,
        secondOpinion: on,
        perImage: false,
      };
    default:
      return {
        model: o[step],
        reviewer: m.recommendationReview,
        secondOpinion: on,
        perImage: false,
      };
  }
}

/** The one accessor of the Settings page's values (plan-reports 5B). */
export function settingsOf(config: Config): ToolSettings {
  const steps = Object.fromEntries(AI_STEPS.map((s) => [s, stepSettings(config, s)])) as Record<
    AiStep,
    StepSettings
  >;
  const o = config.options;
  return {
    mainMarket: mainMarket(config),
    steps,
    earlyStop: { ...config.core.stability },
    spending: {
      perBatchUsd: config.budget.maxUsdPerIncrement,
      perReportUsd: o.spending.maxUsdPerReport,
    },
    coreSize: { target: config.core.imageTarget, cap: config.core.imageCap },
    suggestions: { ...o.suggestions },
    traffic: (gl) => o.traffic[gl] ?? "unknown",
    pdf: { ...o.pdf },
  };
}
