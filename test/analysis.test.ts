import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { compareReadings, textSimilarity } from "../src/analysis/compare.ts";
import { estimate } from "../src/analysis/estimate.ts";
import { deckAnalysisSchema, semanticProblems, toJsonSchema } from "../src/analysis/schema.ts";
import { buildRecord } from "../src/analysis/settle.ts";
import { assignTiers } from "../src/analysis/tiers.ts";
import { ConfigSchema } from "../src/config/schema.ts";
import { reading } from "./helpers/fake-provider.ts";

const config = ConfigSchema.parse(
  JSON.parse(readFileSync(new URL("./fixtures/config.json", import.meta.url), "utf8")),
);
const taxonomy = {
  id: "t",
  version: "1",
  definitions: {},
  subtypeLabels: {},
  screenTypes: [
    { id: "gameplay", label: "G", subtypes: ["battle", "boss"] },
    { id: "other", label: "O", subtypes: [] },
  ],
};
const Z = "0".repeat(64);
const ONE = `1${"0".repeat(63)}`;
const FAR = "1".repeat(64);

test("cost tiers: analysed or repeated images are free, near-identical localised images get a layer diff", () => {
  const isBase = (gl: string) => gl === "us";
  const items = [
    { appId: "a", gl: "us", hl: "en", position: 1, imageId: "x", phash: Z },
    { appId: "a", gl: "us", hl: "en", position: 2, imageId: "y", phash: FAR },
    { appId: "b", gl: "us", hl: "en", position: 1, imageId: "y", phash: FAR },
    { appId: "a", gl: "jp", hl: "ja", position: 1, imageId: "x-jp", phash: ONE },
    { appId: "a", gl: "jp", hl: "ja", position: 2, imageId: "new", phash: FAR },
  ];
  const t = assignTiers(items, [{ appId: "a", imageId: "x", phash: Z, baseline: true }], isBase);
  assert.deepEqual(
    t.map((x) => x.tier),
    ["identical", "full", "identical", "layer-diff", "full"],
  );
  assert.equal(t[3]?.basedOn, "x");
});

test("estimate: one call per image by default, review of every image, review of every image, cost range with allowance", () => {
  const mk = (appId: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      appId,
      gl: "us",
      hl: "en",
      position: i + 1,
      imageId: `${appId}${i}`,
      phash: Z,
      tier: "full" as const,
      basedOn: null,
      reason: "",
    }));
  const items = [...mk("ours", 7), ...mk("a", 12), ...mk("b", 5)];
  const off = { ...config.options, speed: { ...config.options.speed, layoutCapture: false } };
  const e = estimate({ ...config, options: off }, items);
  // With the layout breakdown on: one more call per image and its cost in the range.
  const on = estimate(config, items);
  assert.equal(on.passes.find((p) => p.role.startsWith("Layout"))?.calls, 24);
  assert.ok((on.usd[1] as number) > (e.usd[1] as number));
  const full = e.passes[0];
  assert.equal(full?.calls, 24);
  assert.equal(full?.images, 24);
  assert.equal(e.passes[2]?.images, 24);
  assert.equal(e.expectedDisputes, 3);
  assert.equal(e.gptTokens, 24 * 17000);
  assert.deepEqual(e.usd, [
    Math.round((24 * 0.15 * 1.15 + 0.3) * 100) / 100,
    Math.round((24 * 0.25 * 1.15 + 0.3) * 100) / 100,
  ]);
});

test("readings disagree on screen type or headline, not on punctuation or case", () => {
  assert.equal(textSimilarity("EPIC BOSS FIGHTS!", "Epic boss fights"), 1);
  const a = reading("img1", "gameplay", "EPIC BOSS FIGHTS!");
  assert.deepEqual(
    compareReadings(a, reading("img1", "gameplay", "epic boss fights")).disputes,
    [],
  );
  assert.equal(
    compareReadings(a, reading("img1", "other", "EPIC BOSS FIGHTS!")).disputes.length,
    1,
  );
  assert.equal(
    compareReadings(a, reading("img1", "gameplay", "CHOOSE YOUR FATE")).disputes.length,
    1,
  );
});

test("semantic checks: every sent image answered once, subtypes from the taxonomy, sane numbers", () => {
  const ok = [reading("img1", "gameplay", ""), reading("img2", "gameplay", "")];
  assert.deepEqual(semanticProblems(taxonomy, ["img1", "img2"], ok), []);
  assert.equal(semanticProblems(taxonomy, ["img1", "img2"], [ok[0] as never]).length, 1);
  const base = reading("img1", "gameplay", "");
  const badSub = { ...base, screenshot: { ...base.screenshot, subtype: "dance" } };
  assert.equal(semanticProblems(taxonomy, ["img1"], [badSub]).length, 1);
  const other = reading("img1", "other", "");
  assert.equal(semanticProblems(taxonomy, ["img1"], [other]).length, 1);
  const noLayer = reading("img1", "gameplay", "", false);
  assert.deepEqual(semanticProblems(taxonomy, ["img1"], [noLayer]), []);
  const contradiction = { ...base, marketingLayer: { ...base.marketingLayer, present: false } };
  assert.ok(semanticProblems(taxonomy, ["img1"], [contradiction]).length >= 1);
});

test("the JSON schema is strict at every level (usable by both Claude and OpenAI)", () => {
  const js = JSON.stringify(toJsonSchema(deckAnalysisSchema(taxonomy)));
  const objects = js.match(/"type":"object"/g)?.length ?? 0;
  const closed = js.match(/"additionalProperties":false/g)?.length ?? 0;
  assert.ok(objects > 3);
  assert.equal(objects, closed);
});

test("an adjudicated reading that breaks the composition rules stays disputed", () => {
  const a = reading("img1", "gameplay", "FIGHT");
  const rec = buildRecord({
    item: {
      appId: "a",
      gl: "us",
      hl: "en",
      position: 1,
      imageId: "x",
      phash: "",
      tier: "full",
      basedOn: null,
      reason: "",
      name: "A",
    },
    produced: { readings: new Map([["x", a]]), failed: new Map(), objects: new Map() },
    reviewed: { readings: new Map([["x", a]]), failed: new Map(), objects: new Map() },
    reviewRequired: true,
    disputes: new Map([["x", ["composition"]]]),
    notes: new Map(),
    decision: {
      chosen: "first",
      screenType: "title_image",
      subtype: "",
      composition: "pure_art",
      marketingLayerPresent: false,
      headline: "FIGHT",
      reason: "r",
    },
    adjudicationKey: "k",
    models: { producer: "p", reviewer: "r", adjudicator: "o" },
    runId: "run",
    check: (x) => semanticProblems(taxonomy, [x.imageRef], [x]),
  });
  assert.equal(rec.status, "disputed");
  assert.ok(rec.problems.some((p) => p.startsWith("after settling:")));
  assert.equal(rec.final?.headline, "", "no headline without a marketing layer");
});
