import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { cropBoxes, type LayerPixel, layerCrops, layerParts } from "../src/analysis/layer-crops.ts";
import { compareLayer } from "../src/analysis/layer-diff.ts";
import {
  CROP_VERSION,
  type LayerDiff,
  layerAnswerSchema,
  layerDiffTask,
} from "../src/analysis/layer-diff-schema.ts";
import { renderReportPrompt } from "../src/analysis/prompts.ts";
import type { Provider, VisionCall } from "../src/analysis/providers.ts";
import type { AnalysisRecord } from "../src/analysis/records.ts";
import { type ImageAnalysis, SCHEMA_VERSION } from "../src/analysis/schema.ts";
import { loadTaxonomy, projectPaths } from "../src/config/load.ts";
import { answerKey } from "../src/library/layout.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { type ImageRecord, openImageDb } from "../src/store/imagedb.ts";
import type { PixelResult } from "../src/store/pixel-diff.ts";
import { builderProject } from "./helpers/builder.ts";
import { reading } from "./helpers/fake-provider.ts";

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

/** An anchor reading with texts at the given boxes. */
function anchorWith(boxes: { x: number; y: number; w: number; h: number }[]): ImageAnalysis {
  const a = reading("img1", "gameplay_battle", "PLAY");
  const t = a.marketingLayer.texts[0] as ImageAnalysis["marketingLayer"]["texts"][number];
  return {
    ...a,
    marketingLayer: {
      ...a.marketingLayer,
      texts: boxes.map((region, i) => ({ ...t, text: `T${i}`, region })),
    },
  };
}

const pixel = (verdict: LayerPixel["verdict"], areas: PixelResult["areas"] = []): LayerPixel => ({
  verdict,
  result: {
    version: "pixel-check.v1",
    imageId: "i",
    anchorId: "a",
    regions: "r",
    changed: 0.02,
    inside: 0.02,
    outside: verdict === "same-new-text" ? 0 : 0.02,
    bandOnly: 0,
    elements: 0,
    areas,
  },
});

test("text comparison crops: texts and changed areas, near boxes share a crop, at most 3", () => {
  const anchor = anchorWith([box(5, 2, 40, 5), box(50, 3, 40, 5), box(10, 90, 30, 4)]);
  const two = cropBoxes(anchor);
  assert.equal(two.length, 2, JSON.stringify(two));
  assert.ok((two[0]?.w ?? 0) > 80, "the two headline parts share one crop");
  const many = cropBoxes(
    anchor,
    pixel("same-screen", [box(10, 40, 5, 5), box(80, 60, 5, 5), box(40, 75, 5, 5)]),
  );
  assert.ok(many.length <= 3, JSON.stringify(many));
  for (const b of many) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 100 && b.y + b.h <= 100);
  const covers = (x: number, y: number) =>
    many.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
  for (const [x, y] of [
    [12, 42],
    [82, 62],
    [42, 77],
    [20, 4],
    [20, 92],
  ] as const)
    assert.ok(covers(x, y), `${x},${y} is in a crop`);
  assert.deepEqual(cropBoxes(reading("img1", "gameplay_battle", "", false)), []);
});

test("text comparison crops: native resolution up to 1024 px, nothing over 1568, small copy only when needed", async () => {
  const loaded = await builderProject();
  const paths = projectPaths(loaded);
  const file = join(mkdtempSync(join(tmpdir(), "crop-")), "big.png");
  writeFileSync(
    file,
    await sharp({ create: { width: 2400, height: 4200, channels: 3, background: "#3070c0" } })
      .png()
      .toBuffer(),
  );
  const rec = { id: "big", file: "big.png", width: 2400, height: 4200 } as ImageRecord;
  const db = { get: () => rec, abs: () => file };
  const anchor = anchorWith([box(5, 2, 90, 10), box(10, 80, 80, 15)]);
  const sizes = async (images: { bytes: () => Buffer }[]) =>
    Promise.all(images.map(async (i) => sharp(i.bytes()).metadata()));
  const plain = await layerCrops(paths, db, "big", anchor);
  const same = await layerCrops(paths, db, "big", anchor, pixel("same-new-text"));
  const whole = await layerCrops(paths, db, "big", reading("i", "gameplay_battle", "", false));
  assert.equal(plain.images.length, 3, "two crops and the small whole copy");
  assert.equal(same.images.length, 2, "same screen: no small whole copy");
  for (const m of await sizes([...plain.images, ...same.images, ...whole.images])) {
    const edge = Math.max(m.width ?? 0, m.height ?? 0);
    assert.ok(edge <= 1024 && edge <= 1568, String(edge));
  }
  const last = (await sizes(plain.images)).at(-1);
  assert.equal(Math.max(last?.width ?? 0, last?.height ?? 0), 384);
  assert.equal(CROP_VERSION, "layer-crop.v2");
});

