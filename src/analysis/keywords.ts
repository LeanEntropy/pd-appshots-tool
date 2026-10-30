import * as sw from "stopword";
import type { StoreOfficial } from "../play/store-text.ts";

/**
 * Keywords derived from the store text, by code (no AI). Google Play has no keyword field, so
 * these are never "official keywords": they are the words and short phrases the title, short
 * description, full description and tags use most, weighted by where they appear.
 *
 * Words come from Intl.Segmenter (ICU dictionaries split Japanese, Chinese and Thai, which have no
 * spaces). Known limit: Korean words keep their particles (보스를 vs 보스).
 *
 * v2 (2026-10-31): tag names are no longer split into keywords (they gave junk such as "hearted"
 * and "light" from "Light-hearted"; tags are compared as tags, engine/rules-meta.ts), hyphenated
 * words stay whole, and more languages have stopwords.
 */
export const KEYWORDS_VERSION = 2;

export type Field = "title" | "short" | "description";
const WEIGHT: Record<Field, number> = { title: 3, short: 2, description: 1 };

export interface Keyword {
  /** Canonical form: lower-case words joined by one space (used for counting and matching). */
  key: string;
  /** Display form (no space between Chinese, Japanese or Thai words). */
  term: string;
  score: number;
  fields: Field[];
}

const STOP: Record<string, string[]> = {
  en: sw.eng,
  ja: sw.jpn,
  ko: sw.kor,
  zh: sw.zho,
  th: sw.tha,
  vi: sw.vie,
  id: sw.ind,
  ms: sw.msa,
  es: sw.spa,
  pt: sw.por,
  fr: sw.fra,
  de: sw.deu,
  it: sw.ita,
  ru: sw.rus,
  tr: sw.tur,
  ar: sw.ara,
  hi: sw.hin,
  fi: sw.fin,
  nl: sw.nld,
  sv: sw.swe,
  da: sw.dan,
  nb: sw.nob,
  no: sw.nob,
  pl: sw.pol,
  cs: sw.ces,
};
// Additions seen in real store text. The Chinese list is in Simplified characters, so the
// Traditional forms of common ones are added.
const EXTRA: Record<string, string[]> = {
  en: [
    "every",
    "get",
    "let",
    "lets",
    "let's",
    "can't",
    "don't",
    "you'll",
    "you're",
    "we're",
    // Store-page boilerplate (contact lines, policies): never a term to copy.
    "contact",
    "support",
    "email",
    "e-mail",
    "privacy",
    "policy",
    "terms",
    "feedback",
    "questions",
    "back",
    "please",
    "app",
    "gameplay",
    "experience",
  ],
  fi: ["tämä", "tässä", "joissa", "jossa", "milloin", "myös", "sekä", "voit", "kun", "jos", "joka"],
  fr: ["comme", "votre", "vos"],
  it: ["ama", "tuo", "tua", "tuoi"],
  es: ["objetivo", "tu", "tus"],
  de: ["deine", "dein", "einfach"],
  zh: "與 這 們 個 為 對 於 從 讓 會 還 將 並 裡 嗎 麼 你的 我們 我的 你們 一個 每一 每個".split(
    " ",
  ),
  th: ["คุณ", "ของคุณ"],
  ko: ["더", "및"],
};
const stopCache = new Map<string, Set<string>>();

/** Stopwords for a Google Play language code ("zh-TW" uses the Chinese list). */
export function stopwords(hl: string): Set<string> {
  const lang = hl.toLowerCase().split(/[-_]/)[0] ?? "en";
  let s = stopCache.get(lang);
  if (!s) {
    s = new Set([...(STOP[lang] ?? []), ...(EXTRA[lang] ?? []), ...sw.eng, ...(EXTRA.en ?? [])]);
    stopCache.set(lang, s);
  }
  return s;
}

