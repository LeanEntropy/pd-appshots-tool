/**
 * The App Store text-comparison benchmark (plan-app-store 8, A4; approved by the user, hard cap
 * $1.50). Usage (tsx), with BENCH_ROOT (a scratch folder) and BENCH_OUT set:
 * - copy: a scratch copy of the workspace (every file but the original images, plus the originals
 *   of the benchmark images) and the configs; the real workspace is never written.
 * - run: the tool's own text comparison of App Store images against their Google Play anchors
 *   (another shape: the whole image is sent), and the tool's full analysis of some of the same
 *   images, so the two readings and their costs can be compared. Stops before the cap.
 */
import { cpSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { analyseImages, type CallLog } from "../../src/analysis/call.ts";
import { combinedReading, compareLayer } from "../../src/analysis/layer-diff.ts";
import { renderAnalysisPrompt, renderReportPrompt } from "../../src/analysis/prompts.ts";
import { providerFor } from "../../src/analysis/providers.ts";
import { isUsable, readRecord } from "../../src/analysis/records.ts";
import { modelCopy } from "../../src/analysis/run-chunk.ts";
import { forPlatform } from "../../src/appstore/platform.ts";
import { loadTaxonomy, projectPaths } from "../../src/config/load.ts";
import { openImageDb } from "../../src/store/imagedb.ts";
import { BENCH_ROOT, benchContext, load, need, REPO, writeOut } from "../speed-bench/common.ts";

const CAP_USD = 1.5;
const REAL = join(REPO, "..", "..", "..", "workspace");

/** Rogue Legend's US App Store images and the Play images they reshape (checked by eye). */
const PAIRS: { apple: string; play: string; why: string }[] = [
  { apple: "ea1c93e0", play: "b8248720", why: "ours #2: skill choice, same text" },
  { apple: "200894a1", play: "704abf82", why: "ours #3: board, same text" },
  { apple: "4cb4925a", play: "892bc472", why: "ours #4: pets, same text" },
  { apple: "a25a1832", play: "cd46ee02", why: "ours #5: gear, same text" },
  { apple: "049c8b25", play: "35b5b352", why: "ours #6: boss fight, same text" },
];
/** Also analysed in full, to compare the two readings. */
const FULL = ["ea1c93e0", "049c8b25"];

function copy(): void {
  const keep = [...PAIRS.flatMap((p) => [p.apple, p.play])];
  const orig = join("_library", "images", "orig") + sep;
  cpSync(REAL, join(BENCH_ROOT, "workspace"), {
    recursive: true,
    filter: (src) => {
      const rel = relative(REAL, src);
      if (rel.startsWith(".locks")) return false;
      if (!rel.startsWith(orig)) return true;
      return keep.some((k) => rel.slice(orig.length).startsWith(k));
    },
  });
  for (const d of ["configs", "taxonomies", "prompts"])
    cpSync(join(REPO, d), join(BENCH_ROOT, d), { recursive: true });
  console.log("copied");
}

async function run(): Promise<void> {
  const loaded = forPlatform(load(), "appstore");
  const paths = projectPaths(loaded);
  const db = openImageDb(paths);
  const { taxonomy } = loadTaxonomy(loaded);
  const id = (prefix: string) => {
    const r = db.all().find((x) => x.id.startsWith(prefix));
    if (!r) throw new Error(`image ${prefix} not found`);
    return r.id;
  };
  const ctx = benchContext(loaded, "appstore", CAP_USD, { "full-analysis": 0.3, "layer-diff": 0.15 });
  const calls: CallLog[] = [];
  const onCall = ctx.onCall;
  ctx.onCall = (c) => {
    calls.push(c);
    onCall?.(c);
  };
  const schemas = join(paths.objects, "schemas");
  const images = { inlineImages: loaded.config.options.speed.inlineImages };
  const layer = providerFor(loaded.config.models.layerDiff, schemas, images);
  const prompt = renderReportPrompt(REPO, paths.objects, "layerDiff", taxonomy);
  const out: Record<string, unknown>[] = [];
  for (const p of PAIRS) {
    if (ctx.remainingUsd() < 0.15) break;
    const apple = id(p.apple);
    const anchor = readRecord(paths, id(p.play));
    if (!isUsable(anchor)) throw new Error(`anchor ${p.play} is not analysed`);
    const r = await compareLayer(
      { imageId: apple, appId: anchor.appId, gl: "us", hl: "en", position: 0, label: "United States" },
      anchor,
      { paths, db, provider: layer, prompt, ctx, runId: "appstore-bench" },
    );
    const read = r.diff ? combinedReading(anchor.final, r.diff) : null;
    out.push({
      pair: p,
      status: r.status,
      problems: r.problems,
      anchorTexts: anchor.final.marketingLayer.texts.map((t) => t.text),
      appleTexts: read?.marketingLayer.texts.map((t) => t.text) ?? null,
      sameScreen: r.diff?.sameScreen ?? null,
      diff: r.diff,
    });
    console.log(`text ${p.apple}: ${r.status}`);
  }
  const producer = providerFor(loaded.config.models.fullAnalysis, schemas, images);
  const analyse = renderAnalysisPrompt(REPO, paths.objects, taxonomy, loaded.config.options.speed.leanAnswer);
  const full: Record<string, unknown> = {};
  for (const prefix of FULL) {
    if (ctx.remainingUsd() < 0.3) break;
    const apple = id(prefix);
    const chunk = [{ imageId: apple, image: await modelCopy(paths, db, apple) }];
    const r = await analyseImages("full-analysis", producer, analyse, chunk, ctx, loaded.config.options.speed.leanAnswer);
    const a = r.readings.get(apple);
    full[prefix] = a
      ? { screenType: a.screenshot.screenType, headline: a.headline, texts: a.marketingLayer.texts.map((t) => t.text) }
      : { failed: r.failed.get(apple) ?? "no reading" };
    console.log(`full ${prefix}: ${a ? "ok" : "failed"}`);
  }
  const cost = (step: string) =>
    calls.filter((c) => c.step.startsWith(step)).map((c) => ({ usd: c.costUsd, usage: c.usage }));
  writeOut("result.json", { text: out, full, costs: { text: cost("layer-diff"), full: cost("full-analysis") } });
  console.log(JSON.stringify({ spent: calls.reduce((s, c) => s + (c.costUsd ?? 0), 0) }));
}

need();
if (process.argv[2] === "copy") copy();
else if (process.argv[2] === "run") await run();
else throw new Error("usage: bench.ts copy | run");
