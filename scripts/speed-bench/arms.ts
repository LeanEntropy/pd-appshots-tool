/**
 * Paid part of the speed benchmark. Usage (tsx): arms.ts spike | new | control
 * - spike: ONE call with the new path (lean answer, image inside the request, no tools).
 * - new: the 10 images, lean answer, image inline if the spike passed, 3 calls at a time.
 * - control: the 10 images with today's pipeline (full answer, Read tool), one at a time.
 */
import { join } from "node:path";
import type { CallLog, ChunkImage } from "../../src/analysis/call.ts";
import { analyseImages } from "../../src/analysis/call-images.ts";
import { runPool, sleepUnlessStopped } from "../../src/analysis/pool.ts";
import { renderAnalysisPrompt } from "../../src/analysis/prompts.ts";
import { providerFor } from "../../src/analysis/providers.ts";
import { claudeArgs } from "../../src/analysis/providers-claude.ts";
import { modelCopy } from "../../src/analysis/run-chunk.ts";
import type { ImageAnalysis } from "../../src/analysis/schema.ts";
import { loadTaxonomy, projectPaths } from "../../src/config/load.ts";
import { openImageDb } from "../../src/store/imagedb.ts";
import { run } from "../../src/util/proc.ts";
import {
  benchContext,
  fullIds,
  load,
  need,
  readOut,
  readSpend,
  REPO,
  writeOut,
} from "./common.ts";

export interface ArmResult {
  arm: string;
  inline: boolean;
  lean: boolean;
  concurrency: number;
  wallMs: number;
  readings: Record<string, ImageAnalysis | null>;
  failed: Record<string, string>;
  calls: CallLog[];
}

interface Spike {
  ok: boolean;
  turns: number | null;
  cliVersion: string;
  command: string[];
  problems: string[];
  call: CallLog | null;
}

async function main(): Promise<void> {
  need();
  const mode = process.argv[2] ?? "";
  if (!["spike", "new", "control"].includes(mode)) throw new Error("mode: spike | new | control");
  const loaded = load();
  const paths = projectPaths(loaded);
  const db = openImageDb(paths);
  const { taxonomy } = loadTaxonomy(loaded);
  const ids = fullIds(loaded);
  const spike = readOut<Spike>("spike.json");
  const lean = mode !== "control";
  const inline = mode === "spike" || (mode === "new" && !!spike?.ok);
  if (mode === "new" && !spike) throw new Error("Run the spike first.");
  const arm = mode === "control" ? "control" : "new";
  const ctx = benchContext(loaded, arm);
  const calls: CallLog[] = [];
  const onCall = ctx.onCall;
  ctx.onCall = (c) => {
    calls.push(c);
    onCall?.(c);
  };
  const provider = providerFor(loaded.config.models.fullAnalysis, join(paths.objects, "schemas"), {
    inlineImages: inline,
  });
  const prompt = renderAnalysisPrompt(REPO, paths.objects, taxonomy, lean);
  // Control goes last and may not fit whole under the cap: the images with the most critical
  // fields (ours, full-screen art, Japanese text) first.
  const CONTROL_FIRST = ["704a", "7faf", "f2b0", "9874", "dd85", "a09e", "5064", "ce1c", "fe87"];
  const rank = (id: string) => {
    const i = CONTROL_FIRST.findIndex((p) => id.startsWith(p));
    return i < 0 ? 99 : i;
  };
  const order = mode === "control" ? [...ids].sort((a, b) => rank(a) - rank(b)) : ids;
  const images: ChunkImage[] = [];
  for (const id of mode === "spike" ? ids.slice(0, 1) : order)
    images.push({ imageId: id, image: await modelCopy(paths, db, id) });

  const result: ArmResult = {
    arm,
    inline,
    lean,
    concurrency: mode === "new" ? 3 : 1,
    wallMs: 0,
    readings: {},
    failed: {},
    calls,
  };
  const t0 = Date.now();
  await runPool(images, {
    concurrency: result.concurrency,
    gate: () => ctx.remainingUsd() > 0.3,
    run: async (im) => {
      const r = await analyseImages("full-analysis", provider, prompt, [im], ctx, lean);
      result.readings[im.imageId] = r.readings.get(im.imageId) ?? null;
      const f = r.failed.get(im.imageId);
      if (f) result.failed[im.imageId] = f;
      console.log(`${arm} ${im.imageId.slice(0, 10)}: ${f ? `FAILED ${f}` : "ok"}`);
      return true;
    },
    shouldStop: () => false,
    sleep: sleepUnlessStopped,
    slowDown: (ms) => console.log(`rate limited, waiting ${ms} ms`),
    rateLimit: () => null,
  });
  result.wallMs = Date.now() - t0;

  if (mode === "spike") {
    const call = calls[0] ?? null;
    const version = await run("claude", ["--version"], { timeoutMs: 60_000 });
    const out: Spike = {
      // One model request: the answer came without a Read-tool round.
      ok: !!result.readings[ids[0] as string] && call?.usage?.requests === 1,
      turns: call?.usage?.turns ?? null,
      cliVersion: version.stdout.trim(),
      command: claudeArgs(
        provider.model,
        {
          model: provider.model,
          system: prompt,
          prompt: "<task>",
          images: [],
          schema: { "...": "the lean answer schema" },
          maxBudgetUsd: 0.6,
          timeoutMs: 0,
        },
        true,
      ),
      problems: Object.values(result.failed),
      call,
    };
    writeOut("spike.json", out);
    console.log(JSON.stringify({ ok: out.ok, turns: out.turns, usage: call?.usage, cost: call?.costUsd }));
  } else {
    writeOut(`arm-${arm}.json`, result);
  }
  console.log(`spent so far: $${readSpend().usd.toFixed(4)}`);
}

await main();
