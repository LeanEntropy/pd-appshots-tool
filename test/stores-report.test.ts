import assert from "node:assert/strict";
import { test } from "node:test";
import { pairKey } from "../src/reports/anchors.ts";
import { storesAdvice, storesSummary } from "../src/reports/stores-advice.ts";
import { comparePair, PATTERN_RULES, storePatterns } from "../src/reports/stores-data.ts";
import { storesMarkdown } from "../src/reports/stores-md.ts";
import type {
  AppleSlotIn,
  PairInput,
  PairResult,
  Reading,
  StoreSlot,
  StoresReport,
} from "../src/reports/stores-types.ts";
import { storesReportHtml } from "../src/view/report-stores.ts";

const ZERO = "0".repeat(64);
const ONES = "1".repeat(64);
const read = (screenType: string, headline: string, art = false): Reading => ({
  screenType,
  screen: screenType,
  headline,
  texts: headline ? [headline] : [],
  logo: false,
  art,
});
const play = (position: number, id: string, reading: Reading | null = null): StoreSlot => ({
  position,
  imageId: id,
  thumb: null,
  width: 1080,
  height: 1920,
  orientation: "portrait",
  phash: ZERO,
  reading,
});
const apple = (position: number, id: string, o: Partial<AppleSlotIn> = {}): AppleSlotIn => ({
  position,
  imageId: id,
  thumb: null,
  width: 1242,
  height: 2688,
  orientation: "portrait",
  phash: ONES,
  reading: null,
  ...o,
});
const input = (o: Partial<PairInput> & Pick<PairInput, "play" | "apple">): PairInput => ({
  appId: "g",
  name: "Game",
  ours: false,
  gl: "us",
  country: "United States",
  ...o,
});

test("each App Store image is marked against the same game's Play images, cheapest proof first", () => {
  const r = comparePair(
    input({
      play: {
        state: "ok",
        slots: [
          play(1, "p1", read("gameplay", "Fight!")),
          play(2, "p2", read("gameplay", "Loot")),
          play(3, "p3"),
          play(4, "p4"),
        ],
      },
      apple: {
        state: "ok",
        slots: [
          apple(1, "p1", { width: 1080, height: 1920 }),
          apple(2, "a2", { sameAs: "p2" }),
          apple(3, "a3", { reading: read("gameplay", "Fight hard!") }),
          apple(4, "a4", { phash: ZERO }),
          apple(5, "a5"),
        ],
      },
    }),
    new Set([pairKey("p1", "a3")]),
  );
  const marks = r.rows.map((w) => w.apple?.mark);
  assert.deepEqual(marks, ["same-file", "same-picture", "same-screen", "probably-same", "new"]);
  assert.equal(r.marks.new, 1);
  // A fingerprint alone is not proof: probably-same is not counted as reuse.
  assert.equal(r.reuseShare, 3 / 5);
  assert.equal(r.newShare, 1 / 5);
  assert.equal(r.unconfirmed, 1);
  // Apple #3 shows Play #1 after Play #2: the order changed.
  assert.equal(r.order, "reordered");
  // Apple #3 against Play #1: both analysed, other words.
  assert.equal(r.rows[2]?.text, "changed");
  assert.deepEqual(r.text, { compared: 1, changed: 1 });
  assert.equal(r.reshaped, 2);
});

test("title art only on the App Store is found per position; not analysed stays unknown", () => {
  const r = comparePair(
    input({
      play: { state: "ok", slots: [play(1, "p1", read("gameplay", ""))] },
      apple: {
        state: "ok",
        slots: [
          apple(1, "a1", { reading: read("key_art", "", true) }),
          apple(2, "a2", { reading: read("gameplay", "") }),
          apple(3, "a3", { reading: read("gameplay", "") }),
        ],
      },
    }),
    new Set(),
  );
  assert.deepEqual(r.appleArt, [1]);
  assert.deepEqual(r.leadArt, { play: 0, apple: 1 });
  const unread = comparePair(
    input({ play: { state: "ok", slots: [play(1, "p1")] }, apple: { state: "ok", slots: [] } }),
    new Set(),
  );
  assert.equal(unread.leadArt.play, null);
});

const result = (name: string, o: Partial<PairResult>): PairResult => ({
  ...comparePair(
    input({
      name,
      play: { state: "ok", slots: [play(1, `${name}1`), play(2, `${name}2`)] },
      apple: { state: "ok", slots: [apple(1, `${name}1`), apple(2, `${name}2`)] },
    }),
    new Set(),
  ),
  ...o,
});

