import type { FitBasis, FitGroup, FitSummary, OverallVerdict, PatternFit } from "./pattern-fit.ts";
import { type DeckEntry, typeKey } from "./patterns.ts";

/** Helpers of the pattern check (pattern-fit.ts): strength, first positions, evidence, verdict. */
const GROUP_RANK: Record<FitGroup, number> = { order: 0, content: 1, layer: 2, format: 3 };

export function strengthOf(share: number): "pattern" | "partial" | null {
  return share >= 0.8 ? "pattern" : share >= 0.5 ? "partial" : null;
}

export function firstPositions(entries: readonly DeckEntry[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const e of entries) {
    const m = out.get(e.appId) ?? new Map<string, number>();
    const t = typeKey(e.final);
    if (!m.has(t) || (m.get(t) ?? 99) > e.position) m.set(t, e.position);
    out.set(e.appId, m);
  }
  return out;
}

/** The evidence behind a pattern: its numbers, games and competitor images. */
export function basisOf(
  hits: readonly DeckEntry[],
  n: number,
  of: number,
  unit: FitBasis["unit"],
  positions: number[],
): FitBasis {
  const games = [...new Set(hits.map((e) => e.name))];
  return { n, of, unit, positions, games, imageIds: hits.map((e) => e.imageId), ours: [] };
}

/** The verdict and key points of the pattern check (the engine's directives lead: engine/report.ts). */
export function summarise(patterns: PatternFit[], games: number): FitSummary {
  const judged = patterns.filter((x) => x.fits !== null);
  const w = (x: PatternFit) => (x.strength === "pattern" ? 2 : 1);
  const total = judged.reduce((n, x) => n + w(x), 0);
  const score = total ? judged.filter((x) => x.fits).reduce((n, x) => n + w(x), 0) / total : null;
  let verdict: OverallVerdict = "not enough data";
  if (games >= 2 && score !== null && judged.length >= 3)
    verdict =
      score >= 0.9
        ? "optimised"
        : score >= 0.75
          ? "on par"
          : score >= 0.6
            ? "slightly different"
            : score >= 0.4
              ? "relatively different"
              : "very different";
  const misses = patterns.filter((x) => x.fits === false);
  // Each finding once: "Uses X" adds nothing when a position already says X is missing there.
  const atPosition = new Set(
    misses.filter((x) => /^position-\d+$/.test(x.id)).flatMap((x) => x.categories ?? []),
  );
  const keyPoints = misses
    .filter((x) => !(x.id.startsWith("uses-") && atPosition.has(x.id.slice(5))))
    .sort((a, b) => w(b) - w(a) || GROUP_RANK[a.group] - GROUP_RANK[b.group])
    .slice(0, 6)
    .map((x) => `${x.text}: ${x.evidence}; ${x.reason}.`);
  const fit = judged.filter((x) => x.fits).reduce((n, x) => n + w(x), 0);
  return { patterns, verdict, score, keyPoints, points: { fit, total } };
}
