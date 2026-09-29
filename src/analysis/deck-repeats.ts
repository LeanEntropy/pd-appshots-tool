import type { ProjectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import { readSameScreen, type SameLevel, sameLevel, sameScreenKey } from "../store/same-screen.ts";
import { HEADLINE_MIN_SIMILARITY, textSimilarity } from "./compare.ts";
import { type AnalysisRecord, isUsable } from "./records.ts";

/**
 * The same screen uploaded twice in one deck (code only, free). A later position repeats an
 * earlier one when the pixel check confirmed the pair (store/same-screen.ts) and, when both have
 * analyses, their headlines agree. Runs are ordered repeats: "positions 7-12 repeat 1-6".
 */
export interface RepeatSlot {
  position: number;
  imageId: string;
  width: number;
  height: number;
}

export interface RepeatRun {
  from: number;
  to: number;
  ofFrom: number;
  ofTo: number;
}

export interface DeckRepeats {
  /** Images in the deck (analysed device classes) and distinct screens among them. */
  total: number;
  unique: number;
  /** Every repeated position and the earlier position it repeats (store order). */
  pairs: { position: number; of: number; imageId: string; ofImageId: string }[];
  runs: RepeatRun[];
  /** How the copies' size compares with the originals'. */
  size: "taller" | "wider" | "larger" | "smaller" | "same" | "other";
}

export type { SameLevel };
export type SameCheck = (a: string, b: string) => SameLevel;

const dims = (s: { width: number; height: number }) => `${s.width}x${s.height}`;

/**
 * The ordered runs the confirmed pairs of a deck point to: an offset k (copy = original + k) that
 * at least two confirmed pairs share, with the sizes of their originals and copies. A likely pair
 * at the same offset and sizes belongs to the same doubled set (pure).
 */
export function runOffsets(
  pairs: readonly { position: number; of: number }[],
  at: (position: number) => { width: number; height: number } | undefined,
): { k: number; sizes: Set<string> }[] {
  const by = new Map<number, Set<string>>();
  const n = new Map<number, number>();
  for (const p of pairs) {
    const k = p.position - p.of;
    const a = at(p.of);
    const b = at(p.position);
    if (!a || !b) continue;
    n.set(k, (n.get(k) ?? 0) + 1);
    by.set(k, (by.get(k) ?? new Set()).add(`${dims(a)}>${dims(b)}`));
  }
  return [...by].filter(([k]) => (n.get(k) ?? 0) >= 2).map(([k, sizes]) => ({ k, sizes }));
}

/**
 * The repeats of one deck in store order, or null when every screen appears once (pure). A pair
 * the check confirmed counts on its own; a likely one only when it continues an ordered run of
 * confirmed pairs (same distance and sizes), e.g. the 4th screen of a doubled set of 5.
 */
export function findRepeats(slots: readonly RepeatSlot[], same: SameCheck): DeckRepeats | null {
  const sorted = [...slots].sort((a, b) => a.position - b.position);
  const at = (n: number) => sorted.find((s) => s.position === n);
  const pairs: DeckRepeats["pairs"] = [];
  const copies = new Set<number>();
  const add = (of: RepeatSlot, s: RepeatSlot) => {
    copies.add(s.position);
    pairs.push({
      position: s.position,
      of: of.position,
      imageId: s.imageId,
      ofImageId: of.imageId,
    });
  };
  for (const [j, s] of sorted.entries()) {
    const of = sorted
      .slice(0, j)
      .find((o) => !copies.has(o.position) && same(o.imageId, s.imageId) === 2);
    if (of) add(of, s);
  }
  // A likely pair joins only next to a pair of the run (so the run grows without gaps).
  for (const run of runOffsets(pairs, at)) {
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of sorted) {
        const of = at(s.position - run.k);
        if (!of || copies.has(s.position) || copies.has(of.position)) continue;
        if (pairs.some((p) => p.of === s.position || p.of === of.position)) continue;
        const next = (p: { position: number; of: number }) =>
          p.position - p.of === run.k && Math.abs(p.position - s.position) === 1;
        if (!pairs.some(next) || !run.sizes.has(`${dims(of)}>${dims(s)}`)) continue;
        if (same(of.imageId, s.imageId) < 1) continue;
        add(of, s);
        grew = true;
      }
    }
  }
  if (!pairs.length) return null;
  pairs.sort((a, b) => a.position - b.position);
  const runs: RepeatRun[] = [];
  for (const p of pairs) {
    const last = runs.at(-1);
    if (last && p.position === last.to + 1 && p.of === last.ofTo + 1) {
      last.to = p.position;
      last.ofTo = p.of;
    } else runs.push({ from: p.position, to: p.position, ofFrom: p.of, ofTo: p.of });
  }
  const shape = (s: RepeatSlot | undefined) => (s?.height ? s.width / s.height : 0);
  const kinds = new Set(
    pairs.map((p) => {
      const a = at(p.of);
      const b = at(p.position);
      if (!a || !b) return "other";
      if (a.width === b.width && a.height === b.height) return "same";
      const d = shape(b) - shape(a);
      if (Math.abs(d) >= 0.01) return d < 0 ? "taller" : "wider";
      return b.width > a.width ? "larger" : "smaller";
    }),
  );
  const size = kinds.size === 1 ? ([...kinds][0] as DeckRepeats["size"]) : "other";
  return { total: sorted.length, unique: sorted.length - pairs.length, pairs, runs, size };
}

