import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import type { CallContext } from "../src/analysis/call.ts";
import {
  combinedRecord,
  currentLayerDiff,
  layerCrops,
  layerDiffKey,
} from "../src/analysis/layer-diff.ts";
import { compareLayers, type LayerItem } from "../src/analysis/layer-diff-run.ts";
import {
  combinedReading,
  type LayerDiff,
  layerDiffProblems,
  layerDiffSchema,
} from "../src/analysis/layer-diff-schema.ts";
import { renderReportPrompt } from "../src/analysis/prompts.ts";
import type { Provider, VisionCall } from "../src/analysis/providers.ts";
import { type AnalysisRecord, isUsable, readRecords } from "../src/analysis/records.ts";
import { semanticProblems } from "../src/analysis/schema.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../src/config/load.ts";
import { answerKey } from "../src/library/layout.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { openImageDb } from "../src/store/imagedb.ts";
import { readDeck } from "../src/store/manifest.ts";
import { addDeck, analyse, builderProject, idOf, newText, usBytes } from "./helpers/builder.ts";
import { reading } from "./helpers/fake-provider.ts";

const DIFF: LayerDiff = {
  sameScreen: true,
  sameScreenReason: "",
  texts: [
    {
      role: "headline",
      anchorText: "PLAY",
      localText: "ãƒãƒˆãƒ«é–‹å§‹",
      backTranslation: "battle start",
      language: "ja",
      change: "reworded",
      notes: "",
    },
  ],
  genreTerms: [{ term: "ãƒãƒˆãƒ«", meaning: "battle", kind: "loanword" }],
  band: { change: "colour", colourName: "red", colourHex: "#d02020", notes: "" },
  elements: { change: "none", notes: "" },
  headline: "ãƒãƒˆãƒ«é–‹å§‹",
  wordingNotes: "",
};

function fake(answer: (c: VisionCall) => LayerDiff): Provider & { calls: VisionCall[] } {
  const calls: VisionCall[] = [];
  return {
    family: "anthropic",
    model: "fake-opus",
    calls,
    async call(c) {
      calls.push(c);
      return { ok: true, output: answer(c), costUsd: 0.05, error: null };
    },
  };
}

function ctxFor(loaded: LoadedConfig, budget = 10): CallContext {
  const paths = projectPaths(loaded);
  const { taxonomy, hash } = loadTaxonomy(loaded);
  let spent = 0;
  return {
    storage: workspaceStorage(paths.workspace),
    answerKey: (step, key) => answerKey(paths, step, key),
    taxonomy,
    taxonomyHash: hash,
    maxBudgetUsd: 3,
    remainingUsd: () => budget - spent,
    timeoutMs: 1000,
    onCost: (u) => {
      spent += u;
    },
  };
}

/** Ours in the US (analysed) and in Japan (same pictures, new text). */
async function setup() {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  const appId = idOf(loaded, ours);
  analyse(loaded, [ours]);
  const jp = [];
  for (const p of [1, 2, 3]) jp.push(await newText(usBytes(loaded, appId, p)));
  await addDeck(loaded, ours, "jp", "ja", jp, "ours");
  const paths = projectPaths(loaded);
  const us = readDeck(paths.decks, { appId, gl: "us", hl: "en" });
  const ja = readDeck(paths.decks, { appId, gl: "jp", hl: "ja" });
  const items: LayerItem[] = [1, 2, 3].map((p) => ({
    imageId: ja?.slots[p - 1]?.imageId as string,
    anchorId: us?.slots[p - 1]?.imageId as string,
    appId,
    name: ours,
    gl: "jp",
    hl: "ja",
    label: "Japan",
    position: p,
  }));
  return { loaded, paths, items };
}

function deps(loaded: LoadedConfig, provider: Provider, budget = 10) {
  const paths = projectPaths(loaded);
  const ctx = ctxFor(loaded, budget);
  let spent = 0;
  const inner = ctx.onCost;
  ctx.onCost = (u) => {
    spent += u;
    inner(u);
  };
  const failures: string[] = [];
  return {
    failures,
    d: {
      paths,
      db: openImageDb(paths),
      provider,
      prompt: renderReportPrompt(loaded.root, paths.objects, "layerDiff", ctx.taxonomy),
      ctx,
      runId: "2026-09-29T10-00-00-000Z-r-test",
      batchId: "b1",
      records: readRecords(paths),
      estimatePerImage: 0.06,
      stopAfterSameErrors: 3,
      shouldStop: () => false,
      budgetLeft: () => budget - spent,
      spent: () => spent,
      progress: () => {},
      fail: (m: string) => {
        failures.push(m);
      },
      counter: { done: 0 },
      total: 3,
    },
  };
}

test("layer diff: schema and checks against the anchor", () => {
  const anchor = reading("img1", "gameplay_battle", "PLAY");
  assert.ok(layerDiffSchema().safeParse(DIFF).success);
  assert.equal(layerDiffSchema().safeParse({ ...DIFF, extra: 1 }).success, false);
  assert.deepEqual(layerDiffProblems(DIFF, anchor), []);
  const missing = { ...DIFF, texts: [], headline: "" };
  assert.match(layerDiffProblems(missing, anchor).join(" "), /"PLAY" is missing/);
  const badHex = { ...DIFF, band: { ...DIFF.band, colourHex: "red" } };
  assert.match(layerDiffProblems(badHex, anchor).join(" "), /hex/);
  assert.match(layerDiffProblems({ ...DIFF, headline: "other" }, anchor).join(" "), /headline/);
  const twice = { ...DIFF, texts: [...DIFF.texts, ...DIFF.texts] };
  assert.match(layerDiffProblems(twice, anchor).join(" "), /more than once/);
  assert.deepEqual(layerDiffProblems({ ...DIFF, sameScreen: false, texts: [] }, anchor), []);
});

