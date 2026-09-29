import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryOf } from "../src/analysis/categories.ts";
import { compareReadings } from "../src/analysis/compare.ts";
import { artMessage, showsLogo } from "../src/analysis/image-tags.ts";
import { labeler } from "../src/analysis/labels.ts";
import { layerDiffTask } from "../src/analysis/layer-diff-schema.ts";
import { compareOurs } from "../src/analysis/ours-vs.ts";
import { patternFit } from "../src/analysis/pattern-fit.ts";
import { type DeckEntry, findPatterns } from "../src/analysis/patterns.ts";
import { acceptedKeys, analysisKey, currentPipeline } from "../src/analysis/pipeline.ts";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import type { Provider } from "../src/analysis/providers.ts";
import { isUsable, readRecord } from "../src/analysis/records.ts";
import { runAnalysis } from "../src/analysis/run.ts";
import { type ImageAnalysis, LEAN_SCHEMA_VERSION, toJsonSchema } from "../src/analysis/schema.ts";
import { captureShare, expandLean, leanDeckSchema } from "../src/analysis/schema-lean.ts";
import { brief } from "../src/analysis/synthesis.ts";
import { projectPaths } from "../src/config/load.ts";
import { runImport } from "../src/library/import/run-import.ts";
import { reading } from "./helpers/fake-provider.ts";
import { legacyProject, providers } from "./helpers/imported.ts";

const TAXONOMY = {
  id: "t",
  version: "1",
  screenTypes: [
    { id: "gameplay", label: "Gameplay", subtypes: [] },
    { id: "title_image", label: "Title", subtypes: [] },
  ],
  definitions: {},
  subtypeLabels: {},
};

test("the lean answer leaves out only the fields nothing reads, and stays strict", () => {
  const js = JSON.stringify(toJsonSchema(leanDeckSchema(TAXONOMY)));
  for (const cut of ['"confidence"', '"breaksFrame"', '"scale"', '"captureAreaPercent"'])
    assert.ok(!js.includes(cut), `${cut} is not asked for`);
  for (const kept of ['"mainColours"', '"notes"', '"headline"', '"region"', '"description"'])
    assert.ok(js.includes(kept), `${kept} is still asked for`);
  assert.ok(!js.includes('"additionalProperties":true'));
  const lean = strip(reading("img1", "gameplay", "GO"));
  const full = expandLean(lean);
  assert.equal(full.screenshot.captureAreaPercent, 85, "the capture share is added up by code");
  assert.equal(full.confidence, undefined, "nothing is invented");
  assert.equal(captureShare([{ areaPercent: 70 }, { areaPercent: 45 }]), 100);
});

/** A reading as the lean answer: the cut fields removed, the capture share left to code. */
function strip(a: ImageAnalysis): ImageAnalysis {
  const { confidence: _c, ...rest } = a;
  const { captureAreaPercent: _s, ...screenshot } = a.screenshot;
  return {
    ...rest,
    screenshot: {
      ...screenshot,
      captures: a.screenshot.captures.map(({ description: _d, ...c }) => c),
    } as ImageAnalysis["screenshot"],
    marketingLayer: {
      ...a.marketingLayer,
      elements: a.marketingLayer.elements.map(({ scale: _x, breaksFrame: _b, ...e }) => e),
    },
  };
}

function withElement(a: ImageAnalysis): ImageAnalysis {
  const m = a.marketingLayer;
  if (!m.present) return a;
  const el = {
    kind: "logo" as const,
    what: "the game logo",
    position: "top",
    pose: "n/a",
    colours: "gold",
    scale: "large" as const,
    breaksFrame: true,
    region: { x: 10, y: 0, w: 30, h: 10 },
  };
  return { ...a, marketingLayer: { ...m, elements: [el] } };
}

test("the cut fields feed nothing: every downstream input is identical without them", () => {
  const games = ["Archero 2", "Capybara Go", "Heroll", "Rogue Legends"];
  const entries = (cut: boolean): DeckEntry[] =>
    games.flatMap((name, g) =>
      [1, 2, 3].map((position) => {
        const base = withElement(
          reading(
            `img${position}`,
            position === 1 ? "title_image" : "gameplay",
            `${name} WINS`,
            g !== 2,
          ),
        );
        return {
          appId: `app${g}`,
          name,
          position,
          imageId: `${g}-${position}`,
          canvas: "portrait" as const,
          final: cut ? expandLean(strip(base)) : base,
        };
      }),
    );
  const run = (cut: boolean) => {
    const all = entries(cut);
    const ours = all.filter((e) => e.name === "Rogue Legends");
    const comp = all.filter((e) => e.name !== "Rogue Legends");
    const decks = games.slice(0, 3).map((name, g) => ({ appId: `app${g}`, name, deckLength: 3 }));
    const p = findPatterns(comp, decks);
    const L = labeler(TAXONOMY);
    return {
      p,
      ours: compareOurs(ours, p, 3, L),
      fit: patternFit(comp, ours, p, 3, L),
      lines: all.map(brief),
      tags: all.map((e) => [
        categoryOf(e.final),
        showsLogo(e.final, e.name),
        artMessage(e.final, e.name),
      ]),
      anchors: all.map((e) => layerDiffTask(e.final, { label: "Japan", hl: "ja" })),
      compare: compareReadings(all[0]?.final as ImageAnalysis, all[4]?.final as ImageAnalysis),
    };
  };
  assert.deepEqual(run(true), run(false));
});

/** The fake producer, answering only what the schema asks (the lean answer has fewer fields). */
function shapeAware(p: Provider): Provider {
  return {
    ...p,
    async call(c) {
      const r = await p.call(c);
      if (JSON.stringify(c.schema).includes('"confidence"') || !r.ok) return r;
      const out = r.output as { images: ImageAnalysis[] };
      return { ...r, output: { images: out.images.map(strip) } };
    },
  };
}

test("keys: the lean pipeline reuses every full record; the full pipeline never reads a lean one", async () => {
  const { loaded, root } = await legacyProject();
  await runImport({ root, configPath: loaded.path, apply: true });
  const full = currentPipeline(loaded.config);
  loaded.config.options.speed.leanAnswer = true;
  const lean = currentPipeline(loaded.config);
  assert.deepEqual(acceptedKeys(lean), [analysisKey(lean), analysisKey(full)]);
  assert.deepEqual(acceptedKeys(full), [analysisKey(full)]);
  // Nothing is analysed again when the shorter answer is switched on.
  assert.equal(buildAnalysisPlan(loaded, "pilot").counts.full, 0);
  const core = buildAnalysisPlan(loaded, "core");
  const extra = core.items.filter((i) => i.tier === "full");
  assert.ok(extra.length > 0);
  const deps = providers();
  await runAnalysis(loaded, core, { ...deps, producer: shapeAware(deps.producer), reviewer: null });
  const paths = projectPaths(loaded);
  for (const it of extra) {
    const r = readRecord(paths, it.imageId);
    assert.ok(isUsable(r), "lean records are usable");
    assert.equal(r.schema, LEAN_SCHEMA_VERSION);
    assert.equal(r.final.confidence, undefined);
    assert.equal(typeof r.final.screenshot.captureAreaPercent, "number");
  }
  // Back to the full answer: the lean records are not accepted, those images are planned again.
  loaded.config.options.speed.leanAnswer = false;
  for (const it of extra) assert.ok(!isUsable(readRecord(projectPaths(loaded), it.imageId)));
  assert.equal(buildAnalysisPlan(loaded, "core").counts.full, extra.length);
});
