/**
 * Paired check for gate 3 (approved 2026-09-29, about $0.45, hard cap $0.60): the 3 images whose
 * main analysis changed, run with the CURRENT full-analysis prompt WITHOUT the layout block,
 * same model and path, in the scratch copy. Compared with the with-layout answers of run.json,
 * this shows whether the layout request or the newer prompt / run-to-run variation moved them.
 * Usage: BENCH_ROOT=<scratch>/layout-root npx tsx scripts/layout-bench/paired.ts
 */
import { join } from "node:path";
import type { CallLog } from "../../src/analysis/call.ts";
import { analyseImages } from "../../src/analysis/call-images.ts";
import { renderAnalysisPrompt } from "../../src/analysis/prompts.ts";
import { providerFor } from "../../src/analysis/providers.ts";
import type { ImageAnalysis } from "../../src/analysis/schema.ts";
import { loadTaxonomy } from "../../src/config/load.ts";
import { workspaceStorage } from "../../src/storage/index.ts";
import { BENCH_ROOT, benchContext, IMAGES, load, need, readOut, readSpend, REPO, writeOut } from "./common.ts";

const CAP = 0.6;
const SPEND = "spend-paired.json";
const NAMES = ["archero2-4", "roguelegend-1", "legend-of-mushroom-3"];

export interface PairedRun {
  prompt: { hash: string; chars: number };
  images: { name: string; imageId: string; reading: ImageAnalysis | null; failed: string | null; calls: CallLog[] }[];
}

async function main(): Promise<void> {
  need();
  const loaded = load();
  const { taxonomy } = loadTaxonomy(loaded);
  const objects = join(BENCH_ROOT, "objects");
  const provider = providerFor(loaded.config.models.fullAnalysis, join(objects, "schemas"), {
    inlineImages: loaded.config.options.speed.inlineImages,
  });
  const prompt = renderAnalysisPrompt(REPO, objects, taxonomy, false, false);
  const store = workspaceStorage(join(BENCH_ROOT, "workspace"));
  const prev = readOut<PairedRun>("paired.json");
  const out: PairedRun = { prompt: { hash: prompt.hash, chars: prompt.text.length }, images: [] };
  for (const im of IMAGES.filter((i) => NAMES.includes(i.name))) {
    const ctx = benchContext(loaded, CAP, SPEND, true);
    const calls: CallLog[] = [];
    const onCall = ctx.onCall;
    ctx.onCall = (c) => {
      calls.push(c);
      onCall?.(c);
    };
    const key = `library/images/model/${im.id}-1568.jpg`;
    const image = {
      mimeType: "image/jpeg",
      localPath: store.localPath(key),
      bytes: () => store.getBytes(key) ?? Buffer.alloc(0),
    };
    const r = await analyseImages("full-analysis", provider, prompt, [{ imageId: im.id, image }], ctx);
    const before = prev?.images.find((x) => x.imageId === im.id)?.calls ?? [];
    out.images.push({
      name: im.name,
      imageId: im.id,
      reading: r.readings.get(im.id) ?? null,
      failed: r.failed.get(im.id) ?? null,
      calls: calls.length ? calls : before,
    });
    console.log(`${im.name}: ${r.failed.get(im.id) ?? "ok"} (spent $${readSpend(SPEND).usd})`);
  }
  writeOut("paired.json", out);
}

await main();