const answerOf = (): Omit<LayerDiff, "band" | "elements"> => ({
  sameScreen: true,
  sameScreenReason: "",
  texts: [
    {
      role: "headline",
      anchorText: "PLAY",
      localText: "プレイ",
      backTranslation: "play",
      language: "ja",
      change: "translated",
      notes: "",
    },
  ],
  genreTerms: [],
  headline: "プレイ",
  wordingNotes: "",
});

test("text comparison: only what changed is asked; code fills band and elements", async () => {
  const anchor = reading("img1", "gameplay_battle", "PLAY");
  const full = JSON.parse(
    layerDiffTask(anchor, { label: "Japan", hl: "ja" })
      .split("\n")
      .find((l) => l.startsWith("{")) as string,
  );
  assert.ok(full.masks && full.elements && full.screen);
  const parts = layerParts(pixel("same-new-text"));
  assert.deepEqual(parts, { band: false, elements: false, screen: false, whole: false });
  const task = layerDiffTask(anchor, { label: "Japan", hl: "ja" }, parts);
  const lean = JSON.parse(task.split("\n").find((l) => l.startsWith("{")) as string);
  assert.deepEqual(Object.keys(lean).sort(), ["band", "elements", "headline", "present", "texts"]);
  assert.equal(lean.band, "none");
  assert.deepEqual(Object.keys(lean.texts[0]).sort(), ["language", "position", "role", "text"]);
  assert.match(task, /whole image is not sent/);
  assert.equal(layerParts(pixel("same-screen")).screen, true);
  assert.equal(layerAnswerSchema(parts).safeParse({ ...answerOf(), band: {} }).success, false);
  // One comparison with the pixel check: the model is not asked about the band.
  const loaded = await builderProject();
  const paths = projectPaths(loaded);
  const { taxonomy, hash } = loadTaxonomy(loaded);
  const answer = answerOf();
  const calls: VisionCall[] = [];
  const provider: Provider = {
    family: "anthropic",
    model: "fake-opus",
    async call(c) {
      calls.push(c);
      return { ok: true, output: answer, costUsd: 0.01, error: null };
    },
  };
  const db = openImageDb(paths);
  const img = db.all()[0] as ImageRecord;
  const rec: AnalysisRecord & { final: ImageAnalysis } = {
    imageId: "anchor",
    schema: SCHEMA_VERSION,
    appId: "g",
    gl: "us",
    hl: "en",
    position: 1,
    status: "ok",
    final: anchor,
    producer: null,
    reviewer: null,
    adjudication: null,
    differences: [],
    problems: [],
    runId: "r",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };
  const r = await compareLayer(
    { imageId: img.id, appId: "g", gl: "jp", hl: "ja", position: 1, label: "Japan" },
    rec,
    {
      paths,
      db,
      provider,
      prompt: renderReportPrompt(loaded.root, paths.objects, "layerDiff", taxonomy),
      ctx: {
        storage: workspaceStorage(paths.workspace),
        answerKey: (step, key) => answerKey(paths, step, key),
        taxonomy,
        taxonomyHash: hash,
        maxBudgetUsd: 1,
        remainingUsd: () => 5,
        timeoutMs: 1000,
        onCost: () => {},
      },
      runId: "r",
      pixel: pixel("same-new-text"),
    },
  );
  assert.equal(calls.length, 1);
  const props = (calls[0] as VisionCall).schema.properties as Record<string, unknown>;
  assert.ok(!("band" in props) && !("elements" in props));
  assert.equal(calls[0]?.images.length, 1, "one crop, no small whole copy");
  assert.equal(r.status, "ok");
  assert.equal(r.diff?.band.change, "none");
  assert.equal(r.diff?.elements.change, "none");
  assert.deepEqual(r.pixel, { verdict: "same-new-text", outside: 0 });
});
