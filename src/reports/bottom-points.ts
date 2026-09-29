/**
 * The bottom line of every report as short points (user, 2026-09-29: "show it in points"), by
 * code: a one-line verdict, "What differs" (facts, the count and key phrase in bold) and "Do
 * first" (actions, the most important first). Made from the structured answer when the AI wrote
 * one, else split from the saved short answer: sentences, then light classification by cue
 * words. Code-made findings (the same screen uploaded twice) become action bullets. A sentence
 * that repeats an item of the list shown right below the bottom line is left out.
 */
export interface Seg {
  t: string;
  /** Bold: a count or a key phrase. */
  b?: true;
  /** A back-translation (small, muted). */
  tr?: true;
}

export interface BottomItem {
  segs: Seg[];
  /** A short muted note after the item ("" when none). */
  note: string;
  /** Made by code (a computed finding), not from the AI's wording. */
  code: boolean;
}

export interface BottomVerdict {
  /** One group per verdict word, e.g. { word: "slightly different", text: "from 8 competitors in Japan" }. */
  groups: { word: string; text: string }[];
  /** Muted detail after the line ("11 of 17 pattern points"), or "". */
  meta: string;
}

export interface BottomPoints {
  verdict: BottomVerdict | null;
  differs: BottomItem[];
  actions: BottomItem[];
  /** "ai": from the AI's structured points; "split": split by code from the short answer. */
  from: "ai" | "split";
}

/** The AI's structured bottom line (new answers; answers saved before it have none). */
export interface StructuredBottom {
  verdict: string;
  differences: string[];
  actions: string[];
}

/** A finding made by code, as it appears in the short answer, and its note (or ""). */
export interface KnownFinding {
  text: string;
  note: string;
}

export interface BottomInput {
  shortAnswer: string;
  verdict: BottomVerdict | null;
  /** The computed verdict words (a sentence stating one is the verdict line's). */
  verdictWords: readonly string[];
  findings: readonly KnownFinding[];
  structured: StructuredBottom | null;
  /** Items shown right below the bottom line: a sentence repeating one is left out. */
  shownBelow: readonly string[];
  /** Keep a country prefix ("Japan: ...") on a finding (reports about several countries). */
  multi: boolean;
}

const ABBREV = /\b(?:e\.g|i\.e|vs|etc|approx|no)\.$/i;

/** Sentences of English prose; never splits inside brackets or quotes (local headlines). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let start = 0;
  const s = text.trim();
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if ("(［[“「『".includes(c)) depth++;
    else if (")］]”」』".includes(c)) depth = Math.max(0, depth - 1);
    else if (c === '"') quote = !quote;
    else if (".!?".includes(c) && depth === 0 && !quote) {
      const next = s[i + 1];
      if (next !== undefined && !/\s/.test(next)) continue;
      if (c === "." && ABBREV.test(s.slice(start, i + 1))) continue;
      out.push(s.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const rest = s.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

const VERBS = new Set(
  "open opens remove cut follow add change replace put move use translate swap keep show lead start drop reorder give make test try capture recapture localise localize switch place bring shorten trim rewrite reword run lift fix match".split(
    " ",
  ),
);
const PRIORITY =
  /^(?:the\s+)?(?:single\s+)?(?:most important|biggest|first)\s+(?:change|fix|step)(?:\s+here)?(?:\s+(?:is|would be))?(?:\s+to\b)?\s*[:,]?\s*/i;
const THEN =
  /^(?:after that|then|next|second|third|also|finally|in addition|beyond that|first of all|first|to start)\s*,?\s+/i;
const SHOULD = /^(?:we|you)\s+should\s+/i;
const EXPECT = /^(?:we expect|this should|that should|it should|expected)\b/i;
const OUR_PAGE = /\b(?:store page|our page|our deck)\b/;
const VERDICT_EXTRA = /\bpattern points\b|\bsmall sample\b/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const startsWithVerb = (s: string) => VERBS.has((/^[A-Za-z]+/.exec(s)?.[0] ?? "").toLowerCase());

/** Words of a text for the near-duplicate check (letters and digits, 3+ characters). */
// Numbers count too: "4 of 8" and "2 of 2" are different facts.
function words(s: string): Set<string> {
  return new Set(
    (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
      (w) => /^\d+$/.test(w) || ((w.length >= 3 || /\P{ASCII}/u.test(w)) && !STOP.has(w)),
    ),
  );
}
const STOP = new Set("and the our ours with for from that this are its".split(" "));

/** Near-duplicates: most words of the shorter text are in the longer one. */
export function sameIdea(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  if (small.size < 3) return false;
  let n = 0;
  for (const w of small) if (big.has(w)) n++;
  return n / small.size >= 0.8;
}

const COUNT =
  /\b(?:[Aa]ll \d+|[Nn]one of (?:the )?\d+|[Oo]nly \d+ of \d+|\d+ of (?:the )?\d+)(?: (?:competitors|games|images|screenshots|countries))?|\bno (?:[\p{L}-]+)(?: (?!(?:in|on|at|and|or|for|to|of|the|with|but)\b)[\p{L}-]+)?/gu;
const TRANSLATION = /(?<=\P{ASCII})\s*\(\s*(["“][^"”()]+["”])\s*\)/gu;

/** Bold spans marked **so** by the AI, else the counts and "no X" phrases by code. */
function boldSegs(text: string): Seg[] {
  const marked = /\*\*(.+?)\*\*/g;
  const re = marked.test(text) ? /\*\*(.+?)\*\*/g : COUNT;
  const out: Seg[] = [];
  let at = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ t: text.slice(at, i) });
    out.push({ t: m[1] ?? m[0], b: true });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ t: text.slice(at) });
  return out;
}

