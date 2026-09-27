import { hamming, NEAR_IDENTICAL_BITS } from "../store/identity.ts";

export type CostTier = "identical" | "layer-diff" | "full";

export interface TierInput {
  appId: string;
  gl: string;
  hl: string;
  position: number;
  imageId: string;
  phash: string;
}

export interface AnalysedImage {
  appId: string;
  imageId: string;
  phash: string;
  /** Market of the analysis; only baseline-language analyses anchor a layer diff. */
  baseline: boolean;
}

export interface TierResult extends TierInput {
  tier: CostTier;
  /** For identical and layer-diff: the image whose analysis is reused or diffed against. */
  basedOn: string | null;
  reason: string;
}

/**
 * Cost tier per image, cheapest first, decided by code only:
 * 1. identical: the same image (content hash) already has a usable analysis, or appears earlier
 *    in this plan (analysed once, reused);
 * 2. layer-diff: a non-baseline image whose picture is near-identical (perceptual hash) to an
 *    analysed baseline image of the same app. Provisional until the pilot's capture-match test;
 * 3. full: everything else.
 */
export function assignTiers(
  items: readonly TierInput[],
  analysed: readonly AnalysedImage[],
  isBaseline: (gl: string, hl: string) => boolean,
  maxBits = NEAR_IDENTICAL_BITS,
): TierResult[] {
  const done = new Set(analysed.map((a) => a.imageId));
  const planned = new Set<string>();
  return items.map((it) => {
    if (done.has(it.imageId)) {
      return { ...it, tier: "identical", basedOn: it.imageId, reason: "already analysed" };
    }
    if (planned.has(it.imageId)) {
      return {
        ...it,
        tier: "identical",
        basedOn: it.imageId,
        reason: "same image earlier in this batch",
      };
    }
    if (!isBaseline(it.gl, it.hl)) {
      const anchor = analysed.find(
        (a) => a.appId === it.appId && a.baseline && hamming(a.phash, it.phash) <= maxBits,
      );
      if (anchor) {
        return {
          ...it,
          tier: "layer-diff",
          basedOn: anchor.imageId,
          reason: "same picture as an analysed English image",
        };
      }
    }
    planned.add(it.imageId);
    return { ...it, tier: "full", basedOn: null, reason: "not analysed before" };
  });
}
