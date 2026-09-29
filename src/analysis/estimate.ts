import type { Config } from "../config/schema.ts";
import { LAYOUT_USD_PER_IMAGE } from "../layout/vocab.ts";
import { secondOpinionOn } from "../settings/access.ts";
import type { TierResult } from "./tiers.ts";

export interface ModelPasses {
  role: string;
  model: string;
  calls: number;
  images: number;
  note: string;
}

export interface Estimate {
  passes: ModelPasses[];
  usd: [number, number];
  gptTokens: number;
  expectedDisputes: number;
}

const chunks = (n: number, size: number) => Math.ceil(n / size);
const modelName = (ref: string) => ref.split(":")[1] ?? ref;

/**
 * Model passes and provisional cost for a batch. Full analyses and reviews go one deck per call
 * (up to imagesPerCall images); disputes go to the adjudicator. Retries are an allowance.
 */
export function estimate(
  config: Config,
  items: readonly TierResult[],
  synthesis = false,
): Estimate {
  const e = config.estimates;
  const byApp = new Map<string, TierResult[]>();
  for (const it of items) byApp.set(it.appId, [...(byApp.get(it.appId) ?? []), it]);
  let fullCalls = 0;
  let diffCalls = 0;
  let reviewCalls = 0;
  let reviewImages = 0;
  for (const list of byApp.values()) {
    const full = list.filter((i) => i.tier === "full").length;
    const diff = list.filter((i) => i.tier === "layer-diff").length;
    fullCalls += chunks(full, e.imagesPerCall);
    diffCalls += chunks(diff, e.imagesPerCall);
    if (config.review.enabled) {
      const n =
        Math.ceil(full * config.review.coreCoverage) +
        Math.ceil(diff * config.review.expansionCoverage);
      reviewImages += n;
      reviewCalls += chunks(n, e.imagesPerCall);
    }
  }
  const full = items.filter((i) => i.tier === "full").length;
  const diff = items.filter((i) => i.tier === "layer-diff").length;
  const disputes = config.review.enabled ? Math.ceil(reviewImages * e.expectedDisputeRate) : 0;
  const adjCalls = Math.min(disputes, byApp.size);
  const allowance = 1 + e.retryAllowance;
  // The layout breakdown: its own call after each new full analysis (Settings switch).
  const layout = config.options.speed.layoutCapture ? full : 0;
  const usd: [number, number] = [0, 1].map((k) => {
    const fa =
      full * (e.fullAnalysisUsdPerImage[k] as number) +
      layout * (LAYOUT_USD_PER_IMAGE[k] as number);
    const ld = diff * (e.layerDiffUsdPerImage[k] as number);
    // Synthesis covers the pattern wording, recommendations, check and revision; the A/B tests
    // are one more call of about a quarter of that (a retry at most doubles it).
    const s = e.synthesisUsd[k] as number;
    const syn = synthesis ? s + (k === 0 ? s / 4 : s / 2) : 0;
    return (
      Math.round(((fa + ld) * allowance + disputes * e.adjudicationUsdPerDispute + syn) * 100) / 100
    );
  }) as [number, number];
  const passes: ModelPasses[] = [
    {
      role: "Full screenshot analysis",
      model: modelName(config.models.fullAnalysis),
      calls: fullCalls,
      images: full,
      note: `one call per deck, up to ${e.imagesPerCall} images`,
    },
    {
      role: "Marketing-layer diff",
      model: modelName(config.models.layerDiff),
      calls: diffCalls,
      images: diff,
      note: "cropped text and band regions only",
    },
    {
      role: "Second opinion (cross-check)",
      model: modelName(config.models.imageReview),
      calls: reviewCalls,
      images: reviewImages,
      note: config.review.enabled ? "blind, every analysed image" : "turned off",
    },
    {
      role: "Settling disagreements",
      model: modelName(config.models.adjudicate),
      calls: adjCalls,
      images: disputes,
      note: `estimate: ${Math.round(e.expectedDisputeRate * 100)}% of cross-checked images`,
    },
    ...(layout
      ? [
          {
            role: "Layout breakdown (wireframe)",
            model: modelName(config.models.fullAnalysis),
            calls: layout,
            images: layout,
            note: `its own call after each new analysis, about $${LAYOUT_USD_PER_IMAGE[0].toFixed(2)} to $${LAYOUT_USD_PER_IMAGE[1].toFixed(2)} per image`,
          },
        ]
      : []),
  ];
  if (synthesis) {
    const rec = modelName(config.models.recommend);
    const recReview = secondOpinionOn(config, "recommendations");
    passes.push(
      {
        role: "Pattern summary",
        model: rec,
        calls: 1,
        images: 0,
        note: "text only, from the computed patterns",
      },
      {
        role: "Recommendations",
        model: rec,
        calls: 1,
        images: 0,
        note: "text only; one revision if the check finds major problems",
      },
      {
        role: "Recommendation check",
        model: modelName(config.models.recommendationReview),
        calls: recReview ? 1 : 0,
        images: 0,
        note: recReview ? "cross-family review" : "turned off",
      },
      {
        role: "A/B tests to run next",
        model: modelName(config.options.models.abTests),
        calls: 1,
        images: 0,
        note: "text only; one retry if a test fails the checks",
      },
    );
  }
  return {
    passes,
    usd,
    gptTokens: reviewImages * e.reviewTokensPerImage,
    expectedDisputes: disputes,
  };
}