/** The repeats of every game of a plan (one country), from its items in store order. */
export function repeatsOfItems(
  items: readonly { appId: string; position: number; imageId: string }[],
  size: (imageId: string) => { width: number; height: number } | undefined,
  same: SameCheck,
): Map<string, DeckRepeats> {
  const out = new Map<string, DeckRepeats>();
  for (const appId of new Set(items.map((i) => i.appId))) {
    const slots = items.flatMap((i) => {
      const s = i.appId === appId ? size(i.imageId) : undefined;
      return s
        ? [{ position: i.position, imageId: i.imageId, width: s.width, height: s.height }]
        : [];
    });
    const r = findRepeats(slots, same);
    if (r) out.set(appId, r);
  }
  return out;
}

/** A repeated image of a plan: the earlier position (and image) of the same deck it repeats. */
export interface RepeatOf {
  position: number;
  imageId: string;
}

/**
 * The plan items that repeat an earlier screen of their deck, keyed "appId|position" (the
 * planner reuses the earlier image's analysis for them, free).
 */
export function repeatOfItems(
  items: readonly { appId: string; position: number; imageId: string }[],
  size: (imageId: string) => { width: number; height: number } | undefined,
  same: SameCheck,
): Map<string, RepeatOf> {
  const out = new Map<string, RepeatOf>();
  for (const [appId, r] of repeatsOfItems(items, size, same))
    for (const p of r.pairs)
      out.set(`${appId}|${p.position}`, { position: p.of, imageId: p.ofImageId });
  return out;
}

/** The planner's inputs, each repeated image with the earlier one of its deck (same game and country). */
export function withRepeatOf<
  T extends { appId: string; gl: string; position: number; imageId: string } & RepeatSlot,
>(items: readonly T[], same: SameCheck): (T & { repeatOf?: RepeatOf })[] {
  const of = new Map<string, RepeatOf>();
  for (const deck of new Set(items.map((i) => `${i.appId}|${i.gl}`))) {
    const r = findRepeats(
      items.filter((i) => `${i.appId}|${i.gl}` === deck),
      same,
    );
    for (const p of r?.pairs ?? [])
      of.set(`${deck}|${p.position}`, { position: p.of, imageId: p.ofImageId });
  }
  return items.map((i) => {
    const repeatOf = of.get(`${i.appId}|${i.gl}|${i.position}`);
    return repeatOf ? { ...i, repeatOf } : i;
  });
}

/** The approval screen's reason for a repeated image. */
export const repeatReason = (of: number) =>
  `same screen in another size (free): it repeats position ${of}, whose analysis is reused`;

const span = (a: number, b: number) => (a === b ? `${a}` : `${a}–${b}`);

/** "positions 7–12 repeat 1–6", "position 9 repeats 2" (one clause per run). */
export function runsText(r: DeckRepeats): string {
  return r.runs
    .map((x) =>
      x.from === x.to
        ? `position ${x.from} repeats ${x.ofFrom}`
        : `positions ${span(x.from, x.to)} repeat ${span(x.ofFrom, x.ofTo)}`,
    )
    .join("; ");
}

const SIZE_TEXT: Record<DeckRepeats["size"], string> = {
  taller: ", in a taller size",
  wider: ", in a wider size",
  larger: ", in a larger size",
  smaller: ", in a smaller size",
  same: ", at the same size",
  other: ", in another size",
};

/** "12 images, 6 unique". */
export const countText = (r: Pick<DeckRepeats, "total" | "unique">) =>
  `${r.total} images, ${r.unique} unique`;

/** Every screen shown exactly twice: "the same 6 screenshots twice". */
function whatText(r: DeckRepeats): string {
  const n = r.pairs.length;
  return n === r.unique
    ? `the same ${n} screenshots twice`
    : `${n} ${n === 1 ? "screenshot" : "screenshots"} twice`;
}

/** Our deck: the finding and what to do (one line, plain words, no country name). */
export function ourRepeatAction(r: DeckRepeats): string {
  const n = r.pairs.length;
  const second = n === r.unique ? "the second set" : n === 1 ? "the repeat" : "the repeats";
  const it = second === "the repeats" ? "them" : "it";
  return `Your store page shows ${whatText(r)} (${runsText(r)}${SIZE_TEXT[r.size]}). Remove ${second}, or replace ${it} with ${n} new ${n === 1 ? "screen" : "screens"}.`;
}

/** A competitor's deck: a fact for the notes and statistics (not a recommendation). */
export function theirRepeatNote(name: string, r: DeckRepeats): string {
  return `${name}: ${countText(r)}; the store page shows ${whatText(r)} (${runsText(r)}${SIZE_TEXT[r.size]}). Counted once.`;
}

/** The label of a repeated position in the position table. */
export const repeatLabel = (of: number, r: DeckRepeats) =>
  `Same screen as #${of}${SIZE_TEXT[r.size].replace(/^, /, " (")})`;

/**
 * The confirmed-pair check from the cached pixel checks (never computes) and, when both images
 * have analyses, their headlines: different headlines are never the same screen.
 */
export function sameCheck(
  paths: Pick<ProjectPaths, "projectId" | "library" | "workspace">,
  records?: ReadonlyMap<string, AnalysisRecord>,
): SameCheck {
  const storage = workspaceStorage(paths.workspace);
  const memo = new Map<string, SameLevel>();
  return (a, b) => {
    if (a === b) return 2;
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    const known = memo.get(k);
    if (known !== undefined) return known;
    let level = sameLevel(readSameScreen(storage, sameScreenKey(paths, a, b)));
    const ra = records?.get(a);
    const rb = records?.get(b);
    if (level && isUsable(ra) && isUsable(rb)) {
      const sim = textSimilarity(ra.final.headline, rb.final.headline);
      if (sim < HEADLINE_MIN_SIMILARITY) level = 0;
    }
    memo.set(k, level);
    return level;
  };
}
