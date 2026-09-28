import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CallContext } from "../src/analysis/call.ts";
import { cachedConceptMap, writeConceptMap } from "../src/analysis/concept-map.ts";
import { type ConceptMap, conceptMapProblems } from "../src/analysis/concept-map-schema.ts";
import type { RenderedPrompt } from "../src/analysis/prompts.ts";
import type { Provider, VisionCall } from "../src/analysis/providers.ts";
import { saveStoreText } from "../src/library/store-text.ts";
import {
  imageTextItems,
  storeTextItems,
  type TextItem,
  terminologyFor,
  terminologyGaps,
  textSet,
} from "../src/reports/terminology.ts";
import { matchTerms } from "../src/reports/terminology-count.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { reading } from "./helpers/fake-provider.ts";

const storage = () => workspaceStorage(mkdtempSync(join(tmpdir(), "ssr-term-")));
const prompt: RenderedPrompt = { text: "p", hash: "h1", file: "x.md" };

function ctxFor(s: ReturnType<typeof storage>): CallContext {
  return {
    storage: s,
    answerKey: (step, key) => `projects/t/objects/${step}/${key}.json`,
    taxonomy: { id: "t", version: "1", screenTypes: [], definitions: {} } as never,
    taxonomyHash: "t",
    maxBudgetUsd: 1,
    remainingUsd: () => 10,
    timeoutMs: 1000,
    onCost: () => {},
  };
}

function fake(answer: (c: VisionCall) => unknown): Provider & { calls: VisionCall[] } {
  const calls: VisionCall[] = [];
  return {
    family: "anthropic",
    model: "fake",
    calls,
    async call(c) {
      calls.push(c);
      return { ok: true, output: answer(c), costUsd: 0.01, error: null };
    },
  };
}

const item = (
  appId: string,
  text: string,
  source: TextItem["source"] = "image",
  ours = false,
): TextItem => ({
  appId,
  game: appId,
  ours,
  source,
  position: source === "image" ? 1 : null,
  text,
});
const map = (concepts: [string, string[]][]): ConceptMap => ({
  concepts: concepts.map(([id, terms]) => ({
    id,
    label: id,
    gloss: id,
    terms: terms.map((term) => ({ term, kind: "other", note: "" })),
  })),
});

test("the text set is the same for the same texts in any order", () => {
  const a = textSet("ja", [item("x", "バトル"), item("y", " 無料  ガチャ ")]);
  const b = textSet("ja", [item("y", "無料 ガチャ"), item("x", "バトル"), item("x", "バトル")]);
  assert.deepEqual(a, b);
  assert.equal(a.texts.length, 2);
});

test("a map with an invented term or a term in two concepts is rejected", () => {
  const texts = ["バトルで勝て", "無料ガチャ"];
  assert.deepEqual(conceptMapProblems(map([["battle", ["バトル"]]]), texts), []);
  assert.match(conceptMapProblems(map([["battle", ["戦闘"]]]), texts)[0] ?? "", /not in any/);
  const two = conceptMapProblems(
    map([
      ["battle", ["バトル"]],
      ["fight", ["バトル"]],
    ]),
    texts,
  );
  assert.ok(two.some((p) => /two concepts/.test(p)));
});

test("the map is cached per text set; a changed set passes the previous map", async () => {
  const s = storage();
  const p = fake(() => map([["battle", ["バトル"]]]));
  const set = textSet("ja", [item("x", "バトルで勝て")]);
  const one = await writeConceptMap(set, p, prompt, ctxFor(s), s);
  assert.ok(one.map);
  assert.equal(p.calls.length, 1);
  await writeConceptMap(set, p, prompt, ctxFor(s), s);
  assert.equal(p.calls.length, 1, "no second call for the same texts");
  assert.ok(cachedConceptMap(s, set, prompt, "fake"));
  const set2 = textSet("ja", [item("x", "バトルで勝て"), item("y", "バトル開始")]);
  await writeConceptMap(set2, p, prompt, ctxFor(s), s);
  assert.equal(p.calls.length, 2);
  assert.match(p.calls[1]?.prompt ?? "", /previous concept map/);
});

test("invented terms are never saved", async () => {
  const s = storage();
  const p = fake(() => map([["battle", ["戦闘"]]]));
  const set = textSet("ja", [item("x", "バトルで勝て")]);
  const r = await writeConceptMap(set, p, prompt, ctxFor(s), s);
  assert.equal(r.map, null);
  assert.equal(cachedConceptMap(s, set, prompt, "fake"), null);
});

const count = (text: string, hl: string, terms: string[]) =>
  matchTerms(
    text,
    hl,
    terms.map((term) => ({ term, concept: "c" })),
  ).map((m) => m.term);