test("layer diff: the combined reading keeps the screen and passes the checks", () => {
  const anchor = reading("img1", "gameplay_battle", "PLAY");
  const c = combinedReading(anchor, DIFF);
  assert.deepEqual(c.screenshot, anchor.screenshot);
  assert.equal(c.headline, "ãƒãƒˆãƒ«é–‹å§‹");
  assert.equal(c.marketingLayer.texts[0]?.text, "ãƒãƒˆãƒ«é–‹å§‹");
  assert.equal(c.marketingLayer.texts[0]?.language, "ja");
  assert.deepEqual(c.marketingLayer.texts[0]?.region, anchor.marketingLayer.texts[0]?.region);
  assert.equal(c.marketingLayer.backgroundMasks[0]?.colourHex, "#d02020");
  const removed: LayerDiff = {
    ...DIFF,
    texts: [{ ...(DIFF.texts[0] as LayerDiff["texts"][number]), localText: "", change: "removed" }],
    band: { ...DIFF.band, change: "removed" },
    headline: "",
  };
  const bare = combinedReading(anchor, removed);
  assert.equal(bare.marketingLayer.present, false);
  assert.equal(bare.headline, "");
});

test("layer diff: combined readings pass the analysis checks", async () => {
  const { loaded } = await setup();
  const { taxonomy } = loadTaxonomy(loaded);
  const anchor = reading("img1", "gameplay_battle", "PLAY");
  assert.deepEqual(semanticProblems(taxonomy, ["img1"], [combinedReading(anchor, DIFF)]), []);
  const plain = reading("img1", "gameplay_battle", "", false);
  const added: LayerDiff = {
    ...DIFF,
    texts: [{ ...(DIFF.texts[0] as LayerDiff["texts"][number]), anchorText: "", change: "new" }],
    band: { ...DIFF.band, change: "added" },
  };
  assert.deepEqual(semanticProblems(taxonomy, ["img1"], [combinedReading(plain, added)]), []);
});

test("layer diff: crops lie within the image and are stable", async () => {
  const { paths, items } = await setup();
  const db = openImageDb(paths);
  const anchor = reading("img1", "gameplay_battle", "PLAY");
  const id = items[0]?.imageId as string;
  const a = await layerCrops(paths, db, id, anchor);
  const b = await layerCrops(paths, db, id, anchor);
  assert.equal(a.images.length, 2);
  assert.deepEqual(a.hashes, b.hashes);
  const rec = db.get(id);
  for (const im of a.images) {
    const m = await sharp(im.bytes()).metadata();
    assert.ok((m.width ?? 0) > 0 && (m.width ?? 0) <= (rec?.width ?? 0));
    assert.ok((m.height ?? 0) > 0 && (m.height ?? 0) <= (rec?.height ?? 0));
  }
  const none = await layerCrops(paths, db, id, reading("img1", "gameplay_battle", "", false));
  assert.equal(none.images.length, 2);
});

test("layer diff: saved at once, resumable, and a newer anchor makes it not current", async () => {
  const { loaded, paths, items } = await setup();
  const p = fake(() => DIFF);
  const { d } = deps(loaded, p);
  const r = await compareLayers(items, d);
  assert.equal(p.calls.length, 3);
  assert.equal(r.records.length, 3);
  assert.ok(r.records.every((x) => x.status === "ok" && x.paidBy?.batchId === "b1"));
  const again = fake(() => DIFF);
  const r2 = await compareLayers(items, deps(loaded, again).d);
  assert.equal(again.calls.length, 0);
  assert.equal(r2.records.length, 0);
  const anchor = readRecords(paths).get(items[0]?.anchorId as string) as AnalysisRecord;
  assert.ok(isUsable(anchor));
  const prompt = d.prompt.hash;
  assert.ok(currentLayerDiff(paths, items[0]?.imageId as string, anchor, "fake-opus", prompt));
  const newer = { ...anchor, updatedAt: "2026-10-01T00:00:00.000Z" };
  assert.equal(
    currentLayerDiff(paths, items[0]?.imageId as string, newer, "fake-opus", prompt),
    undefined,
  );
  const base = {
    imageId: "a",
    anchorId: "b",
    anchorKey: "k",
    anchorUpdatedAt: "t",
    model: "m",
    promptHash: "p",
  };
  assert.notEqual(layerDiffKey(base), layerDiffKey({ ...base, anchorUpdatedAt: "t2" }));
  const combined = combinedRecord(r.records[0] as NonNullable<(typeof r.records)[0]>, anchor);
  assert.equal(combined?.final?.headline, "ãƒãƒˆãƒ«é–‹å§‹");
  assert.equal(combined?.gl, "jp");
});

test("layer diff: a different screen is listed and nothing more is called", async () => {
  const { loaded, items } = await setup();
  const p = fake(() => ({ ...DIFF, sameScreen: false, sameScreenReason: "another menu" }));
  const { d, failures } = deps(loaded, p);
  const r = await compareLayers(items.slice(0, 1), d);
  assert.equal(p.calls.length, 1);
  assert.deepEqual(r.differentScreens, [items[0]?.imageId]);
  assert.match(failures.join(" "), /full analysis/);
  const again = fake(() => DIFF);
  const r2 = await compareLayers(items.slice(0, 1), deps(loaded, again).d);
  assert.equal(again.calls.length, 0);
  assert.deepEqual(r2.differentScreens, [items[0]?.imageId]);
});

test("layer diff: no budget, no call", async () => {
  const { loaded, items } = await setup();
  const p = fake(() => DIFF);
  const r = await compareLayers(items, deps(loaded, p, 0).d);
  assert.equal(p.calls.length, 0);
  assert.equal(r.stoppedForBudget, true);
});
