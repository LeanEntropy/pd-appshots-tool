import { normTerm } from "../analysis/concept-map-schema.ts";
import { noFactIds } from "../analysis/country-advice-schema.ts";
import type { TerminologyCountry, TextSource } from "./terminology.ts";

/**
 * "Words to use" per country as a status per term, decided by code from what a saved report
 * already holds: the advice's recommended word (and the word to avoid) and the words-used table
 * (which terms each game uses, ours split into images and store text). No AI, no text parsing:
 * saved versions get it as they are. A fact the table does not hold gives "check", never a guess.
 */
export type WordStatus = "change" | "add" | "check" | "keep" | "optional";

export interface AdviceTerm {
  concept: string;
  use: string;
  avoid: string;
  why: string;
  /** English meaning and reading of `use`; "" in answers saved before the field existed. */
  meaning?: string;
}

export interface WordRow {
  concept: string;
  use: string;
  meaning: string;
  status: WordStatus;
  /** The word to replace (change), or ours that could give way (optional). */
  from: string | null;
  /** Our words for this idea now. */
  ours: { images: string[]; store: string[] };
  /** Competitors using the recommended word, of those with text here; null when unknown. */
  competitors: { n: number; of: number } | null;
  /** One short line, by code. */
  reason: string;
  /** The advice's own reasoning (AI), for the disclosure. */
  details: string;
}

export interface WordsBlock {
  rows: WordRow[];
  tally: { fix: number; keep: number; optional: number; check: number };
}

const ORDER: Record<WordStatus, number> = { change: 0, add: 1, check: 2, keep: 3, optional: 4 };
const STORE_WORDS: Record<Exclude<TextSource, "image">, string> = {
  title: "the title",
  short: "the short description",
  description: "the description",
};

function storePlace(sources: Iterable<TextSource>): string {
  const s = [...sources].filter((x): x is Exclude<TextSource, "image"> => x !== "image");
  return s.length === 1 && s[0] ? STORE_WORDS[s[0]] : "the store text";
}

