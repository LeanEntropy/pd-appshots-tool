import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { countryAdviceSchema } from "../src/analysis/country-advice-schema.ts";
import type { TerminologyCountry, TextSource } from "../src/reports/terminology.ts";
import { upgradeWordsMd, wordsTableMd } from "../src/reports/words-md.ts";
import {
  type AdviceTerm,
  tallyText,
  withWordStatus,
  wordsBlock,
} from "../src/reports/words-status.ts";
import { REPORT_WORDS_SCRIPT } from "../src/view/report-words.ts";

type Use = [string, TextSource[]];
const GAMES = ["ours", "a", "b", "c", "d", "e", "f", "g", "h"];

/** A words-used table: per idea, the uses of each game (game id -> [term, sources][]). */
function table(
  rows: { label: string; common: string | null; uses: Record<string, Use[]> }[],
  state: TerminologyCountry["state"] = "current",
): TerminologyCountry {
  return {
    gl: "jp",
    hl: "ja",
    label: "Japan (Japanese)",
    state,
    note: "",
    games: GAMES.map((g) => ({ appId: g, game: g, ours: g === "ours", hasText: true })),
    rows: rows.map((r) => ({
      id: r.label.toLowerCase(),
      label: r.label,
      gloss: "",
      cells: GAMES.map((g) => ({
        appId: g,
        game: g,
        ours: g === "ours",
        uses: (r.uses[g] ?? []).map(([term, sources]) => ({ term, count: 1, sources })),
      })),
      common: r.common ? { term: r.common, games: 4, of: 8, uses: 5 } : null,
      ours: "unclear",
      reason: "",
      ownMismatch: null,
      suggestion: null,
    })),
    suggestions: [],
    textCount: 50,
  };
}

const four = (term: string, src: TextSource[] = ["description"]) =>
  Object.fromEntries(["a", "b", "c", "d"].map((g) => [g, [[term, src]] as Use[]]));

const JP = table([
  {
    label: "Adventure",
    common: "冒険",
    uses: { ...four("冒険"), ours: [["冒険", ["image", "description"]]] },
  },
  {
    label: "Strategy / build",
    common: "組み合わせ",
    uses: {
      ...four("組み合わせ"),
      ours: [
        ["戦略", ["description"]],
        ["ビルド", ["description"]],
      ],
    },
  },
  {
    label: "Monster / enemy",
    common: null,
    uses: {
      a: [["モンスター", ["image"]]],
      ours: [
        ["強敵", ["image"]],
        ["モンスター", ["description"]],
      ],
    },
  },
  { label: "Skill", common: "スキル", uses: { ...four("スキル"), ours: [["能力", ["image"]]] } },
  { label: "Hero", common: null, uses: { a: [["勇者", ["title"]]], ours: [["英雄", ["short"]]] } },
  { label: "Evolve", common: "進化", uses: four("進化", ["image"]) },
  {
    label: "Battle",
    common: "バトル",
    uses: {
      ...four("バトル"),
      ours: [
        ["バトル", ["image"]],
        ["戦闘", ["description"]],
      ],
    },
  },
]);

const T = (concept: string, use: string, avoid = "", meaning?: string): AdviceTerm => ({
  concept,
  use,
  avoid,
  why: `advice for ${concept} (C3)`,
  ...(meaning === undefined ? {} : { meaning }),
});

const ADVICE = [
  T("Adventure", "冒険", "", "adventure (bouken)"),
  T("Strategy / build", "組み合わせ", "戦略"),
  T("Monster / enemy", "強敵"),
  T("Skill", "スキル"),
  T("Hero", "勇者"),
  T("Evolve", "進化"),
  T("Battle", "バトル"),
  T("Gacha", "ガチャ"),
];

test("each recommended word gets its status from the saved words-used table", () => {
  const b = wordsBlock(ADVICE, JP);
  const by = Object.fromEntries(b.rows.map((r) => [r.concept, r]));
  assert.equal(by.Adventure?.status, "keep");
  assert.deepEqual(by.Adventure?.ours, { images: ["冒険"], store: ["冒険"] });
  assert.deepEqual(by.Adventure?.competitors, { n: 4, of: 8 });
  assert.equal(by.Adventure?.meaning, "adventure (bouken)");
  // We use the word to avoid: change it.
  assert.equal(by["Strategy / build"]?.status, "change");
  assert.equal(by["Strategy / build"]?.from, "戦略");
  assert.match(
    by["Strategy / build"]?.reason ?? "",
    /4 of 8 competitors use 組み合わせ; we use 戦略 in the description/,
  );
  // Ours in images, another word in the store text, no common term: keep, with a note.
  assert.equal(by["Monster / enemy"]?.status, "keep");
  assert.match(by["Monster / enemy"]?.reason ?? "", /our store text says モンスター/);
  // A different word of ours where competitors share a common one: change.
  assert.equal(by.Skill?.status, "change");
  assert.equal(by.Skill?.from, "能力");
  // A different word of ours, no common term: optional.
  assert.equal(by.Hero?.status, "optional");
  assert.equal(by.Hero?.from, "英雄");
  // Not in our texts: add.
  assert.equal(by.Evolve?.status, "add");
  // Images use the common word, the store text another one: change the store text.
  assert.equal(by.Battle?.status, "change");
  assert.equal(by.Battle?.from, "戦闘");
  assert.match(by.Battle?.reason ?? "", /our store text says 戦闘/);
  // A word the table does not hold: check, never a guess.
  assert.equal(by.Gacha?.status, "check");
  assert.equal(by.Gacha?.competitors, null);
  assert.match(by.Gacha?.reason ?? "", /not in the words-used table/);
  // Fixes first, then checks, keeps, optional; details without fact ids.
  assert.deepEqual(
    b.rows.map((r) => r.status),
    ["change", "change", "change", "add", "check", "keep", "keep", "optional"],
  );
  assert.equal(by.Adventure?.details, "advice for Adventure");
  assert.deepEqual(b.tally, { fix: 4, keep: 2, optional: 1, check: 1 });
  assert.equal(tallyText(b.tally), "4 to fix, 2 correct, 1 optional, 1 to check");
});