test("counting: ja, ko particles, zh-TW, th and en", () => {
  assert.deepEqual(count("バトルで戦闘アップ！バトル", "ja", ["バトル", "戦闘"]).sort(), [
    "バトル",
    "バトル",
    "戦闘",
  ]);
  assert.deepEqual(count("전투를 시작! 전투력 up", "ko", ["전투"]), ["전투"]);
  assert.deepEqual(count("免費戰鬥，爽快戰鬥力", "zh-TW", ["戰鬥"]), ["戰鬥"]);
  assert.deepEqual(count("ต่อสู้กับบอส ฟรี", "th", ["ฟรี", "บอส"]).sort(), ["บอส", "ฟรี"]);
  assert.deepEqual(count("Epic BOSS fights, bossy freebies", "en", ["boss", "boss fights"]), [
    "boss fights",
  ]);
});

function games(n: number) {
  return [
    { appId: "ours", game: "Ours", ours: true },
    ...Array.from({ length: n }, (_, i) => ({ appId: `c${i}`, game: `C${i}`, ours: false })),
  ];
}

test("most common term with n of m, and the we-differ rule", () => {
  const items = [
    { ...item("ours", "戦闘で勝て"), ours: true },
    item("c0", "バトル"),
    item("c1", "バトル開始"),
    item("c2", "戦闘"),
    item("c3", "ガチャ"),
  ];
  const m = map([["battle", ["バトル", "戦闘"]]]);
  const t = terminologyFor({ gl: "jp", hl: "ja", label: "Japan" }, games(4), items, m, []);
  const row = t.rows[0];
  assert.deepEqual(row?.common, { term: "バトル", games: 2, of: 4, uses: 2 });
  assert.equal(row?.ours, "differs");
  assert.match(row?.reason ?? "", /2 of 4 competitors use バトル/);
  assert.match(t.suggestions[0] ?? "", /consider バトル instead of 戦闘/);
  assert.equal(terminologyGaps(t).length, 1);
  // Fewer than 3 competitors with text: no clear common term.
  const few = terminologyFor(
    { gl: "jp", hl: "ja", label: "Japan" },
    games(2),
    items.slice(0, 3),
    m,
    [],
  );
  assert.equal(few.rows[0]?.common, null);
  assert.equal(few.rows[0]?.ours, "unclear");
});

test("ties: more games, then more uses", () => {
  const items = [
    item("c0", "バトル バトル"),
    item("c1", "戦闘"),
    item("c2", "バトル 戦闘"),
    item("c3", "ガチャ"),
  ];
  const t = terminologyFor(
    { gl: "jp", hl: "ja", label: "Japan" },
    games(4),
    items,
    map([["battle", ["バトル", "戦闘"]]]),
    [],
  );
  assert.equal(t.rows[0]?.common?.term, "バトル");
  assert.equal(t.rows[0]?.ours, "not-used");
});

test("our images vs our store text use different words", () => {
  const items = [item("ours", "バトル", "image", true), item("ours", "戦闘ゲーム", "short", true)];
  const t = terminologyFor(
    { gl: "jp", hl: "ja", label: "Japan" },
    games(0),
    items,
    map([["battle", ["バトル", "戦闘"]]]),
    [],
  );
  assert.match(t.rows[0]?.ownMismatch ?? "", /images say バトル.*store text says 戦闘/);
});

test("missing store text gives the note and uses the image texts only", () => {
  const s = storage();
  saveStoreText(s, {
    appId: "com.a",
    gl: "jp",
    hl: "ja",
    fetchedAt: "2026-09-28T10:00:00.000Z",
    official: {
      title: "Game A - 放置RPG",
      shortDescription: "無料バトル",
      description: "説明",
      recentChanges: null,
      genre: { id: null, name: null },
      chips: [],
      contentRating: null,
    },
  });
  const g = [
    { appId: "com.a", name: "A", ours: true },
    { appId: "com.b", name: "B", ours: false },
  ];
  const r = storeTextItems(s, g, "jp", "ja");
  assert.deepEqual(r.missing, ["B"]);
  assert.deepEqual(
    r.items.map((i) => i.source),
    ["title", "short", "description"],
  );
  const img = imageTextItems([
    {
      appId: "com.b",
      name: "B",
      ours: false,
      position: 1,
      final: reading("img1", "gameplay", "バトル"),
    },
  ]);
  assert.equal(img.length, 1, "headline and text de-duplicated");
  const t = terminologyFor(
    { gl: "jp", hl: "ja", label: "Japan" },
    [
      { appId: "com.a", game: "A", ours: true },
      { appId: "com.b", game: "B", ours: false },
    ],
    [...r.items, ...img],
    null,
    r.missing,
  );
  assert.equal(t.state, "missing");
  assert.match(t.note, /Store text not read yet for 1 game in Japan \(B\)/);
  assert.equal(t.games.find((x) => x.appId === "com.b")?.hasText, true);
});
