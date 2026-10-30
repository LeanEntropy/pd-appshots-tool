import { latestStoreText, type StoreSnapshot } from "../library/store-text.ts";
import type { Storage } from "../storage/index.ts";
import { splitStoreTitle } from "./brand.ts";
import { allKeys, deriveKeywords, phrases } from "./keywords.ts";

/**
 * Store text per country, for the grid's "Store" (i) and the report's "Store text and keywords"
 * section. By code, from the saved snapshots; the keywords are derived from the store text
 * (Google Play has no official keywords).
 */
export interface Market {
  gl: string;
  hl: string;
  label: string;
}

/** One game's store page in one country, as shown to the user. */
export interface StoreTextView {
  gl: string;
  hl: string;
  label: string;
  /** The day the page was read. */
  date: string;
  category: string | null;
  /** The first tag chip, when it names another category than the genre (e.g. Survivor.io). */
  chipCategory: string | null;
  tags: string[];
  keywords: string[];
  title: string | null;
  /**
   * A two-part title's second part ("Game - ASO words"): keyword data, not the game's name
   * (user, 2026-09-28). Absent in reports saved before 2026-09-29.
   */
  titleKeywords?: string | null;
  shortDescription: string | null;
  contentRating: string | null;
  /** Label of an earlier country with exactly the same store text (folded in the page). */
  sameAs: string | null;
}

/** Number of derived keywords shown per game and country. */
export const SHOWN = 10;

function view(s: StoreSnapshot, m: Market, sameAs: string | null): StoreTextView {
  const o = s.official;
  const first = o.chips[0];
  const firstIsCategory = !!first?.id;
  const chipCategory = firstIsCategory && first.id !== o.genre.id ? (first?.name ?? null) : null;
  return {
    gl: m.gl,
    hl: m.hl,
    label: m.label,
    date: s.date,
    category: o.genre.name ?? o.genre.id,
    chipCategory,
    tags: o.chips.slice(firstIsCategory ? 1 : 0).map((c) => c.name),
    keywords: s.derived.keywords.slice(0, SHOWN).map((k) => k.term),
    title: o.title,
    titleKeywords: o.title ? splitStoreTitle(o.title).keywords : null,
    shortDescription: o.shortDescription,
    contentRating: o.contentRating,
    sameAs,
  };
}

/** One game's saved store text in each of the project's countries (countries with none left out). */
export function storeTextViews(
  storage: Storage,
  appId: string,
  markets: readonly Market[],
): StoreTextView[] {
  const seen = new Map<string, string>();
  const out: StoreTextView[] = [];
  for (const m of markets) {
    const s = latestStoreText(storage, appId, m.gl, m.hl);
    if (!s) continue;
    out.push(view(s, m, seen.get(s.textHash) ?? null));
    if (!seen.has(s.textHash)) seen.set(s.textHash, m.label);
  }
  return out;
}

export interface StoreRow {
  appId: string;
  name: string;
  ours: boolean;
  store: StoreTextView | null;
}

export interface StoreCountry {
  gl: string;
  hl: string;
  label: string;
  rows: StoreRow[];
  /** Saved for our game in this country (else there is nothing to compare against). */
  oursSaved: boolean;
  /** Competitor keywords (in the top 30 of at least 2 competitors) not found in our store text. */
  missing: { term: string; games: string[] }[];
}

/** Keywords competitors use that do not occur (exact words) anywhere in our store text. */
function missingTerms(
  ours: StoreSnapshot,
  theirs: { name: string; snap: StoreSnapshot }[],
  hl: string,
) {
  const have = allKeys(ours.official, hl);
  // Tag names are compared as tags (engine/rules-meta.ts), never as keyword gaps.
  const tags = new Set(
    [ours, ...theirs.map((t) => t.snap)].flatMap((s) =>
      s.official.chips.flatMap((c) => [...phrases(c.name, hl).keys()]),
    ),
  );
  const by = new Map<string, { term: string; games: string[]; score: number }>();
  for (const t of theirs)
    for (const k of deriveKeywords(t.snap.official, hl)) {
      if (have.has(k.key) || tags.has(k.key)) continue;
      const e = by.get(k.key) ?? { term: k.term, games: [], score: 0 };
      if (!e.games.includes(t.name)) e.games.push(t.name);
      e.score += k.score;
      by.set(k.key, e);
    }
  return [...by.values()]
    .filter((e) => e.games.length >= 2)
    .sort(
      (a, b) => b.games.length - a.games.length || b.score - a.score || (a.term < b.term ? -1 : 1),
    )
    .slice(0, 15)
    .map(({ term, games }) => ({ term, games }));
}

/**
 * Our game against the competitors, per country: category, tags and top derived keywords, and
 * the competitor keywords our store text does not use. Countries where nothing is saved are
 * left out.
 */
export function compareStoreText(
  storage: Storage,
  markets: readonly Market[],
  ours: { appId: string; name: string },
  competitors: readonly { appId: string; name: string }[],
): StoreCountry[] {
  const out: StoreCountry[] = [];
  for (const m of markets) {
    const snaps = [ours, ...competitors].map((g) => ({
      g,
      snap: latestStoreText(storage, g.appId, m.gl, m.hl),
    }));
    if (!snaps.some((x) => x.snap)) continue;
    const oursSnap = snaps[0]?.snap;
    const theirs = snaps
      .slice(1)
      .flatMap((x) => (x.snap ? [{ name: x.g.name, snap: x.snap }] : []));
    out.push({
      gl: m.gl,
      hl: m.hl,
      label: m.label,
      rows: snaps.map((x, i) => ({
        appId: x.g.appId,
        name: x.g.name,
        ours: i === 0,
        store: x.snap ? view(x.snap, m, null) : null,
      })),
      oursSaved: !!oursSnap,
      missing: oursSnap ? missingTerms(oursSnap, theirs, m.hl) : [],
    });
  }
  return out;
}
