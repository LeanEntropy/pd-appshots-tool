import { colourFamily } from "./colours.ts";
import type { Labeler } from "./labels.ts";
import { basisOf, firstPositions, strengthOf, summarise } from "./pattern-fit-parts.ts";
import { counts, type DeckEntry, type Patterns, proportion, typeKey } from "./patterns.ts";

/** Bump when the pattern check changes: the AI wording of its verdict is then rewritten. */
export const PATTERN_FIT_VERSION = "pattern-fit.v1";

export type FitGroup = "order" | "content" | "layer" | "format";

/** One pattern (or partial pattern) across competitors, and whether our deck fits it. */
export interface PatternFit {
  id: string;
  group: FitGroup;
  /** "pattern": (nearly) every competitor; "partial": at least half of them. */
  strength: "pattern" | "partial";
  text: string;
  evidence: string;
  /** null when it does not apply to our deck (e.g. we have no screenshot at that position). */
  fits: boolean | null;
  reason: string;
  /** The numbers behind it, for the A/B test evidence (absent in reports saved before it). */
  basis?: FitBasis;
}

/** n of `of` games, decks or screenshots; positions empty = the whole deck. */
export interface FitBasis {
  n: number;
  of: number;
  unit: "games" | "decks" | "screenshots";
  positions: number[];
  games: string[];
  imageIds: string[];
  /** Our positions that differ (where a test would change something). */
  ours: number[];
}

export type OverallVerdict =
  | "optimised"
  | "on par"
  | "slightly different"
  | "relatively different"
  | "very different"
  | "not enough data";

