import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyseImages, type CallContext } from "../src/analysis/call.ts";
import type { Provider } from "../src/analysis/providers.ts";
import { clampRegion, clampRegions } from "../src/analysis/regions.ts";
import { semanticProblems } from "../src/analysis/schema.ts";
import type { Taxonomy } from "../src/config/load.ts";
import { reading } from "./helpers/fake-provider.ts";

const taxonomy = {
  id: "t",
  version: "1",
  definitions: {},
  subtypeLabels: {},
  screenTypes: [
    { id: "gameplay", label: "G", subtypes: ["battle", "boss"] },
    { id: "other", label: "O", subtypes: [] },
  ],
} as unknown as Taxonomy;

/** A reading whose headline box runs 3 points past the bottom edge. */
function overshooting() {
  const r = reading("img1", "gameplay", "EPIC BOSS FIGHTS");
  const t = r.marketingLayer.texts[0];
  if (t) t.region = { x: 5, y: 95, w: 90, h: 8 };
  return r;
}

test("regions slightly past an edge are clamped; nonsensical ones lose only their position", () => {
  assert.deepEqual(clampRegion({ x: -2, y: 95, w: 50, h: 8 }), { x: 0, y: 95, w: 48, h: 5 });
  assert.deepEqual(clampRegion({ x: 10, y: 10, w: 20, h: 20 }), { x: 10, y: 10, w: 20, h: 20 });
  const none = { x: 0, y: 0, w: 0, h: 0 };
  assert.deepEqual(clampRegion({ x: 150, y: 10, w: 20, h: 20 }), none);
  assert.deepEqual(clampRegion({ x: 10, y: 10, w: -5, h: 20 }), none);
  assert.deepEqual(clampRegion({ x: Number.NaN, y: 0, w: 1, h: 1 }), none);
  const before = overshooting();
  assert.match(semanticProblems(taxonomy, ["img1"], [before]).join(), /region out of range/);
  const after = clampRegions(before);
  assert.deepEqual(semanticProblems(taxonomy, ["img1"], [after]), []);
  assert.equal(after.marketingLayer.texts[0]?.text, "EPIC BOSS FIGHTS");
  // A capture drawn far outside the image keeps the capture, without a position.
  const far = reading("img1", "gameplay", "X");
  const cap = far.screenshot.captures[0];
  if (cap) cap.region = { x: 10, y: 150, w: 80, h: 60 };
  const fixed = clampRegions(far);
  assert.deepEqual(semanticProblems(taxonomy, ["img1"], [fixed]), []);
  assert.equal(fixed.screenshot.captures.length, 1);
  assert.deepEqual(fixed.screenshot.captures[0]?.region, none);
});

test("a model answer with a box slightly out of range is accepted without a repair call", async () => {
  let calls = 0;
  const provider: Provider = {
    family: "openai",
    model: "fake-reviewer",
    async call() {
      calls++;
      return { ok: true, output: { images: [overshooting()] }, costUsd: 0, error: null };
    },
  } as Provider;
  const ctx: CallContext = {
    objectsDir: mkdtempSync(join(tmpdir(), "ssr-obj-")),
    taxonomy,
    taxonomyHash: "t",
    maxBudgetUsd: 1,
    remainingUsd: () => 10,
    timeoutMs: 1000,
    onCost: () => {},
  };
  const system = { text: "s", hash: "h", file: "" };
  const out = await analyseImages(
    "review",
    provider,
    system,
    [{ imageId: "a", path: "a.jpg" }],
    ctx,
  );
  assert.equal(calls, 1);
  assert.equal(out.failed.size, 0);
  assert.deepEqual(out.readings.get("a")?.marketingLayer.texts[0]?.region, {
    x: 5,
    y: 95,
    w: 90,
    h: 5,
  });
  // The cache keeps the raw answer (box still out of range); reuse clamps it again, no new call.
  const again = await analyseImages(
    "review",
    provider,
    system,
    [{ imageId: "a", path: "a.jpg" }],
    ctx,
  );
  assert.equal(calls, 1);
  assert.equal(again.readings.size, 1);
});
