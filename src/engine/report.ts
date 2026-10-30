import type { BatchEntries } from "../analysis/entries.ts";
import type { FitSummary } from "../analysis/pattern-fit.ts";
import type { DeckEntry } from "../analysis/patterns.ts";
import type { Recommendations } from "../analysis/synthesis-schema.ts";
import { isFirm } from "./directives.ts";
import { type EngineInput, type EngineResult, runEngine } from "./engine.ts";
import type { GameMarket } from "./leaders.ts";
import { claimProblems, recTexts, skeletonProblems } from "./validate.ts";

/** The engine for one report's entries (pure). */
export function engineOf(
  entries: Pick<BatchEntries, "ours" | "competitors" | "decks" | "ourDeckLength">,
  market: readonly GameMarket[],
  meta?: EngineInput["meta"],
): EngineResult {
  const ids = new Set(entries.competitors.map((e) => e.appId));
  return runEngine({
    theirs: entries.competitors,
    ours: entries.ours,
    decks: entries.decks,
    ourDeckLength: entries.ourDeckLength,
    market: market.filter((g) => ids.has(g.appId)),
    ...(meta ? { meta } : {}),
  });
}

/**
 * The pattern check with the engine's verdict (plan 5.3: from the directives, never from the
 * weighted points, which stay as a detail) and the firm directives as its first key points.
 */
export function withEngine(fit: FitSummary, engine: EngineResult): FitSummary {
  const firm = engine.directives.filter(isFirm);
  const directed = new Set(firm.flatMap((d) => d.positions.map((p) => `Image ${p}`)));
  const rest = fit.keyPoints.filter((k) => ![...directed].some((d) => k.startsWith(d)));
  return {
    ...fit,
    verdict: engine.verdict.word,
    keyPoints: [...firm.slice(0, 6).map((d) => d.text), ...rest].slice(0, 8),
  };
}

/** The AI recommendations checked against the skeleton and the counts (shown in the report). */
export function engineRecProblems(
  r: Recommendations,
  engine: EngineResult,
  ours: readonly DeckEntry[],
): string[] {
  return [
    ...skeletonProblems(r, engine, ours[0]?.canvas ?? "portrait"),
    ...claimProblems(recTexts(r), engine.claims),
  ];
}
