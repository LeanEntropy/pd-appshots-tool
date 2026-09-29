/**
 * Paid part of the layout benchmark, separate-call version (approved 2026-09-29, hard cap $0.80):
 * the production layout call (src/layout/call.ts) on the 4 sample images, one at a time, each
 * given the image and its finished main analysis. Main analyses are NOT re-run: the 3 images
 * checked this morning use their paired run without layout (same-call/paired.json, today's
 * prompt); Survivor.io uses its saved record. Writes run.json in the shape score.ts reads.
 * Usage: BENCH_ROOT=<scratch>/layout-root npx tsx scripts/layout-bench/separate.ts
 */
import { join } from "node:path";
import type { CallLog } from "../../src/analysis/call.ts";
import { renderLayoutPrompt } from "../../src/analysis/prompts.ts";
import { providerFor } from "../../src/analysis/providers.ts";
import type { AnalysisRecord } from "../../src/analysis/records.ts";
import type { ImageAnalysis } from "../../src/analysis/schema.ts";
import { loadTaxonomy } from "../../src/config/load.ts";
import { layoutCall } from "../../src/layout/call.ts";
import { workspaceStorage } from "../../src/storage/index.ts";
import { BENCH_ROOT, benchContext, IMAGES, load, need, readOut, readSpend, REPO, writeOut } from "./common.ts";

const CAP = 0.8;
const SPEND = "spend.json";

async function main(): Promise<void> {
  need();
  const loaded = load();
  const { taxonomy } = loadTaxonomy(loaded);
  const objects = join(BENCH_ROOT, "objects");
  const provider = providerFor(loaded.config.models.fullAnalysis, join(objects, "schemas"), {
    inlineImages: loaded.config.options.speed.inlineImages,
  });
  const prompt = renderLayoutPrompt(REPO, objects, taxonomy);
  const store = workspaceStorage(join(BENCH_ROOT, "workspace"));
  const paired = readOut<{ images: { imageId: string; reading: ImageAnalysis }[] }>("same-call/paired.json");
  const images = [];
  for (const im of IMAGES) {
    const saved = [...store.list(`library/analysis/${im.id}`)]
      .map((k) => store.getJson(k) as AnalysisRecord)
      .find((r) => r?.final)?.final;
    const reading = paired?.images.find((x) => x.imageId === im.id)?.reading ?? saved;
    if (!reading) throw new Error(`no reading for ${im.name}`);
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
    const r = await layoutCall(provider, prompt, { imageId: im.id, image }, reading, ctx);
    images.push({
      name: im.name,
      imageId: im.id,
      readingFrom: paired?.images.some((x) => x.imageId === im.id) ? "paired run (today's prompt)" : "saved record",
      reading,
      output: { images: [{ layout: r.layout }] },
      failed: r.layout ? null : r.problems.join("; "),
      problems: r.problems,
      calls,
    });
    console.log(`${im.name}: ${r.layout ? "ok" : `FAILED ${r.problems.join("; ")}`} (spent $${readSpend(SPEND).usd})`);
  }
  writeOut("run.json", { separate: true, prompt: { hash: prompt.hash, chars: prompt.text.length, blockChars: prompt.text.length }, images });
}

await main();
