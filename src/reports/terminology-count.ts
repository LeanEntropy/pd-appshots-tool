import he from "he";
import type { ConceptMap } from "../analysis/concept-map-schema.ts";

/**
 * Counting the concept map's terms in the texts, by code (plan-reports 3A.2, step 4). Texts and
 * terms are split into words with Intl.Segmenter (as the store-text keywords are), then matched
 * longest term first without overlaps. A term must start and end on word boundaries; Korean
 * words may carry one particle from an allow-list, so 전투를 counts as 전투 but 전투력 does not.
 * Languages written without spaces (Japanese, Chinese, Thai) are matched on the joined words.
 */
export type TextSource = "image" | "title" | "short" | "description";

export interface TextItem {
  appId: string;
  game: string;
  ours: boolean;
  source: TextSource;
  position: number | null;
  text: string;
}

/** NFKC, HTML entities decoded, whitespace collapsed. */
export function cleanText(s: string): string {
  return he.decode(s).normalize("NFKC").replace(/\s+/g, " ").trim();
}

export const KO_PARTICLES = [
  "를",
  "을",
  "는",
  "은",
  "이",
  "가",
  "의",
  "에",
  "로",
  "으로",
  "와",
  "과",
  "도",
];

const lang = (hl: string) => hl.toLowerCase().split(/[-_]/)[0] ?? "en";
const noSpace = (hl: string) => ["ja", "zh", "th"].includes(lang(hl));
/** Marks a break (punctuation) that no term may cross. */
const BREAK = "\u0000";

interface Stream {
  text: string;
  starts: Set<number>;
  ends: Set<number>;
}

/** The words of a text joined ("" or " "), with the word boundaries. */
export function wordStream(text: string, hl: string): Stream {
  const seg = new Intl.Segmenter(hl, { granularity: "word" });
  const sep = noSpace(hl) ? "" : " ";
  let out = "";
  const starts = new Set<number>();
  const ends = new Set<number>();
  let pendingBreak = false;
  for (const s of seg.segment(cleanText(text).toLocaleLowerCase(hl))) {
    if (!s.isWordLike) {
      if (/[^\s]/.test(s.segment)) pendingBreak = true;
      continue;
    }
    if (out) out += pendingBreak ? BREAK : sep;
    pendingBreak = false;
    starts.add(out.length);
    out += s.segment;
    ends.add(out.length);
  }
  return { text: out, starts, ends };
}

/** A term in the same form as the stream (its words joined the same way). */
export function termForm(term: string, hl: string): string {
  return wordStream(term, hl).text;
}

export interface Match {
  term: string;
  concept: string;
}

/** Every term occurrence in one text, longest first, no overlaps. */
export function matchTerms(
  text: string,
  hl: string,
  terms: readonly { term: string; concept: string }[],
): Match[] {
  const st = wordStream(text, hl);
  const forms = terms
    .map((t) => ({ ...t, form: termForm(t.term, hl) }))
    .filter((t) => t.form && !t.form.includes(BREAK))
    .sort((a, b) => b.form.length - a.form.length);
  const ko = lang(hl) === "ko";
  const out: Match[] = [];
  const used: boolean[] = [];
  const free = (a: number, b: number) => {
    for (let i = a; i < b; i++) if (used[i]) return false;
    return true;
  };
  for (const t of forms) {
    let from = 0;
    for (;;) {
      const at = st.text.indexOf(t.form, from);
      if (at < 0) break;
      from = at + 1;
      if (!st.starts.has(at)) continue;
      let end = at + t.form.length;
      if (!st.ends.has(end)) {
        const p = ko
          ? KO_PARTICLES.find((x) => st.ends.has(end + x.length) && st.text.startsWith(x, end))
          : undefined;
        if (!p) continue;
        end += p.length;
      }
      if (!free(at, end)) continue;
      for (let i = at; i < end; i++) used[i] = true;
      out.push({ term: t.term, concept: t.concept });
    }
  }
  return out;
}

export interface TermCount {
  count: number;
  sources: TextSource[];
}

/** Uses per concept, per game (app id), per term. */
export type Counts = Map<string, Map<string, Map<string, TermCount>>>;

export function countTerms(map: ConceptMap, items: readonly TextItem[], hl: string): Counts {
  const terms = map.concepts.flatMap((c) => c.terms.map((t) => ({ term: t.term, concept: c.id })));
  const out: Counts = new Map();
  for (const it of items)
    for (const m of matchTerms(it.text, hl, terms)) {
      const byGame = out.get(m.concept) ?? new Map<string, Map<string, TermCount>>();
      out.set(m.concept, byGame);
      const byTerm = byGame.get(it.appId) ?? new Map<string, TermCount>();
      byGame.set(it.appId, byTerm);
      const c = byTerm.get(m.term) ?? { count: 0, sources: [] };
      c.count++;
      if (!c.sources.includes(it.source)) c.sources.push(it.source);
      byTerm.set(m.term, c);
    }
  return out;
}