test("without a grouped words-used table every term is a check", () => {
  for (const t of [null, table([], "missing")]) {
    const b = wordsBlock([T("Adventure", "冒険")], t);
    assert.equal(b.rows[0]?.status, "check");
    assert.match(b.rows[0]?.reason ?? "", /not grouped yet/);
  }
});

test("a saved report gets the statuses added, per country, without changing anything else", () => {
  const raw = {
    kind: "countries",
    terminology: [JP],
    advice: [
      { gl: "jp", label: "Japan", advice: { terms: ADVICE } },
      { gl: "kr", label: "Korea", advice: null },
    ],
  };
  const out = withWordStatus(raw) as typeof raw & { advice: { words?: unknown }[] };
  assert.equal(raw.advice[0] && "words" in raw.advice[0], false);
  assert.ok(out.advice[0]?.words);
  assert.equal(out.advice[1]?.words, undefined);
  const other: { kind: string; advice?: [] } = { kind: "x" };
  assert.deepEqual(withWordStatus(other), { kind: "x" });
});

test("advice saved before the meaning field still parses (it reads as empty)", () => {
  const old = {
    shortAnswer: "s",
    actions: [],
    deck: [],
    terms: [{ concept: "Adventure", use: "冒険", avoid: "", why: "w" }],
    keepFromMain: "",
  };
  const p = countryAdviceSchema.safeParse(old);
  assert.ok(p.success);
  assert.equal(p.data.terms[0]?.meaning, "");
});

test("the written report has a [V]/[X] table; an old saved list is swapped for it", () => {
  const b = wordsBlock(ADVICE, JP);
  const md = wordsTableMd(b, "Japan (Japanese)").join("\n");
  assert.match(md, /\*\*Words to use in Japan: 4 to fix, 2 correct, 1 optional, 1 to check\*\*/);
  assert.match(
    md,
    /\| \[X\] Change: 戦略 → 組み合わせ \| Strategy \/ build \| \*\*組み合わせ\*\* \|/,
  );
  assert.match(
    md,
    /\| \[V\] Correct, keep \| Adventure \| \*\*冒険\*\* – adventure \(bouken\) \| 冒険 \/ 冒険 \| 4 of 8 \|/,
  );
  const oldMd = [
    "### Japan",
    "",
    "| # | deck |",
    "",
    ...ADVICE.map(
      (t) =>
        `- ${t.concept}: use **${t.use}**${t.avoid ? `, not ${t.avoid}` : ""}. advice for ${t.concept}`,
    ),
    "",
    "## 3. Next",
  ].join("\n");
  const up = upgradeWordsMd(oldMd, {
    terminology: [JP],
    advice: [{ gl: "jp", label: "Japan", advice: { terms: ADVICE } }],
  });
  assert.doesNotMatch(up, /- Adventure: use/);
  assert.match(up, /\| \[X\] Change: 戦略 → 組み合わせ/);
  assert.match(up, /\| # \| deck \|\n\n\*\*Words to use in Japan/);
  assert.match(up, /\n\n## 3\. Next$/);
  // Text it did not write is left alone.
  assert.equal(upgradeWordsMd("# other", { advice: [] }), "# other");
});

test("the page draws a status table with a tally, chips, the swap and a disclosure", () => {
  const ctx: Record<string, unknown> = {
    esc: (x: unknown) => String(x).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`),
    cname: (s: string) => s.replace(/\s*\([^)]*\)\s*$/, ""),
    noIdText: (s: string) => s,
  };
  runInNewContext(`${REPORT_WORDS_SCRIPT}\nthis.draw = wordsToUseHtml;`, ctx);
  const draw = ctx.draw as (a: unknown) => string;
  const html = draw({
    label: "Japan (Japanese)",
    advice: { terms: ADVICE },
    words: wordsBlock(ADVICE, JP),
  });
  assert.match(
    html,
    /<strong>Japan:<\/strong> <span class="fix">4 to fix<\/span>, <span class="ok">2 correct<\/span>, 1 optional, 1 to check/,
  );
  assert.match(
    html,
    /<th>Idea<\/th><th>Word to use<\/th><th>We use now<\/th><th>Status<\/th><th>Competitors<\/th>/,
  );
  assert.match(
    html,
    /<span class="wchip change">\[X\] Change<\/span><div class="wswap local">戦略 → 組み合わせ<\/div>/,
  );
  assert.match(html, /<span class="wchip keep">\[V\] Correct, keep<\/span>/);
  assert.match(html, /<span class="wchip add">\[X\] Add<\/span>/);
  assert.match(html, /<span class="wchip optional">Optional<\/span>/);
  assert.match(html, /<span class="wchip check">Check<\/span>/);
  assert.match(html, /<div class="meta">adventure \(bouken\)<\/div>/);
  assert.match(html, /<details><summary>Details<\/summary>/);
  assert.ok(html.indexOf("wchip change") < html.indexOf("wchip keep"));
  // A version served without statuses keeps the plain list.
  assert.match(
    draw({ label: "Japan", advice: { terms: ADVICE } }),
    /<ul><li><strong>Adventure:<\/strong> use/,
  );
});
