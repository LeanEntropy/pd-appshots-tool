import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { z } from "zod";
import { readAttempts } from "../src/analysis/attempts.ts";
import { validatedCall } from "../src/analysis/call.ts";
import { measureColours } from "../src/analysis/colour-measure.ts";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import type { Provider } from "../src/analysis/providers.ts";
import { readRecord } from "../src/analysis/records.ts";
import { runAnalysis } from "../src/analysis/run.ts";
import { textStep } from "../src/analysis/synthesis.ts";
import { type LoadedConfig, projectPaths } from "../src/config/load.ts";
import { savePick } from "../src/core/selection.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { fakeProvider, reading } from "./helpers/fake-provider.ts";
import { PICK } from "./helpers/imported.ts";
import { tempProject } from "./helpers/project.ts";

const DECKS = {
  "Archero 2": { phone: 3, tablet: 0 },
  "Capybara Go": { phone: 2, tablet: 0 },
  "Mini Tales": { phone: 1, tablet: 0 },
  Heroll: { phone: 1, tablet: 0 },
  Dicero: { phone: 1, tablet: 0 },
};

/** A fake producer whose calls take different times, so they finish out of order. */
function jittery(costUsd = 0.1): Provider & { live: number; most: number } {
  const base = fakeProvider({
    model: "claude-fable-5-1",
    read: (p) => ({ screenType: "gameplay", headline: p.slice(-12, -4) }),
    costUsd,
  });
  const p = {
    family: base.family,
    model: base.model,
    live: 0,
    most: 0,
    async call(c: Parameters<Provider["call"]>[0]) {
      p.live++;
      p.most = Math.max(p.most, p.live);
      await new Promise((r) => setTimeout(r, 20 + Math.floor(Math.random() * 40)));
      p.live--;
      return base.call(c);
    },
  };
  return p;
}

async function project(parallel: number): Promise<LoadedConfig> {
  const loaded = await tempProject(DECKS);
  savePick(loaded, PICK, "cli");
  loaded.config.options.speed.parallelCalls = parallel;
  return loaded;
}

const deps = (producer: Provider) => ({
  producer,
  reviewer: null,
  adjudicator: fakeProvider({
    model: "claude-opus-5-5",
    read: () => ({ screenType: "gameplay", headline: "x" }),
  }),
  onProgress: () => {},
});

test("3 calls at a time give exactly the records and attempts of one at a time", async () => {
  const one = await project(1);
  const three = await project(3);
  const p1 = jittery();
  const p3 = jittery();
  const plan1 = buildAnalysisPlan(one, "pilot");
  const plan3 = buildAnalysisPlan(three, "pilot");
  const r1 = await runAnalysis(one, plan1, deps(p1));
  const r3 = await runAnalysis(three, plan3, deps(p3));
  assert.equal(p1.most, 1);
  assert.ok(p3.most > 1 && p3.most <= 3, `at most 3 at once (saw ${p3.most})`);
  const view = (l: LoadedConfig, plan: typeof plan1) =>
    plan.items
      .filter((i) => i.tier === "full")
      .map((i) => {
        const r = readRecord(projectPaths(l), i.imageId);
        const a = readAttempts(projectPaths(l), i.imageId);
        return [i.imageId, r?.status, r?.final?.headline, a.length, a[0]?.state, r?.paidBy?.usd];
      });
  assert.deepEqual(view(three, plan3), view(one, plan1));
  assert.equal(Math.round(r3.spentUsd * 100), Math.round(r1.spentUsd * 100));
});

test("calls at the same time never pass the batch's spending limit", async () => {
  const loaded = await project(3);
  const p = jittery(0.3);
  const out = await runAnalysis(loaded, buildAnalysisPlan(loaded, "pilot"), {
    ...deps(p),
    budgetUsd: 1,
  });
  assert.ok(out.spentUsd <= 1 + 1e-9, `spent ${out.spentUsd}`);
  assert.ok(p.most <= 2, "only two $0.40 reservations fit in $1");
  assert.equal(out.stoppedForBudget, true);
});

test("measured colours: the screen from the capture, the layer and the band from their boxes", async () => {
  const w = 100;
  const h = 200;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const band = y < 60;
      px[i] = band ? 0x1f : 0x2f;
      px[i + 1] = band ? 0x6f : 0x9e;
      px[i + 2] = band ? 0xd0 : 0x4e;
    }
  const img = await sharp(px, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
  const a = reading("img1", "gameplay", "GO");
  a.screenshot.captures[0] = {
    ...(a.screenshot.captures[0] as (typeof a.screenshot.captures)[0]),
    region: { x: 0, y: 0, w: 100, h: 100 },
  };
  a.marketingLayer.backgroundMasks[0] = {
    ...(a.marketingLayer.backgroundMasks[0] as (typeof a.marketingLayer.backgroundMasks)[0]),
    region: { x: 0, y: 0, w: 100, h: 30 },
  };
  a.marketingLayer.texts[0] = {
    ...(a.marketingLayer.texts[0] as (typeof a.marketingLayer.texts)[0]),
    region: { x: 10, y: 5, w: 80, h: 20 },
  };
  const m = await measureColours(img, a, "r1");
  assert.equal(m.screen[0]?.name, "green");
  assert.equal(m.layer[0]?.name, "blue");
  assert.equal(m.masks[0]?.hex, "#1f6fd0");
  assert.equal(m.basedOn, "r1");
});

test("a text step answered under the older prompt order is still used, with no model call", async () => {
  const loaded = await project(1);
  const paths = projectPaths(loaded);
  const writer = fakeProvider({ read: () => ({ screenType: "gameplay", headline: "x" }) });
  const schema = z.object({ rationale: z.string() }).passthrough();
  const ctx = {
    storage: workspaceStorage(paths.workspace),
    answerKey: (step: string, key: string) => `shared/test/${step}/${key}.json`,
    taxonomy: { id: "t", version: "1", screenTypes: [], definitions: {}, subtypeLabels: {} },
    taxonomyHash: "t",
    maxBudgetUsd: 1,
    remainingUsd: () => 1,
    timeoutMs: 1000,
    onCost: () => {},
  };
  const system = { text: "s", hash: "h", file: "f" };
  const before = "Write the recommendations.\n\nfacts between 3 and 3";
  await validatedCall("recommend", writer, system, before, [], schema, () => [], ctx);
  const calls = writer.calls.length;
  const r = await textStep(
    "recommend",
    writer,
    system,
    { now: "facts between 3 and 3\n\nWrite the recommendations.", before },
    schema,
    () => [],
    ctx,
  );
  assert.ok(r.value);
  assert.equal(writer.calls.length, calls, "served from the saved answer");
});