export interface FitSummary {
  patterns: PatternFit[];
  verdict: OverallVerdict;
  /** Share of weighted patterns we fit (patterns count twice as much as partial ones). */
  score: number | null;
  /** What to change first: the misfits, most important first. */
  keyPoints: string[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Deterministic pattern check: which competitor patterns our deck follows, and a verdict. */
export function patternFit(
  theirs: readonly DeckEntry[],
  ours: readonly DeckEntry[],
  p: Patterns,
  ourDeckLength: number,
  label: Labeler,
): FitSummary {
  const out: PatternFit[] = [];
  const games = new Set(theirs.map((e) => e.appId));
  const g = games.size;
  const add = (x: Omit<PatternFit, "strength"> & { share: number }) => {
    const strength = strengthOf(x.share);
    if (!strength) return;
    const { share: _s, ...rest } = x;
    out.push({ ...rest, strength });
  };
  const ourAt = (n: number) => ours.find((e) => e.position === n);

  // Order: the screen type at each position.
  for (const at of p.perPosition) {
    // A tie (e.g. one game each) is not a pattern.
    if (at.n < 2 || !at.top || at.types[1]?.share === at.top.share) continue;
    const mine = ourAt(at.position);
    const t = at.top.key;
    const hits = theirs.filter((e) => e.position === at.position && typeKey(e.final) === t);
    add({
      basis: {
        ...basisOf(hits, at.top.n, at.n, "screenshots", [at.position]),
        ours: mine && typeKey(mine.final) !== t ? [at.position] : [],
      },
      id: `position-${at.position}`,
      group: "order",
      share: at.top.share,
      text: `Position ${at.position} shows ${label(t)}`,
      evidence: `${pct(at.top.share)} of ${at.n} competitor screenshots at position ${at.position}`,
      fits: mine ? typeKey(mine.final) === t : null,
      reason: mine
        ? typeKey(mine.final) === t
          ? `ours is ${label(t)} too`
          : `ours shows ${label(typeKey(mine.final))}`
        : `our deck has no position ${at.position}`,
    });
  }
  // Order: one screen type before another, in every competitor deck that has both.
  const first = firstPositions(theirs);
  const oursFirst = firstPositions(ours).values().next().value ?? new Map<string, number>();
  const common = p.screenTypes.filter((t) => t.gameShare >= 0.5).map((t) => t.key);
  for (const a of common)
    for (const b of common) {
      if (a >= b) continue;
      const both = [...first.values()].filter((m) => m.has(a) && m.has(b));
      if (both.length < 2) continue;
      const aFirst = both.filter((m) => (m.get(a) ?? 0) < (m.get(b) ?? 0)).length;
      const [x, y] = aFirst === both.length ? [a, b] : aFirst === 0 ? [b, a] : [null, null];
      if (!x || !y) continue;
      const ox = oursFirst.get(x);
      const oy = oursFirst.get(y);
      const decks = [...first.entries()].filter(([, m]) => m.has(x) && m.has(y)).map(([a]) => a);
      const hits = theirs.filter(
        (e) =>
          decks.includes(e.appId) &&
          [first.get(e.appId)?.get(x), first.get(e.appId)?.get(y)].includes(e.position),
      );
      add({
        basis: {
          ...basisOf(hits, both.length, both.length, "decks", []),
          ours: ox !== undefined && oy !== undefined && ox > oy ? [oy, ox] : [],
        },
        id: `before-${x}-${y}`,
        group: "order",
        share: both.length / g,
        text: `${label(x)} comes before ${label(y)}`,
        evidence: `in all ${both.length} competitor decks that have both`,
        fits: ox !== undefined && oy !== undefined ? ox < oy : null,
        reason:
          ox !== undefined && oy !== undefined
            ? ox < oy
              ? `ours: ${label(x)} at ${ox}, ${label(y)} at ${oy}`
              : `ours has ${label(y)} first (position ${oy}), ${label(x)} at ${ox}`
            : `our deck does not have both`,
      });
    }
  // Content: screen types most competitors use.
  const ourTypes = new Set(ours.map((e) => typeKey(e.final)));
  for (const t of p.screenTypes)
    add({
      basis: basisOf(
        theirs.filter((e) => typeKey(e.final) === t.key),
        t.games,
        g,
        "games",
        t.positions,
      ),
      id: `uses-${t.key}`,
      group: "content",
      share: t.gameShare,
      text: `Uses ${label(t.key)}`,
      evidence: `${t.games} of ${g} competitors, at positions ${t.positions.join(", ")}`,
      fits: ourTypes.has(t.key),
      reason: ourTypes.has(t.key) ? "we use it too" : `we have no ${label(t.key)}`,
    });
  // Layer and format: image-level shares, ours judged by our own majority.
  const top = <T extends { key: string; share: number }>(cs: readonly T[]) => cs[0];
  const ourTop = (vals: (string | null)[]) => counts(vals)[0]?.key ?? null;
  const image = (
    id: string,
    group: FitGroup,
    what: string,
    c: { key: string; share: number } | undefined,
    mine: string | null,
    get: (e: DeckEntry) => string | null,
    name: (k: string) => string = (k) => k.replace(/_/g, " "),
  ) => {
    if (!c) return;
    const hits = theirs.filter((e) => get(e) === c.key);
    const counted = theirs.filter((e) => get(e) !== null).length;
    add({
      basis: {
        ...basisOf(hits, hits.length, counted, "screenshots", []),
        ours: ours.filter((e) => get(e) !== null && get(e) !== c.key).map((e) => e.position),
      },
      id,
      group,
      share: c.share,
      text: `${what}: ${name(c.key)}`,
      evidence: `${pct(c.share)} of competitor screenshots`,
      fits: mine === null ? null : mine === c.key,
      reason:
        mine === null
          ? "not measurable on our deck"
          : mine === c.key
            ? `ours: ${name(mine)} too`
            : `ours: mostly ${name(mine)}`,
    });
  };
  image(
    "orientation",
    "format",
    "Image orientation",
    top(p.orientation.canvas),
    ourTop(ours.map((e) => e.canvas)),
    (e) => e.canvas,
  );
  const layerShare = ours.length
    ? ours.filter((e) => e.final.marketingLayer.present).length / ours.length
    : 0;
  const layered = theirs.filter((e) => e.final.marketingLayer.present);
  add({
    basis: {
      ...basisOf(layered, layered.length, theirs.length, "screenshots", []),
      ours: ours.filter((e) => !e.final.marketingLayer.present).map((e) => e.position),
    },
    id: "layer",
    group: "layer",
    share: p.marketingLayer.share,
    text: "A marketing layer on the screenshots",
    evidence: `${pct(p.marketingLayer.share)} of competitor screenshots`,
    fits: ours.length ? layerShare >= 0.5 : null,
    reason: `ours: ${pct(layerShare)} of our screenshots`,
  });
  image(
    "layout",
    "layer",
    "Layout",
    top(p.proportion),
    ourTop(ours.map((e) => proportion(e.final))),
    (e) => proportion(e.final),
  );
  image(
    "mask-location",
    "layer",
    "Background mask position",
    top(p.maskLocations),
    ourTop(ours.map((e) => e.final.marketingLayer.backgroundMasks[0]?.location ?? null)),
    (e) => e.final.marketingLayer.backgroundMasks[0]?.location ?? null,
  );
  const theirColours = p.colours.layer.slice(0, 2).filter((c) => c.share >= 0.2);
  if (theirColours.length) {
    const mine = counts(
      ours.flatMap((e) =>
        e.final.marketingLayer.mainColours.slice(0, 2).map((c) => colourFamily(c.name, c.hex)),
      ),
    ).slice(0, 2);
    const hit = mine.some((m) => theirColours.some((c) => c.key === m.key));
    // Share of competitor layers whose main colours include one of these (each image once).
    const keys = new Set(theirColours.map((c) => c.key));
    const hasOne = (e: DeckEntry) =>
      e.final.marketingLayer.mainColours
        .slice(0, 2)
        .some((c) => keys.has(colourFamily(c.name, c.hex) ?? ""));
    const withOne = layered.filter(hasOne).length;
    add({
      basis: {
        ...basisOf(layered.filter(hasOne), withOne, layered.length, "screenshots", []),
        ours: ours
          .filter((e) => e.final.marketingLayer.present && !hasOne(e))
          .map((e) => e.position),
      },
      id: "layer-colours",
      group: "layer",
      share: layered.length ? withOne / layered.length : 0,
      text: `Marketing layer colours: mostly ${theirColours.map((c) => c.key).join(" and ")}`,
      evidence: `${withOne} of ${layered.length} competitor layers use one of them (${theirColours.map((c) => `${c.key} ${pct(c.share)}`).join(", ")} of layer colours)`,
      fits: mine.length ? hit : null,
      reason: mine.length
        ? `ours: mostly ${mine.map((m) => m.key).join(" and ")}`
        : "no layer colours on our deck",
    });
  }
  if (g >= 2) {
    const inRange = ourDeckLength >= p.deckLength.min && ourDeckLength <= p.deckLength.max;
    add({
      basis: { ...basisOf([], g, g, "games", []), games: p.games.map((x) => x.name) },
      id: "deck-length",
      group: "format",
      share: 1,
      text: `Deck length ${p.deckLength.min} to ${p.deckLength.max} screenshots`,
      evidence: `median ${p.deckLength.median}`,
      fits: inRange,
      reason: `ours has ${ourDeckLength}`,
    });
  }
  return summarise(out, g);
}
