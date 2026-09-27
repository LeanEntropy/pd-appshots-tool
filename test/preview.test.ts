import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigSchema } from "../src/config/schema.ts";
import { summarize } from "../src/core/summary.ts";
import { buildTargets, deckKey } from "../src/core/targets.ts";
import type { ChartResult, Listing } from "../src/play/client.ts";

const base = {
  schemaVersion: 1,
  project: "t",
  ourApp: { name: "Ours", id: "our.app" },
  competitors: [
    { name: "A", id: "a.app", tier: "direct" },
    { name: "B", id: "b.app", tier: "reference" },
  ],
  markets: [
    { gl: "us", hl: "en", label: "US", baseline: true },
    { gl: "jp", hl: "ja", label: "Japan" },
  ],
  charts: { collection: "GROSSING", depth: 3, analyse: "only-if-picked" },
  download: {},
  core: { market: "us", stability: {} },
  review: {},
  budget: {},
  tierWeights: { direct: 3, same_audience: 2, reference: 1, chart: 1 },
  models: {
    fullAnalysis: "claude:m1",
    layerDiff: "claude:m2",
    imageReview: "codex:g1",
    adjudicate: "claude:m2",
    translate: "claude:m2",
    recommend: "claude:m2",
    recommendationReview: "codex:g1",
    codeReview: "codex:g1",
  },
  taxonomy: "x.json",
  ownAssets: { dir: "own" },
};
const config = ConfigSchema.parse(base);

function chart(gl: string, hl: string, ids: string[]): ChartResult {
  return {
    gl,
    hl,
    collection: "GROSSING",
    category: "GAME_ROLE_PLAYING",
    status: "ok",
    fetchedAt: "",
    entries: ids.map((appId, i) => ({ rank: i + 1, appId, title: appId, developer: "" })),
  };
}

test("targets: ours and named in every market, chart games in their country plus English", () => {
  const charts = [
    chart("us", "en", ["c1", "a.app", "c2"]),
    chart("jp", "ja", ["c1", "c3", "our.app"]),
  ];
  const t = buildTargets(config, charts);
  const keys = t.map(deckKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(t.filter((x) => x.group === "ours").length, 2);
  assert.equal(t.filter((x) => x.group === "named").length, 4);
  const chartKeys = t
    .filter((x) => x.group === "chart")
    .map(deckKey)
    .sort();
  assert.deepEqual(chartKeys, ["c1|jp|ja", "c1|us|en", "c2|us|en", "c3|jp|ja", "c3|us|en"]);
  assert.deepEqual(t.find((x) => x.appId === "c1")?.chartRanks, { us: 1, jp: 1 });
  assert.deepEqual(t.find((x) => x.appId === "our.app")?.chartRanks, { jp: 3 });
});

test("preview counts: unique images by Google id, unavailable pages, disk estimate, zero AI", () => {
  const failed: ChartResult = { ...chart("jp", "ja", []), status: "error", error: "boom" };
  const charts = [chart("us", "en", ["c1"]), failed];
  const targets = buildTargets(config, charts);
  const U = "https://play-lh.googleusercontent.com/";
  const L = (
    appId: string,
    gl: string,
    hl: string,
    ids: string[],
    status: Listing["status"] = "ok",
  ): [string, Listing] => [
    deckKey({ appId, gl, hl }),
    {
      appId,
      gl,
      hl,
      status,
      rawCount: ids.length * 3,
      screenshots: ids.map((i) => U + i),
      fetchedAt: "",
    },
  ];
  const listings = new Map<string, Listing>([
    L("our.app", "us", "en", ["o1", "o2"]),
    L("our.app", "jp", "ja", ["o1", "o2"]),
    L("a.app", "us", "en", ["a1", "a2", "a3"]),
    L("a.app", "jp", "ja", ["a1", "aj2", "aj3"]),
    L("b.app", "us", "en", ["b1"]),
    L("b.app", "jp", "ja", [], "unavailable"),
    L("c1", "us", "en", ["c1a", "c1b"]),
  ]);
  const s = summarize(targets, listings, charts, 1000, 0);
  assert.equal(s.total.decks, 7);
  assert.equal(s.total.available, 6);
  assert.equal(s.total.unavailable, 1);
  assert.equal(s.total.screenshots, 2 + 2 + 3 + 3 + 1 + 2);
  assert.equal(s.total.uniqueImages, 2 + 5 + 1 + 2);
  assert.equal(s.repeatedAcrossDecks, 3);
  assert.equal(s.estimatedBytes, 10 * 1000);
  assert.equal(s.aiCalls, 0);
  assert.equal(s.groups.chart.apps, 1);
  const rows = s.charts.map((c) => [c.gl, c.status, c.found, c.newGames]);
  assert.deepEqual(rows, [
    ["us", "ok", 1, 1],
    ["jp", "error", 0, 0],
  ]);
});

test("config: the reviewer must be another model family, and GPT-6 Astra is special-only", () => {
  const same = { ...base, models: { ...base.models, imageReview: "claude:x" } };
  assert.equal(ConfigSchema.safeParse(same).success, false);
  const astra = { ...base, models: { ...base.models, codeReview: "codex:gpt-6-astra" } };
  assert.equal(ConfigSchema.safeParse(astra).success, false);
});
