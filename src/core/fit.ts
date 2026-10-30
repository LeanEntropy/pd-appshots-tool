import { medianLength } from "../play/screenshots.ts";

export interface FitCandidate {
  appId: string;
  name: string;
  /** Screenshots analysed from the core-market deck; 0 when the deck is missing or unavailable. */
  deckLength: number;
  /** Screenshots of the deck left out by device class (kept and shown raw, not analysed). */
  leftOut?: number;
}

export interface FitSkip {
  candidate: FitCandidate;
  reason: "no-deck" | "does-not-fit" | "max-reached";
}

export interface FitResult {
  ok: boolean;
  /** Fewer whole decks fit than the recommended minimum: the run is allowed, its report says so. */
  few: boolean;
  ourImages: number;
  selected: FitCandidate[];
  skipped: FitSkip[];
  total: number;
  cap: number;
  target: number;
  message: string;
}

export interface FitLimits {
  cap: number;
  target: number;
  /** Recommended, not required: below it the check still runs on a small sample. */
  minCompetitors: number;
  maxCompetitors: number;
}

/**
 * Whole-deck fit rule. Our deck counts first. Competitor decks are then added in the user's
 * order while the running total stays within the cap; a deck that would cross the cap is
 * skipped whole (never split) and the next one is tried. Stops at the maximum count.
 * Refuses (ok = false) only when no whole competitor deck fits. Fewer than the recommended
 * minimum is allowed and flagged (few = true).
 */
export function fitCore(
  ourImages: number,
  candidates: readonly FitCandidate[],
  lim: FitLimits,
): FitResult {
  const selected: FitCandidate[] = [];
  const skipped: FitSkip[] = [];
  let total = ourImages;
  for (const c of candidates) {
    if (selected.length >= lim.maxCompetitors)
      skipped.push({ candidate: c, reason: "max-reached" });
    else if (c.deckLength <= 0) skipped.push({ candidate: c, reason: "no-deck" });
    else if (total + c.deckLength > lim.cap) skipped.push({ candidate: c, reason: "does-not-fit" });
    else {
      selected.push(c);
      total += c.deckLength;
    }
  }
  const few = selected.length < lim.minCompetitors;
  const base = { ourImages, selected, skipped, total, cap: lim.cap, target: lim.target, few };
  if (ourImages > lim.cap) {
    return {
      ...base,
      ok: false,
      message: `Our own deck (${ourImages} images) is already above the cap of ${lim.cap}.`,
    };
  }
  if (selected.length === 0) {
    return {
      ...base,
      ok: false,
      message: `No whole competitor deck fits within ${lim.cap} images. Pick at least 1 competitor with an English deck.`,
    };
  }
  const vsTarget =
    total > lim.target ? `above the target of ${lim.target}` : `within the target of ${lim.target}`;
  return {
    ...base,
    ok: true,
    message: `${selected.length} competitor ${selected.length === 1 ? "deck" : "decks"} plus ours = ${total} images (${vsTarget}; hard stop ${lim.cap}).${few ? ` ${smallSample(selected.length, lim.minCompetitors)}` : ""}`,
  };
}

/** Slot count for the core check: the median deck length, capped (Play shows up to 8 phone shots). */
export function slotCount(deckLengths: readonly number[], cap: number): number {
  return Math.min(medianLength(deckLengths.filter((n) => n > 0)), cap);
}

/** The honest note for a check below the recommended number of competitors. */
export function smallSample(n: number, recommended: number): string {
  return `Only ${n} ${n === 1 ? "competitor" : "competitors"} (${recommended} or more recommended): the check runs, but its patterns rest on a small sample.`;
}