test("a pattern needs 3 or more competitors and half of those compared; ours is compared to it", () => {
  const them = ["A", "B", "C", "D"].map((n, i) =>
    result(n, {
      reuseShare: i < 3 ? 0.2 : 1,
      newShare: i < 3 ? 0.8 : 0,
      count: { play: 7, apple: 6 },
    }),
  );
  const ours = result("Ours", { ours: true, reuseShare: 1, count: { play: 7, apple: 6 } });
  const p = storePatterns([...them, ours], "us");
  const adapt = p.find((x) => x.id === "adapt");
  assert.equal(adapt?.n, 3);
  assert.equal(adapt?.of, 4);
  assert.equal(adapt?.pattern, true);
  assert.equal(adapt?.ours, "different");
  const reuse = p.find((x) => x.id === "reuse");
  assert.equal(reuse?.pattern, false);
  assert.equal(reuse?.ours, "n/a");
  // Unchecked pairs that could change the answer: not counted either way.
  const open = result("E", { reuseShare: 0.3, newShare: 0.2, unconfirmed: 3 });
  for (const id of ["reuse", "adapt"])
    assert.equal(
      PATTERN_RULES.find((x) => x.id === id)?.has({ ...open, count: { play: 6, apple: 6 } }),
      null,
    );
  // Two games are a statistic, never a pattern.
  const few = storePatterns([them[0] as PairResult, them[1] as PairResult, ours], "us");
  assert.equal(few.find((x) => x.id === "adapt")?.pattern, false);
});

test("advice: the enforced rule first, then pattern gaps as PPO tests; Play tests for our App Store-only pictures", () => {
  const us = { gl: "us", hl: "en", label: "United States" };
  const them = ["A", "B", "C"].map((n) => result(n, { reuseShare: 0.2, newShare: 0.8 }));
  const ours = comparePair(
    input({
      name: "Ours",
      ours: true,
      play: { state: "ok", slots: [play(1, "o1", read("gameplay", "Go")), play(2, "o2")] },
      apple: {
        state: "ok",
        slots: [
          apple(1, "o1", { reading: read("gameplay", "Go") }),
          apple(2, "o2"),
          apple(3, "oa", { reading: read("key_art", "", true) }),
        ],
      },
    }),
    new Set(),
  );
  const pairs = [...them, ours];
  const patterns = storePatterns(pairs, "us");
  const a = storesAdvice(pairs, patterns, {
    markets: [us],
    projectMarkets: [us],
    traffic: () => "high",
    appleLang: () => "United States (en_us)",
  });
  assert.equal(a.recommendations[0]?.rule, "Guideline 2.3.3");
  assert.equal(a.recommendations[0]?.store, "appstore");
  assert.match(a.recommendations[0]?.why ?? "", /position 3/);
  const ppo = a.tests.find((t) => t.store === "appstore");
  assert.ok(ppo, "a PPO test for the adapt pattern");
  assert.match(ppo?.setup.line ?? "", /Product Page Optimization/);
  assert.ok((ppo?.treatments.length ?? 0) >= 1 && (ppo?.treatments.length ?? 0) <= 3);
  const pl = a.tests.find((t) => t.store === "play");
  assert.match(pl?.evidence ?? "", /App Store position 3/);
  const s = storesSummary(pairs, patterns, a.recommendations);
  assert.match(s.verdict, /United States/);
  assert.equal(s.actions[0], a.recommendations[0]?.title);
});

test("the report page and its written copy escape every name and keep details folded", () => {
  const evil = result("<script>x</script>", { ours: true });
  const r: StoresReport = {
    kind: "stores",
    version: 1,
    generatedAt: "2026-09-29T00:00:00.000Z",
    countries: [{ gl: "us", label: "United States" }],
    summary: { verdict: "Our pages: **fine**.", points: ["<b>point</b>"], actions: [] },
    pairs: [evil],
    patterns: [],
    recommendations: [],
    tests: [],
    caveats: ["not verified"],
    leftOut: [],
  };
  const html = storesReportHtml(r);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&#60;script&#62;"));
  assert.ok(html.includes("<strong>fine</strong>"));
  // Open by default: the bottom line, the recommendations, the A/B tests; the rest folded.
  const open = [...html.matchAll(/<details class="sec" data-sec="(\w+)"( open)?/g)].map((m) => [
    m[1],
    !!m[2],
  ]);
  assert.deepEqual(open, [
    ["summary", true],
    ["recs", true],
    ["abtests", true],
    ["patterns", false],
    ["store", false],
    ["sorting", false],
  ]);
  assert.match(storesMarkdown(r), /## About this data\n\n- not verified/);
});
