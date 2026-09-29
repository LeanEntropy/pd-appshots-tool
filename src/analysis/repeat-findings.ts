import {
  type DeckRepeats,
  findRepeats,
  ourRepeatAction,
  type RepeatSlot,
  repeatLabel,
  type SameCheck,
  theirRepeatNote,
} from "./deck-repeats.ts";
import type { GameOrder, ReportData } from "./report-data.ts";

/** One deck of a report that shows the same screen twice (saved with the report data). */
export interface RepeatFinding {
  appId: string;
  name: string;
  ours: boolean;
  total: number;
  unique: number;
  /** Ours: the finding and what to do. Competitors: the fact, for the notes and statistics. */
  text: string;
  /** False in a version built before the check: its patterns still count every image. */
  counted: boolean;
}

const OLD_COUNT =
  "This version was built before the check and counts every image; build a new version to count each screen once.";

/**
 * Adds the "same screen uploaded twice" findings to a report's data (pure, idempotent): the
 * repeated rows say which position they repeat, our deck's finding becomes the first key point and
 * leads the short answer, and every deck gets a note. `counted`: the patterns, deck lengths and
 * position table of this data already count each screen once (a fresh build).
 */
export function withRepeatFindings(
  d: ReportData,
  repeats: ReadonlyMap<string, DeckRepeats>,
  counted: boolean,
): ReportData {
  if (d.repeats || !repeats.size) return d;
  const found: RepeatFinding[] = [];
  const games: GameOrder[] = d.games.map((g) => {
    const r = repeats.get(g.appId);
    if (!r) return g;
    const text = g.ours ? ourRepeatAction(r) : theirRepeatNote(g.name, r);
    found.push({
      appId: g.appId,
      name: g.name,
      ours: g.ours,
      total: r.total,
      unique: r.unique,
      text,
      counted,
    });
    return {
      ...g,
      rows: g.rows.map((row) => {
        const p = r.pairs.find((x) => x.position === row.position);
        if (!p) return row;
        const of = g.rows.find((x) => x.position === p.of);
        return {
          ...row,
          repeatOf: p.of,
          screen: repeatLabel(p.of, r),
          headline: of?.headline ?? row.headline,
        };
      }),
    };
  });
  if (!found.length) return d;
  const ours = found.find((f) => f.ours);
  if (!ours) return { ...d, games, repeats: found };
  const lead = counted ? ours.text : `${ours.text} ${OLD_COUNT}`;
  const fit = d.fit ? { ...d.fit, keyPoints: [ours.text, ...d.fit.keyPoints] } : d.fit;
  // AI wording of the key points stays in use when it matched them one to one.
  const i = d.ai?.interpretation;
  const ai =
    d.ai && i?.keyPoints && d.fit && i.keyPoints.length === d.fit.keyPoints.length
      ? { ...d.ai, interpretation: { ...i, keyPoints: [ours.text, ...i.keyPoints] } }
      : d.ai;
  const summary = d.summary
    ? { ...d.summary, shortAnswer: `${lead} ${d.summary.shortAnswer}` }
    : d.summary;
  return { ...d, games, fit, ai, summary, repeats: found };
}

/** The repeats of every game of saved report data, from its rows (the store order it showed). */
export function repeatsOfData(
  d: Pick<ReportData, "games">,
  size: (imageId: string) => { width: number; height: number } | undefined,
  same: SameCheck,
): Map<string, DeckRepeats> {
  const out = new Map<string, DeckRepeats>();
  for (const g of d.games) {
    const slots: RepeatSlot[] = g.rows.flatMap((row) => {
      const s = row.imageId && row.state !== "excluded" ? size(row.imageId) : undefined;
      return s && row.imageId ? [{ position: row.position, imageId: row.imageId, ...s }] : [];
    });
    const r = findRepeats(slots, same);
    if (r) out.set(g.appId, r);
  }
  return out;
}

export type { DeckRepeats };