function statusOf(t: AdviceTerm, terms: TerminologyCountry | null): Omit<WordRow, "details"> {
  const base = { concept: t.concept, use: t.use, meaning: t.meaning ?? "" };
  const none = { images: [], store: [] };
  if (terms?.state !== "current")
    return {
      ...base,
      status: "check",
      from: null,
      ours: none,
      competitors: null,
      reason: "The words used here are not grouped yet, so this cannot be checked.",
    };
  const U = normTerm(t.use);
  const A = t.avoid.trim() ? normTerm(t.avoid) : "";
  const withText = new Set(terms.games.filter((g) => !g.ours && g.hasText).map((g) => g.appId));
  const ourAll = new Map<string, { term: string; sources: Set<TextSource> }>();
  const users = new Map<string, Set<string>>();
  for (const r of terms.rows)
    for (const c of r.cells)
      for (const u of c.uses) {
        const k = normTerm(u.term);
        if (c.ours) {
          const o = ourAll.get(k) ?? { term: u.term, sources: new Set<TextSource>() };
          for (const s of u.sources) o.sources.add(s);
          ourAll.set(k, o);
        } else if (withText.has(c.appId)) users.set(k, (users.get(k) ?? new Set()).add(c.appId));
      }
  const hasTerm = (k: string) => (r: TerminologyCountry["rows"][number]) =>
    r.cells.some((c) => c.uses.some((u) => normTerm(u.term) === k));
  const label = t.concept.trim().toLowerCase();
  const row =
    terms.rows.find(hasTerm(U)) ??
    terms.rows.find((r) => r.label.trim().toLowerCase() === label) ??
    (A ? terms.rows.find(hasTerm(A)) : undefined);
  const ourRow = row?.cells.find((c) => c.ours)?.uses ?? [];
  const mine = new Map(ourRow.map((u) => [normTerm(u.term), u.term]));
  if (ourAll.has(U)) mine.set(U, ourAll.get(U)?.term ?? t.use);
  if (A && ourAll.has(A)) mine.set(A, ourAll.get(A)?.term ?? t.avoid);
  const ours = { images: [] as string[], store: [] as string[] };
  for (const [k, term] of mine) {
    const src = ourAll.get(k)?.sources ?? new Set<TextSource>();
    if (src.has("image")) ours.images.push(term);
    if ([...src].some((s) => s !== "image")) ours.store.push(term);
  }
  const of = terms.games.filter((g) => !g.ours && g.hasText).length;
  const known = !!row && row.cells.some((c) => c.uses.some((u) => normTerm(u.term) === U));
  const n = users.get(U)?.size ?? 0;
  const competitors = known || ourAll.has(U) ? { n, of } : null;
  const comp = competitors ? `${n} of ${of} competitors use ${t.use}` : "";
  const common = row?.common ? normTerm(row.common.term) === U : false;
  const res = (status: WordStatus, from: string | null, reason: string) => ({
    ...base,
    status,
    from,
    ours,
    competitors,
    reason,
  });
  const usesIt = ourAll.get(U);
  if (A && ourAll.has(A)) {
    const where = ourAll.get(A)?.sources ?? new Set<TextSource>();
    const place = [
      where.has("image") ? "our images" : "",
      [...where].some((s) => s !== "image") ? storePlace(where) : "",
    ]
      .filter(Boolean)
      .join(" and ");
    return res("change", t.avoid, `${comp || "Recommended here"}; we use ${t.avoid} in ${place}.`);
  }
  if (usesIt) {
    const img = usesIt.sources.has("image");
    const store = [...usesIt.sources].some((s) => s !== "image");
    const other = (inImg: boolean) =>
      ourRow.find(
        (u) =>
          normTerm(u.term) !== U &&
          (inImg ? u.sources.includes("image") : u.sources.some((s) => s !== "image")),
      )?.term;
    const gap = img && !store ? other(false) : !img && store ? other(true) : undefined;
    const says = img && !store ? `our store text says ${gap}` : `our images say ${gap}`;
    const place =
      img && store ? "our images and store text" : img ? "our images" : storePlace(usesIt.sources);
    if (gap && common) return res("change", gap, `${comp}; ${says}.`);
    return res(
      "keep",
      null,
      `Already in ${place}${comp ? `; ${comp}` : ""}.${gap ? ` Note: ${says}.` : ""}`,
    );
  }
  const others = ourRow.map((u) => u.term).filter((x) => normTerm(x) !== U);
  const first = others[0];
  if (!row && !first)
    return res(
      "check",
      null,
      `${t.use} is not in the words-used table here, so whether our texts use it cannot be checked.`,
    );
  if (first && !row?.common)
    return res("optional", first, `No common term here; ours (${first}) is fine.`);
  if (first) return res("change", first, `${comp || "Recommended here"}; we use ${first}.`);
  return res("add", null, `Not in our texts; ${comp || "recommended here"}.`);
}

/** The status table of one country's advice terms: fixes first, then checks, then the rest. */
export function wordsBlock(
  advice: readonly AdviceTerm[],
  terms: TerminologyCountry | null,
): WordsBlock {
  const rows = advice
    .map((t) => ({ ...statusOf(t, terms), details: noFactIds(t.why) }))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ORDER[a.r.status] - ORDER[b.r.status] || a.i - b.i)
    .map((x) => x.r);
  const count = (s: WordStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  return {
    rows,
    tally: {
      fix: count(["change", "add"]),
      keep: count(["keep"]),
      optional: count(["optional"]),
      check: count(["check"]),
    },
  };
}

/** "3 to fix, 5 correct" (plus optional and to-check counts when there are any). */
export function tallyText(t: WordsBlock["tally"]): string {
  return [
    `${t.fix} to fix`,
    `${t.keep} correct`,
    t.optional ? `${t.optional} optional` : "",
    t.check ? `${t.check} to check` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

interface ReportLike {
  advice?: { gl?: string; advice?: { terms?: AdviceTerm[] } | null }[];
  terminology?: TerminologyCountry[];
}

/** A saved country report with each advice's `words` block added (derived; never saved). */
export function withWordStatus<T extends ReportLike>(r: T): T {
  if (!Array.isArray(r.advice)) return r;
  const terms = Array.isArray(r.terminology) ? r.terminology : [];
  return {
    ...r,
    advice: r.advice.map((a) =>
      a.advice && Array.isArray(a.advice.terms)
        ? { ...a, words: wordsBlock(a.advice.terms, terms.find((t) => t.gl === a.gl) ?? null) }
        : a,
    ),
  };
}
