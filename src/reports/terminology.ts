import type { ConceptMap } from "../analysis/concept-map-schema.ts";
import type { ImageAnalysis } from "../analysis/schema.ts";
import { latestStoreText } from "../library/store-text.ts";
import type { Storage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";
import { countryName } from "./names.ts";
import {
  cleanText,
  countTerms,
  type TermCount,
  type TextItem,
  type TextSource,
} from "./terminology-count.ts";

export type { TextItem, TextSource } from "./terminology-count.ts";

/**
 * Words used, per country (plan-reports 3A): the text set per language, and the tables of which
 * local words each game uses for the same ideas, counted by code from the AI's concept map.
 */

export function imageTextItems(
  entries: readonly {
    appId: string;
    name: string;
    ours: boolean;
    position: number;
    final: ImageAnalysis;
  }[],
): TextItem[] {
  const out: TextItem[] = [];
  for (const e of entries) {
    const seen = new Set<string>();
    for (const t of [...e.final.marketingLayer.texts.map((x) => x.text), e.final.headline]) {
      const text = cleanText(t);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push({
        appId: e.appId,
        game: e.name,
        ours: e.ours,
        source: "image",
        position: e.position,
        text,
      });
    }
  }
  return out;
}

export function storeTextItems(
  storage: Storage,
  games: readonly { appId: string; name: string; ours: boolean }[],
  gl: string,
  hl: string,
): { items: TextItem[]; missing: string[] } {
  const items: TextItem[] = [];
  const missing: string[] = [];
  for (const g of games) {
    const snap = latestStoreText(storage, g.appId, gl, hl);
    if (!snap) {
      missing.push(g.name);
      continue;
    }
    const o = snap.official;
    const fields: [TextSource, string | null][] = [
      ["title", o.title],
      ["short", o.shortDescription],
      ["description", o.description],
    ];
    for (const [source, raw] of fields) {
      const text = raw ? cleanText(raw) : "";
      if (text)
        items.push({ appId: g.appId, game: g.name, ours: g.ours, source, position: null, text });
    }
  }
  return { items, missing };
}

export function textSet(hl: string, items: readonly TextItem[]) {
  const texts = [...new Set(items.map((i) => cleanText(i.text)).filter(Boolean))].sort();
  return { hl, texts, hash: stableHash({ hl, texts }) };
}

export interface TermUse {
  term: string;
  count: number;
  sources: TextSource[];
}

export interface ConceptRow {
  id: string;
  label: string;
  gloss: string;
  cells: { appId: string; game: string; ours: boolean; uses: TermUse[] }[];
  common: { term: string; games: number; of: number; uses: number } | null;
  ours: "same" | "differs" | "not-used" | "unclear";
  reason: string;
  ownMismatch: string | null;
  suggestion: string | null;
}

export interface TerminologyCountry {
  gl: string;
  hl: string;
  label: string;
  state: "current" | "missing";
  note: string;
  games: { appId: string; game: string; ours: boolean; hasText: boolean }[];
  rows: ConceptRow[];
  suggestions: string[];
  textCount: number;
}

const SOURCE_RANK: Record<TextSource, number> = { title: 0, short: 1, image: 2, description: 3 };
const best = (s: TextSource[]) => Math.min(...s.map((x) => SOURCE_RANK[x]));
const WHERE: Record<TextSource, string> = {
  image: "images",
  title: "the title",
  short: "the short description",
  description: "the full description",
};

/** A game's terms for a concept, main term first (most used; ties: title, short, images). */
function usesOf(byTerm: Map<string, TermCount> | undefined): TermUse[] {
  return [...(byTerm ?? new Map<string, TermCount>())]
    .map(([term, c]) => ({ term, count: c.count, sources: [...c.sources] }))
    .sort(
      (a, b) =>
        b.count - a.count || best(a.sources) - best(b.sources) || (a.term < b.term ? -1 : 1),
    );
}

function rowFor(
  c: ConceptMap["concepts"][number],
  byGame: Map<string, Map<string, TermCount>> | undefined,
  games: TerminologyCountry["games"],
  items: readonly TextItem[],
): ConceptRow {
  const cells = games.map((g) => ({
    appId: g.appId,
    game: g.game,
    ours: g.ours,
    uses: usesOf(byGame?.get(g.appId)),
  }));
  const comps = cells.filter((x) => !x.ours);
  const m = games.filter((g) => !g.ours && g.hasText).length;
  const tally = new Map<string, { games: number; uses: number }>();
  for (const cell of comps)
    for (const u of cell.uses) {
      const t = tally.get(u.term) ?? { games: 0, uses: 0 };
      t.games++;
      t.uses += u.count;
      tally.set(u.term, t);
    }
  const top = [...tally].sort((a, b) => b[1].games - a[1].games || b[1].uses - a[1].uses)[0];
  const clear = !!top && m >= 3 && top[1].games >= m / 2;
  const common =
    clear && top ? { term: top[0], games: top[1].games, of: m, uses: top[1].uses } : null;
  const mine = cells.find((x) => x.ours)?.uses ?? [];
  const main = mine[0];
  const where = (u: TermUse) => u.sources.map((s) => WHERE[s]).join(" and ");
  const topText = top
    ? `${top[0]} is the most used (${top[1].games} of ${m} competitors)`
    : "no competitor uses it";
  let ours: ConceptRow["ours"];
  let reason: string;
  if (!main) {
    ours = "not-used";
    reason = common
      ? `we do not use it; ${common.games} of ${m} competitors use ${common.term}`
      : `we do not use it; ${topText}`;
  } else if (!common) {
    ours = "unclear";
    reason = `we use ${main.term} (${main.count} in ${where(main)}); no clear common term: ${topText}${m < 3 ? ", fewer than 3 competitors with text here" : ""}`;
  } else if (mine.some((u) => u.term === common.term)) {
    ours = "same";
    reason = `we use ${common.term}, like ${common.games} of ${m} competitors`;
  } else {
    ours = "differs";
    reason = `we use ${main.term} (${main.count} in ${where(main)}); ${common.games} of ${m} competitors use ${common.term}`;
  }
  // Our images vs our store text: different words for the same idea.
  const ourItems = items.filter((i) => i.ours);
  const bySource = (img: boolean) => {
    const set = new Set<string>();
    for (const u of mine) if (u.sources.some((s) => (s === "image") === img)) set.add(u.term);
    return set;
  };
  const imgTerms = bySource(true);
  const storeTerms = bySource(false);
  const disjoint =
    imgTerms.size && storeTerms.size && ![...imgTerms].some((t) => storeTerms.has(t));
  const ownMismatch =
    ourItems.length && disjoint
      ? `our images say ${[...imgTerms].join(", ")} but our store text says ${[...storeTerms].join(", ")}`
      : null;
  return {
    id: c.id,
    label: c.label,
    gloss: c.gloss,
    cells,
    common,
    ours,
    reason,
    ownMismatch,
    suggestion:
      ours === "differs" && common && main
        ? `consider ${common.term} instead of ${main.term} (${common.games} of ${m} competitors)`
        : null,
  };
}

export function terminologyFor(
  country: { gl: string; hl: string; label: string },
  games: readonly { appId: string; game: string; ours: boolean }[],
  items: readonly TextItem[],
  map: ConceptMap | null,
  missingStoreText: readonly string[],
): TerminologyCountry {
  const name = countryName(country.label);
  const ordered = [...games.filter((g) => g.ours), ...games.filter((g) => !g.ours)];
  const withText = new Set(items.map((i) => i.appId));
  const gs = ordered.map((g) => ({ ...g, hasText: withText.has(g.appId) }));
  const notes: string[] = [];
  if (missingStoreText.length)
    notes.push(
      `Store text not read yet for ${missingStoreText.length} ${missingStoreText.length === 1 ? "game" : "games"} in ${name} (${missingStoreText.join(", ")}): read it (free) with Read store text. Until then their image texts only are used.`,
    );
  if (!map)
    notes.push(
      `The words used in ${name} are not grouped into ideas yet: this needs one text-only AI step, listed with its cost in the approval.`,
    );
  const set = textSet(country.hl, items);
  const base = { ...country, games: gs, textCount: set.texts.length, note: notes.join(" ") };
  if (!map) return { ...base, state: "missing", rows: [], suggestions: [] };
  const counts = countTerms(map, items, country.hl);
  const total = (r: ConceptRow) =>
    r.cells.reduce((n, c) => n + c.uses.reduce((k, u) => k + u.count, 0), 0);
  const rows = map.concepts
    .map((c) => rowFor(c, counts.get(c.id), gs, items))
    .filter((r) => total(r) > 0)
    .sort((a, b) => total(b) - total(a) || (a.label < b.label ? -1 : 1));
  const suggestions = rows.flatMap((r) => (r.suggestion ? [r.suggestion] : []));
  return { ...base, state: "current", rows, suggestions };
}

export function crossCountryTerms(countries: readonly TerminologyCountry[]) {
  const labels = new Map<string, string>();
  for (const c of countries)
    for (const r of c.rows)
      if (!labels.has(r.label.toLowerCase())) labels.set(r.label.toLowerCase(), r.label);
  return [...labels].map(([k, label]) => ({
    label,
    perCountry: countries.map((c) => {
      const r = c.rows.find((x) => x.label.toLowerCase() === k);
      return {
        gl: c.gl,
        common: r?.common?.term ?? null,
        ours: r?.cells.find((x) => x.ours)?.uses[0]?.term ?? null,
      };
    }),
  }));
}

export function terminologyGaps(t: TerminologyCountry) {
  return t.rows.flatMap((r) => {
    const ours = r.cells.find((x) => x.ours)?.uses[0]?.term;
    if (r.ours !== "differs" || !r.common || !ours) return [];
    return [
      {
        concept: r.label,
        ours,
        common: r.common.term,
        games: r.common.games,
        of: r.common.of,
        statement: `${countryName(t.label)}, "${r.label}": ${r.reason}.`,
      },
    ];
  });
}
