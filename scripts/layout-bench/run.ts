/**
 * Paid part of the layout benchmark: the 4 sample images through the production call path
 * (full-analysis prompt + layout block, split validation, image inside the request), one call
 * at a time, capped at $1.20 for everything including repairs. Re-running only calls images
 * without a saved answer (the answer cache), so a stopped run resumes for free.
 * Usage: BENCH_ROOT=<scratch>/layout-root npx tsx scripts/layout-bench/run.ts
 */
import { join } from "node:path";
import type { CallLog, StoredObject } from "../../src/analysis/call.ts";
import { analyseImages } from "../../src/analysis/call-images.ts";
import { runPool, sleepUnlessStopped } from "../../src/analysis/pool.ts";
import { renderAnalysisPrompt } from "../../src/analysis/prompts.ts";
import { providerFor } from "../../src/analysis/providers.ts";
import type { ImageAnalysis } from "../../src/analysis/schema.ts";
import { loadTaxonomy } from "../../src/config/load.ts";
import { workspaceStorage } from "../../src/storage/index.ts";
import { benchContext, BENCH_ROOT, IMAGES, load, need, readSpend, REPO, writeOut } from "./common.ts";

export interface BenchRun {
  prompt: { hash: string; chars: number; blockChars: number };
  wallMs: number;
  images: {
    name: string;
    imageId: string;
    reading: ImageAnalysis | null;
    failed: string | null;
    object: string | null;
    output: unknown;
    attempts: number | null;
    calls: CallLog[];
  }[];
}

async function main(): Promise<void> {
  need();
  const loaded = load();
  const { taxonomy } = loadTaxonomy(loaded);
  const ctx = benchContext(loaded);
  const calls: CallLog[] = [];
  const onCall = ctx.onCall;
  ctx.onCall = (c) => {
    calls.push(c);
    onCall?.(c);
  };
  const objects = join(BENCH_ROOT, "objects");
  const speed = loaded.config.options.speed;
  const provider = providerFor(loaded.config.models.fullAnalysis, join(objects, "schemas"), {
    inlineImages: speed.inlineImages,
  });
  const prompt = renderAnalysisPrompt(REPO, objects, taxonomy, false, true);
  const plain = renderAnalysisPrompt(REPO, objects, taxonomy, false, false);
  const store = workspaceStorage(join(BENCH_ROOT, "workspace"));
  const out: BenchRun = {
    prompt: {
      hash: prompt.hash,
      chars: prompt.text.length,
      blockChars: prompt.text.length - plain.text.length,
    },
    wallMs: 0,
    images: [],
  };
  const t0 = Date.now();
  await runPool(IMAGES, {
    // One at a time: each call reserves its $0.45 ceiling, and the cap is $1.20 in total.
    concurrency: 1,
    gate: () => ctx.remainingUsd() > 0.01,
    run: async (im) => {
      const key = `library/images/model/${im.id}-1568.jpg`;
      const image = {
        mimeType: "image/jpeg",
        localPath: store.localPath(key),
        bytes: () => store.getBytes(key) ?? Buffer.alloc(0),
      };
      const r = await analyseImages(
        "full-analysis",
        provider,
        prompt,
        [{ imageId: im.id, image }],
        ctx,
        false,
        true,
      );
      const objKey = r.objects.get(im.id) ?? null;
      const obj = objKey
        ? (store.getJson(ctx.answerKey("full-analysis", objKey)) as StoredObject | undefined)
        : undefined;
      out.images.push({
        name: im.name,
        imageId: im.id,
        reading: r.readings.get(im.id) ?? null,
        failed: r.failed.get(im.id) ?? null,
        object: objKey,
        output: obj?.output ?? null,
        attempts: obj?.attempts ?? null,
        calls: calls.filter((c) => c.imageIds.includes(im.id)),
      });
      console.log(`${im.name}: ${r.failed.get(im.id) ?? "ok"} (spent $${readSpend().usd})`);
      return { ok: true, paid: calls.some((c) => c.imageIds.includes(im.id)) };
    },
    shouldStop: () => false,
    sleep: sleepUnlessStopped,
    slowDown: (ms) => console.log(`rate limited, waiting ${ms} ms`),
  });
  out.wallMs = Date.now() - t0;
  writeOut("run.json", out);
  console.log(`spent in total: $${readSpend().usd.toFixed(4)}`);
}

await main();
