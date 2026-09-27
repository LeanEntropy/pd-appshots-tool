import type { ImageAnalysis } from "./schema.ts";

/** Lowercase, drop punctuation and spacing, so "EPIC BOSS FIGHTS!" equals "Epic boss fights". */
export function normaliseText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] as number;
      prev[j] = Math.min(
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length] as number;
}

/** 1 = identical after normalising, 0 = nothing in common. */
export function textSimilarity(a: string, b: string): number {
  const x = normaliseText(a);
  const y = normaliseText(b);
  if (!x && !y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

export interface Comparison {
  /** Disagreements that need settling (screen type or headline). */
  disputes: string[];
  /** Smaller differences, recorded but not settled. */
  notes: string[];
}

export const HEADLINE_MIN_SIMILARITY = 0.85;

/** Compares two independent readings of the same image (both layers). */
export function compareReadings(a: ImageAnalysis, b: ImageAnalysis): Comparison {
  const disputes: string[] = [];
  const notes: string[] = [];
  const sa = a.screenshot;
  const sb = b.screenshot;
  const ma = a.marketingLayer;
  const mb = b.marketingLayer;
  if (sa.screenType !== sb.screenType)
    disputes.push(`screen type: ${sa.screenType} vs ${sb.screenType}`);
  else if (sa.subtype !== sb.subtype)
    notes.push(`subtype: ${sa.subtype || "none"} vs ${sb.subtype || "none"}`);
  if (sa.orientation !== sb.orientation)
    disputes.push(`orientation: ${sa.orientation} vs ${sb.orientation}`);
  if (ma.present !== mb.present)
    disputes.push(
      `marketing layer: ${ma.present ? "present" : "absent"} vs ${mb.present ? "present" : "absent"}`,
    );
  if (textSimilarity(a.headline, b.headline) < HEADLINE_MIN_SIMILARITY) {
    disputes.push(`headline: "${a.headline}" vs "${b.headline}"`);
  }
  const count = (label: string, x: number, y: number) => {
    if (x !== y) notes.push(`${label}: ${x} vs ${y}`);
  };
  count("background masks", ma.backgroundMasks.length, mb.backgroundMasks.length);
  count("texts", ma.texts.length, mb.texts.length);
  count("extra elements", ma.elements.length, mb.elements.length);
  if (Math.abs(sa.captureAreaPercent - sb.captureAreaPercent) > 25)
    notes.push(`screenshot area: ${sa.captureAreaPercent}% vs ${sb.captureAreaPercent}%`);
  if (Math.abs(ma.coveragePercent - mb.coveragePercent) > 25)
    notes.push(`marketing layer area: ${ma.coveragePercent}% vs ${mb.coveragePercent}%`);
  return { disputes, notes };
}
