import { counts, type DeckEntry } from "../analysis/patterns.ts";
import { type Kind, kindOf } from "./kinds.ts";
import type { Leaders } from "./leaders.ts";
import type { Game } from "./strength.ts";

/** What every rule reads (built once by engine.ts). */
export interface EngineCtx {
  theirs: readonly DeckEntry[];
  ours: readonly DeckEntry[];
  /** Competitor games with at least one analysed phone image (tablet sets are ignored, D7). */
  games: readonly Game[];
  /** Each competitor's deck length (each screen once). */
  deckLengths: ReadonlyMap<string, number>;
  ourDeckLength: number;
  leaders: Leaders;
  /** Our deck's main orientation (the play orientation of our images). */
  ourCanvas: string;
}

/** A position reached by fewer games never produces a directive (plan 5.2, small samples). */
export const MIN_GAMES = 2;

/** One image per game at a position (the first, when a deck repeats). */
export function perGame(theirs: readonly DeckEntry[], position: number): DeckEntry[] {
  const seen = new Set<string>();
  return theirs.filter((e) => e.position === position && !seen.has(e.appId) && !!seen.add(e.appId));
}

export const gameOf = (e: Pick<DeckEntry, "appId" | "name">): Game => ({
  appId: e.appId,
  name: e.name,
});

export const kindKey = (e: DeckEntry): Kind => kindOf(e).kind;

/** The most common value among `es`, with the entries that have it; ties broken by leaders. */
export function dominantBy<T extends string>(
  es: readonly DeckEntry[],
  key: (e: DeckEntry) => T | null | undefined,
  leaders: Leaders,
): { key: T; doers: DeckEntry[]; tie: boolean } | null {
  const c = counts(es.map((e) => key(e) ?? null));
  const first = c[0];
  if (!first) return null;
  const tied = c.filter((x) => x.n === first.n);
  let pick = first;
  if (tied.length > 1) {
    // A tie is broken only when every leader at this place shows the same value.
    const lead = es.filter((e) => leaders.ids.has(e.appId)).map((e) => key(e));
    const one = lead.length && lead.every((k) => k === lead[0]) ? lead[0] : null;
    const hit = tied.find((x) => x.key === one);
    if (!hit)
      return { key: first.key as T, doers: es.filter((e) => key(e) === first.key), tie: true };
    pick = hit;
  }
  return { key: pick.key as T, doers: es.filter((e) => key(e) === pick.key), tie: false };
}

/** Each competitor's first position of a kind. */
export function firstPositions(theirs: readonly DeckEntry[], kind: Kind): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of theirs)
    if (kindKey(e) === kind && (out.get(e.appId) ?? 99) > e.position) out.set(e.appId, e.position);
  return out;
}