/** A local headline's back-translation in brackets becomes its own small segment. */
function actionSegs(text: string): Seg[] {
  const out: Seg[] = [];
  let at = 0;
  for (const m of text.matchAll(TRANSLATION)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ t: text.slice(at, i) });
    out.push({ t: ` ${m[1]}`, tr: true });
    at = i + m[0].length;
  }
  // A full stop right after a back-translation is left out ('... "Roll the dice!"').
  const tail = text.slice(at);
  if (at < text.length && !(out.at(-1)?.tr && /^\s*[.]\s*$/.test(tail))) out.push({ t: tail });
  return out.map((s) => (s.tr ? s : { t: s.t.replace(/\*\*/g, "") }));
}

const fact = (t: string): BottomItem => ({ segs: boldSegs(cap(t)), note: "", code: false });
const act = (t: string, code = false, note = ""): BottomItem => ({
  segs: actionSegs(cap(t)),
  note,
  code,
});

/** Takes the code-made findings out of the text: each becomes an action bullet. */
function takeFindings(text: string, x: BottomInput): { rest: string; items: BottomItem[] } {
  let rest = text;
  const items: BottomItem[] = [];
  for (const f of x.findings) {
    const body = f.text.slice(1);
    const i = rest.indexOf(body);
    if (i < 0) {
      items.push(act(f.text, true, f.note));
      continue;
    }
    // The finding's sentence may start with the countries it applies to ("Japan: your ...").
    const before = rest.slice(0, i);
    const cut = Math.max(
      before.lastIndexOf(". "),
      before.lastIndexOf("! "),
      before.lastIndexOf("? "),
    );
    const from = cut < 0 ? 0 : cut + 2;
    let end = i + body.length;
    let lead = rest.slice(from, i - 1).trim();
    if (f.note && rest.slice(end).trimStart().startsWith(f.note))
      end = rest.indexOf(f.note, end) + f.note.length;
    lead = lead.replace(/:$/, "");
    const shown = x.multi && lead ? `${lead}: ${f.text.charAt(0).toLowerCase()}${body}` : f.text;
    items.push(act(shown, true, f.note));
    rest = `${rest.slice(0, from)} ${rest.slice(end)}`.replace(/\s+/g, " ").trim();
  }
  return { rest, items };
}

/** The bottom line as points (see the file comment). */
export function bottomPoints(x: BottomInput): BottomPoints {
  const dup = (t: string) => x.shownBelow.some((s) => sameIdea(t, s));
  // A finding listed right below (a key point, a gap shared across countries) is not repeated.
  const took = takeFindings(x.shortAnswer, x);
  const rest = took.rest;
  const found = took.items.filter((i) => !dup(plain(i)));
  const s = x.structured;
  if (s && (s.differences.length || s.actions.length)) {
    const verdict = aiVerdict(s.verdict, x.verdict);
    return {
      verdict,
      differs: s.differences.filter((d) => d.trim() && !dup(d)).map(fact),
      // The AI's most important change first, then the code-made findings, then the rest.
      actions: (([head, ...tail]) => (head ? [head, ...found, ...tail] : found))(
        s.actions
          .filter((a) => a.trim() && !dup(a) && !found.some((f) => sameIdea(a, plain(f))))
          .map((a) => act(a)),
      ),
      from: "ai",
    };
  }
  const first: BottomItem[] = [];
  const later: BottomItem[] = [];
  const differs: BottomItem[] = [];
  let pendingNote = "";
  let last: BottomItem | null = null;
  for (const raw of splitSentences(rest)) {
    const low = raw.toLowerCase();
    const isVerdict = x.verdictWords.some((w) => low.includes(w)) && OUR_PAGE.test(low);
    if (VERDICT_EXTRA.test(raw) || isVerdict) continue;
    if (EXPECT.test(raw) && last) {
      last.note = [last.note, raw].filter(Boolean).join(" ");
      continue;
    }
    const pri = PRIORITY.exec(raw);
    let t = raw;
    let isAction = false;
    if (pri) {
      t = raw.slice(pri[0].length);
      // "The most important change is image 2, ...": a focus, noted on the next action.
      if (!startsWithVerb(t)) {
        pendingNote = cap(t);
        continue;
      }
      isAction = true;
    } else {
      const lead = THEN.exec(t) ?? SHOULD.exec(t);
      if (lead && startsWithVerb(t.slice(lead[0].length))) t = t.slice(lead[0].length);
      isAction = startsWithVerb(t);
    }
    if (dup(t)) continue;
    if (!isAction) {
      differs.push(fact(t));
      continue;
    }
    const item = act(t, false, pendingNote);
    (pri || pendingNote ? first : later).push(item);
    pendingNote = "";
    last = item;
  }
  if (pendingNote && !dup(pendingNote)) differs.push(fact(pendingNote));
  return { verdict: x.verdict, differs, actions: [...first, ...found, ...later], from: "split" };
}

/** The AI's verdict line when it opens with the computed verdict word, else the code's. */
function aiVerdict(line: string, v: BottomVerdict | null): BottomVerdict | null {
  const g = v?.groups.length === 1 ? v.groups[0] : undefined;
  if (!v || !g) return v;
  const t = line.trim();
  if (!t.toLowerCase().startsWith(g.word)) return v;
  const text = t.slice(g.word.length).trim().replace(/[.]$/, "");
  return text ? { ...v, groups: [{ word: g.word, text }] } : v;
}

/** An item's text without formatting. */
export const plain = (i: BottomItem) => i.segs.map((s) => s.t).join("");
