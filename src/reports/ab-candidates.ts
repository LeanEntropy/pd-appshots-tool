import type { FitSummary, PatternFit } from "../analysis/pattern-fit.ts";
import { type TestVariable, VARIABLE_NAMES } from "../analysis/play-experiments.ts";

/**
 * A/B test candidates (plan-reports 3B.2, step 1), by code: every gap between our deck and the
 * competitors that the report's own data shows, each with an evidence id, its numbers, and its
 * conversion leverage. Pilot and Full check have one country; the per-country, localisation and
 * terminology gaps join here with the country reports.
 */
export interface Evidence {
  id: string;
  /** The pattern it comes from (e.g. "position-1", "deck-length"). */
  kind: string;
  /** The plain statement, with its numbers. */
  statement: string;
  n: number;
  of: number;
  unit: string;
  games: string[];
  countries: string[];
  /** Positions the evidence speaks about; empty = the whole deck. */
  positions: number[];
  imageIds: string[];
  /** Our positions that differ (where a test changes something). */
  ours: number[];
  variable: TestVariable;
  leverage: number;
}

/** What a visitor sees without scrolling matters most: positions 1 to 3 weigh 3, 2 and 1.5. */
export const positionWeight = (p: number) => (p === 1 ? 3 : p === 2 ? 2 : p === 3 ? 1.5 : 1);

/** Strength of the evidence: the share, discounted below 5 games or screenshots. */
export const evidenceStrength = (n: number, of: number) =>
  of > 0 ? (n / of) * Math.min(1, of / 5) : 0;

const GROUP_RANK: Record<PatternFit["group"], number> = {
  order: 0,
  content: 1,
  layer: 2,
  format: 3,
};

function variableOf(x: PatternFit, ourDeckLength: number, maxLength: number): TestVariable {
  if (x.id.startsWith("position-") || x.id.startsWith("uses-")) return "screenshot";
  if (x.id.startsWith("before-")) return "order";
  if (x.id === "deck-length") return ourDeckLength > maxLength ? "order" : "screenshot";
  if (x.id === "layer") return "text";
  return "composition";
}

/** The positions a test would change: ours that differ, else where the competitors do it. */
export function targetPositions(e: Pick<Evidence, "ours" | "positions">): number[] {
  if (e.ours.length) return e.ours;
  if (e.positions.length) return e.positions;
  return [1];
}

/**
 * Every pattern we do not fit, as evidence, most leverage first (ties: order, content, layer,
 * format). Leverage = the weight of the first position it changes x the strength of the evidence.
 */
export function abCandidates(
  fit: FitSummary | null,
  o: { gl: string; ourDeckLength: number; deckLength: { min: number; max: number } },
): Evidence[] {
  if (!fit) return [];
  const rows = fit.patterns
    .filter((x) => x.fits === false && x.basis && x.basis.of > 0)
    .map((x) => {
      const b = x.basis as NonNullable<PatternFit["basis"]>;
      let ours = b.ours;
      // A deck longer or shorter than every competitor's: the positions to drop, or one to add.
      if (x.id === "deck-length")
        ours =
          o.ourDeckLength > o.deckLength.max
            ? Array.from(
                { length: o.ourDeckLength - o.deckLength.max },
                (_, i) => o.deckLength.max + i + 1,
              )
            : [o.ourDeckLength + 1];
      const base = { ours, positions: b.positions };
      const first = Math.min(...targetPositions(base));
      return {
        x,
        e: {
          id: "",
          kind: x.id,
          statement: `${x.text} (${x.evidence}); ${x.reason}.`,
          n: b.n,
          of: b.of,
          unit: b.unit,
          games: b.games,
          countries: [o.gl],
          positions: b.positions,
          imageIds: b.imageIds,
          ours,
          variable: variableOf(x, o.ourDeckLength, o.deckLength.max),
          leverage: Math.round(positionWeight(first) * evidenceStrength(b.n, b.of) * 100) / 100,
        } satisfies Evidence,
      };
    });
  rows.sort(
    (a, b) =>
      b.e.leverage - a.e.leverage ||
      GROUP_RANK[a.x.group] - GROUP_RANK[b.x.group] ||
      a.x.id.localeCompare(b.x.id),
  );
  return rows.map((r, i) => ({ ...r.e, id: `E${i + 1}` }));
}

/** The positions a code-written test changes: the moved ones for an order test, else one. */
export function codeTestPositions(e: Evidence): number[] {
  const at = targetPositions(e);
  return e.variable === "order" ? at : at.slice(0, 1);
}

/** "3 of 4 games" */
export const nText = (e: Pick<Evidence, "n" | "of" | "unit">) => `${e.n} of ${e.of} ${e.unit}`;

/** A test written by code from one gap (no AI wording): used when fewer than 2 AI tests remain. */
export function codeTestText(e: Evidence): { title: string; hypothesis: string; variant: string } {
  const pattern = e.statement.split(" (")[0] ?? e.statement;
  const at = codeTestPositions(e);
  const where =
    e.kind === "deck-length"
      ? e.variable === "order"
        ? `leave out our screenshot${at.length > 1 ? "s" : ""} at position ${at.join(" and ")}; the others stay as they are`
        : `add one screenshot at the end (position ${at[0]}); the others stay as they are`
      : e.variable === "order"
        ? `reorder our screenshots (positions ${at.join(" and ")}); the images themselves stay the same`
        : e.variable === "screenshot"
          ? `change our screenshot at position ${at[0]}; everything else stays as it is`
          : `change ${VARIABLE_NAMES[e.variable]} of our screenshot at position ${at[0]} only`;
  return {
    title: `Gap worth testing: ${pattern}`,
    hypothesis: `Following "${pattern}" (${nText(e)}) should turn more store visitors into installs.`,
    variant: `Follow "${pattern}": ${where}.`,
  };
}
