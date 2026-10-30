import type { Leaders } from "./leaders.ts";

/**
 * Signal strength from n of M unique games (plan 5.2), never images or repeated country rows.
 * Leaders confirm or cap; they never add votes.
 *
 * | unanimous   | n = M, M >= 3; or M = 2 with both leaders                 | directive |
 * | provisional | n = M = 2, not both leaders                               | directive, "provisional" |
 * | strong      | n/M >= 0.75, M >= 3, every leader does it                 | directive |
 * | majority    | n/M > 0.5, leaders not against                            | directive (positions 1-3: test first) |
 * | test        | otherwise (split, tie, leaders against)                   | test idea only |
 * | consider    | M = 1                                                     | "consider" only |
 */
export type Strength = "unanimous" | "provisional" | "strong" | "majority" | "test" | "consider";

export interface Game {
  appId: string;
  name: string;
}

export interface Evidence {
  n: number;
  M: number;
  /** Games that do it. */
  games: string[];
  /** Games that do not (or do something else). */
  others: string[];
  leaders: { n: number; of: number; on: boolean };
  imageIds: string[];
  /** Countries the evidence comes from (metadata), empty for screenshots of one country. */
  countries?: string[];
}

export function evidenceOf(
  doers: readonly Game[],
  all: readonly Game[],
  leaders: Leaders,
  imageIds: readonly string[] = [],
): Evidence {
  const ids = new Set(doers.map((g) => g.appId));
  const uniq = [...new Map(all.map((g) => [g.appId, g])).values()];
  return {
    n: uniq.filter((g) => ids.has(g.appId)).length,
    M: uniq.length,
    games: uniq.filter((g) => ids.has(g.appId)).map((g) => g.name),
    others: uniq.filter((g) => !ids.has(g.appId)).map((g) => g.name),
    leaders: {
      n: uniq.filter((g) => ids.has(g.appId) && leaders.ids.has(g.appId)).length,
      of: uniq.filter((g) => leaders.ids.has(g.appId)).length,
      on: leaders.on,
    },
    imageIds: [...imageIds],
  };
}

const agree = (e: Evidence) => !e.leaders.on || e.leaders.n === e.leaders.of;
const against = (e: Evidence) =>
  e.leaders.on && e.leaders.of > 0 && (e.leaders.of - e.leaders.n) * 2 > e.leaders.of;
const bothLeaders = (e: Evidence) => e.leaders.on && e.M === 2 && e.leaders.of === 2;

/** Strength of "n of M games do it". */
export function strengthOf(e: Evidence): Strength {
  const { n, M } = e;
  if (M <= 1) return M === 1 && n === 1 ? "consider" : "test";
  if (n === M) return M >= 3 || bothLeaders(e) ? "unanimous" : "provisional";
  if (n / M >= 0.75 && M >= 3 && agree(e)) return "strong";
  if (n / M > 0.5 && !against(e)) return "majority";
  return "test";
}

/** Strength of "0 of M games do it" (DROP evidence, D2): provisional unless both are leaders. */
export function dropStrength(e: Evidence): Strength {
  if (e.n !== 0 || e.M === 0) return "test";
  if (e.M === 1) return "consider";
  if (e.M >= 3 || bothLeaders(e)) return "unanimous";
  return "provisional";
}

/** Whether a signal of this strength is a directive at this position (majority at 1-3 is a test). */
export function isDirective(s: Strength, position?: number): boolean {
  if (s === "unanimous" || s === "provisional" || s === "strong") return true;
  return s === "majority" && !(position !== undefined && position >= 1 && position <= 3);
}

export const STRENGTH_WEIGHT: Record<Strength, number> = {
  unanimous: 1,
  provisional: 0.8,
  strong: 0.8,
  majority: 0.6,
  test: 0.3,
  consider: 0.2,
};

/** "2 of 2 games, both leaders" or "4 of 8 games, 0 of 2 leaders". */
export function evidenceText(e: Evidence, unit = "games"): string {
  const base = `${e.n} of ${e.M} ${unit}`;
  if (!e.leaders.on) return `${base} (no leader data)`;
  if (!e.leaders.of) return `${base}, none of them a leader`;
  if (e.leaders.of === 2 && e.leaders.n === 2) return `${base}, both leaders`;
  if (e.leaders.of === e.leaders.n) return `${base}, all ${e.leaders.of} leaders`;
  return `${base}, ${e.leaders.n} of ${e.leaders.of} leaders`;
}

/** Who, for the report: "Vita Mahjong, Mahjong Blast". */
export const whoText = (e: Evidence) => e.games.join(", ");