const NO_SPACE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;
const URLS = /\b(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+/gi;

/** Joins words for display: a space between words, except between CJK or Thai characters. */
export function display(words: readonly string[]): string {
  let out = "";
  for (const w of words) {
    if (out && !(NO_SPACE.test(out.slice(-1)) && NO_SPACE.test(w.charAt(0)))) out += " ";
    out += w;
  }
  return out;
}

function dropWord(w: string, stop: Set<string>): boolean {
  if (stop.has(w)) return true;
  if (/^[\p{N}\p{P}\p{S}]+$/u.test(w)) return true;
  // One Latin letter or one kana says nothing on its own; short all-Hiragana words are grammar
  // (particles, verb endings), not keywords.
  return (
    /^[\p{Script=Latin}\p{Script=Katakana}]$/u.test(w) || /^\p{Script=Hiragana}{1,3}$/u.test(w)
  );
}

/**
 * Runs of kept words: a stopword, punctuation or a line break ends a run, so no phrase ever
 * bridges a removed word.
 */
export function wordRuns(text: string, hl: string): string[][] {
  const stop = stopwords(hl);
  const seg = new Intl.Segmenter(hl, { granularity: "word" });
  const runs: string[][] = [];
  let run: string[] = [];
  const end = () => {
    if (run.length) runs.push(run);
    run = [];
  };
  // A hyphenated word ("light-hearted", "Mah-jong") stays one word.
  let hyphen = false;
  let last = "";
  for (const s of seg.segment(text.replace(URLS, "\n"))) {
    if (!s.isWordLike) {
      if (/^[-\u2010\u2011]$/.test(s.segment) && last) {
        hyphen = true;
        continue;
      }
      hyphen = false;
      last = "";
      if (/\S/.test(s.segment) || s.segment.includes("\n")) end();
      continue;
    }
    const w = s.segment.toLocaleLowerCase(hl);
    if (hyphen && last) {
      const joined = `${last}-${w}`;
      hyphen = false;
      if (run.at(-1) === last) run[run.length - 1] = joined;
      else if (!dropWord(joined, stop)) run.push(joined);
      last = joined;
      continue;
    }
    hyphen = false;
    last = w;
    if (dropWord(w, stop)) end();
    else run.push(w);
  }
  end();
  return runs;
}

/** Every 1- to 3-word phrase of a text, by canonical key (with its display form). */
export function phrases(text: string, hl: string): Map<string, { term: string; count: number }> {
  const out = new Map<string, { term: string; count: number }>();
  for (const run of wordRuns(text, hl))
    for (let n = 1; n <= 3; n++)
      for (let i = 0; i + n <= run.length; i++) {
        const words = run.slice(i, i + n);
        const key = words.join(" ");
        const e = out.get(key);
        if (e) e.count++;
        else out.set(key, { term: display(words), count: 1 });
      }
  return out;
}

/** The store text by field (tag names are compared as tags, never split into keywords). */
export function fieldTexts(o: StoreOfficial): [Field, string][] {
  const out: [Field, string][] = [];
  if (o.title) out.push(["title", o.title]);
  if (o.shortDescription) out.push(["short", o.shortDescription]);
  if (o.description) out.push(["description", o.description]);
  return out;
}

/** Every phrase key in the store text (all fields), to check whether a term occurs at all. */
export function allKeys(o: StoreOfficial, hl: string): Set<string> {
  const keys = new Set<string>();
  for (const [, t] of fieldTexts(o)) for (const k of phrases(t, hl).keys()) keys.add(k);
  return keys;
}

/** True when `short` is a whole-word part of `long` (both canonical keys). */
const within = (short: string, long: string) => ` ${long} `.includes(` ${short} `);

/**
 * The top keywords derived from the store text: weighted counts (title 3, short description 2,
 * description 1), at least 2. A shorter term is dropped only when a longer term
 * containing it has the same score (every use of it is inside the longer one).
 */
export function deriveKeywords(o: StoreOfficial, hl: string, limit = 30): Keyword[] {
  const all = new Map<string, Keyword>();
  for (const [field, t] of fieldTexts(o))
    for (const [key, p] of phrases(t, hl)) {
      const k = all.get(key) ?? { key, term: p.term, score: 0, fields: [] };
      k.score += p.count * WEIGHT[field];
      if (!k.fields.includes(field)) k.fields.push(field);
      all.set(key, k);
    }
  const words = (k: Keyword) => k.key.split(" ").length;
  const ranked = [...all.values()]
    .filter((k) => k.score >= 2)
    .sort(
      (a, b) =>
        b.score - a.score || words(b) - words(a) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    );
  const kept = ranked.filter(
    (k) =>
      !ranked.some(
        (l) => l !== k && l.score === k.score && words(l) > words(k) && within(k.key, l.key),
      ),
  );
  return kept.slice(0, limit);
}
