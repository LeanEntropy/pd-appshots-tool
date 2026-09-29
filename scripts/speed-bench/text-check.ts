/**
 * Paid check of the text-reading rules (full-analysis.v8): the 4 images the user judged in
 * docs/samples/speed-benchmark/ (judgement.json picks the answer, results.json holds its
 * texts), read again with today's pipeline (full answer, image inside the request) and
 * compared with the answers the user marked right.
 * Runs against a SCRATCH copy only (BENCH_ROOT/workspace), like the speed benchmark.
 * Usage (tsx): text-check.ts        -> shows the plan and the estimate, calls nothing
 *              text-check.ts --paid -> runs the 4 calls (hard cap CHECK_CAP_USD)
 */
import { join } from "node:path";
import { analyseImages, type ChunkImage } from "../../src/analysis/call.ts";
import { renderAnalysisPrompt } from "../../src/analysis/prompts.ts";
import { providerFor } from "../../src/analysis/providers.ts";
import { modelCopy } from "../../src/analysis/run-chunk.ts";
import { loadTaxonomy, projectPaths } from "../../src/config/load.ts";
import { openImageDb } from "../../src/store/imagedb.ts";
import { benchContext, fullIds, load, need, readSpend, REPO, writeOut } from "./common.ts";

const CHECK_CAP_USD = 1.2;
/** Most one call may spend (the CLI stops it there); the highest benchmark call was $0.31. */
const PER_CALL_USD = 0.45;

/** The user's judgement (2026-09-29): the right marketing texts, sorted like the benchmark. */
const CASES = [
  { prefix: "704abf82ee", name: "Rogue Legends US #4", right: ["EVERY BOARD", "NEW ADVENTURE !"] },
  { prefix: "7faff58709", name: "Rogue Legends US #2", right: ["BATTLE AND", "LEVEL UP!"] },
  { prefix: "afd912586a", name: "Overgeared Hero US #2", right: ["UPGRADE"] },
  {
    prefix: "98742f3c3a",
    name: "Capybara Go US #2",
    right: ["Big Win !", "DAY 2", "LIVING IS FORTUNE"],
    // The new block rule splits a two-colour title; the user has not ruled on this split yet.
    alsoFine: ["Big Win !", "DAY 2", "FORTUNE", "LIVING IS"],
  },
];

/** Per-image cost of today's pipeline in the speed benchmark (spend.json), first call first. */
const ESTIMATE = { firstUsd: 0.31, restUsd: [0.14, 0.19, 0.15] };

const sorted = (xs: string[]) => [...xs].sort();
const same = (a: string[], b: string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

async function main(): Promise<void> {
  const paid = process.argv.includes("--paid");
  const est = ESTIMATE.firstUsd + ESTIMATE.restUsd.reduce((a, b) => a + b, 0);
  console.log(`Text-reading check: ${CASES.length} images, 1 call each, full answer, inline image.`);
  for (const c of CASES) console.log(`- ${c.name} (${c.prefix}): expect ${JSON.stringify(c.right)}`);
  console.log(`Estimated cost: about $${est.toFixed(2)} (hard cap $${CHECK_CAP_USD.toFixed(2)}).`);
  if (!paid) {
    console.log("Nothing was called. Run again with --paid after the user approves.");
    return;
  }
  need();
  if (readSpend().usd > 0) throw new Error("BENCH_OUT already has spending: use a fresh folder.");
  const loaded = load();
  loaded.config.options.speed.leanAnswer = false;
  const paths = projectPaths(loaded);
  const db = openImageDb(paths);
  const { taxonomy } = loadTaxonomy(loaded);
  const all = fullIds(loaded);
  const ctx = benchContext(loaded, "text-check");
  ctx.maxBudgetUsd = PER_CALL_USD;
  const provider = providerFor(loaded.config.models.fullAnalysis, join(paths.objects, "schemas"), {
    inlineImages: true,
  });
  const prompt = renderAnalysisPrompt(REPO, paths.objects, taxonomy, false);
  const rows = [];
  for (const c of CASES) {
    // Hard cap: a call starts only when even its most expensive outcome stays under the cap.
    if (readSpend().usd + PER_CALL_USD > CHECK_CAP_USD) {
      console.log(`Stopped before ${c.name}: the cap is near.`);
      break;
    }
    const id = all.find((x) => x.startsWith(c.prefix));
    if (!id) throw new Error(`image ${c.prefix} not found`);
    const im: ChunkImage = { imageId: id, image: await modelCopy(paths, db, id) };
    const r = await analyseImages("full-analysis", provider, prompt, [im], ctx, false);
    const reading = r.readings.get(id);
    const texts = reading?.marketingLayer.texts.map((t) => t.text) ?? [];
    const verdict = !reading
      ? `FAILED ${r.failed.get(id) ?? ""}`
      : same(texts, c.right)
        ? "right"
        : c.alsoFine && same(texts, c.alsoFine)
          ? "split title (ask the user)"
          : "wrong";
    rows.push({ case: c.name, id, texts: sorted(texts), right: c.right, verdict, reading });
    console.log(`${c.name}: ${JSON.stringify(sorted(texts))} -> ${verdict}`);
  }
  writeOut("text-check.json", { prompt: prompt.hash, spentUsd: readSpend().usd, rows });
  console.log(`spent: $${readSpend().usd.toFixed(4)}`);
}

await main();
