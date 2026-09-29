import { join } from "node:path";
import { endAttempt, SYNTHESIS, startAttempt } from "../analysis/attempts.ts";
import { crashEstimate, ledger, STEP_CEILING_USD } from "../analysis/budget.ts";
import { compareLayers, type LayerItem } from "../analysis/layer-diff-run.ts";
import { snapshotOrder } from "../analysis/orders.ts";
import type { PlanItem } from "../analysis/plan.ts";
import { renderAnalysisPrompt, renderPrompt, renderReportPrompt } from "../analysis/prompts.ts";
import { type Provider, providerFor } from "../analysis/providers.ts";
import { recordWriter, withCurrentMapping } from "../analysis/record-refresh.ts";
import { readRecords } from "../analysis/records.ts";
import type { RunDeps, RunError } from "../analysis/run.ts";
import { analyseChunk, modelCopy } from "../analysis/run-chunk.ts";
import { withOwnCost } from "../analysis/run-context.ts";
import { analyseImages } from "../analysis/run-images.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { openImageDb } from "../store/imagedb.ts";
import { newRunId, readDeck } from "../store/manifest.ts";
import { cachedAi, callContext, paidAi } from "./country-ai.ts";
import { buildCountryVersion } from "./country-version.ts";
import { countryName } from "./names.ts";
import { layerPixelFor } from "./pixel-pairs.ts";
import type { ScopePlan } from "./scope-plan.ts";
import { researchSnapshot } from "./suggest.ts";
import type { ReportDef } from "./types.ts";

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * A One country or Compare countries report's AI batch (plan-reports 2.3), run as a job from its
 * approved plan: 1. the full analyses (new pictures, and main-country anchors added by the plan),
 * 2. the text-layer comparisons (same picture, new text), 3. the text-only steps (words used,
 * country advice and its second opinion, the A/B tests), then 4. the report's new version. Every
 * paid call counts against what is left of the approved limit; Stop and the limit end the image
 * steps and still build a partial version with everything deterministic, saying what is missing.
 */
export async function runReport(
  loaded: LoadedConfig,
  def: ReportDef,
  plan: ScopePlan,
  deps: RunDeps,
  make?: (ref: string) => Provider,
): Promise<{
  runId: string;
  cancelled: boolean;
  aborted: string | null;
  stoppedForBudget: boolean;
  report: string;
  synthesisSkipped: string | null;
}> {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const { taxonomy } = loadTaxonomy(loaded);
  const db = openImageDb(paths);
  const runId = newRunId(def.id);
  const batchId = deps.batchId ?? null;
  const budget = deps.budgetUsd ?? plan.limitUsd;
  let spent = 0;
  const book = ledger(budget, () => spent);
  const speed = config.options.speed;
  const ctx = callContext(loaded, {
    remainingUsd: book.remaining,
    onCost: (u) => {
      spent += u;
    },
  });
  ctx.reserve = book.reserve;
  const full: PlanItem[] = plan.items.filter((i) => i.tier === "full");
  const layers = plan.items.filter((i) => i.tier === "layer-diff" && i.basedOn);
  const total = full.length + layers.length;
  const counter = { done: 0 };
  const errors: RunError[] = [];
  const report = (phase: string, message: string) =>
    deps.onProgress({
      phase,
      done: counter.done,
      total,
      message,
      spentUsd: Math.round(spent * 100) / 100,
    });
  const fail = (message: string, name: string | null, position: number | null) => {
    const e = { message, name, position, at: new Date().toISOString() };
    errors.push(e);
    deps.onError?.(e);
  };
  const shouldStop = deps.shouldStop ?? (() => false);
  // The store order of every deck in the report is saved first (kept if the run stops early).
  for (const d of plan.decks) {
    if (d.state !== "ok") continue;
    const deck = readDeck(paths.decks, { appId: d.appId, gl: d.gl, hl: d.hl });
    if (deck) snapshotOrder(paths, deck, d.name);
  }
  const writeRec = recordWriter(loaded, db);
  const produce = await analyseImages(full, {
    paths,
    runId,
    batchId,
    size: config.estimates.imagesPerCall,
    stopAfterSameErrors: config.run.stopAfterSameErrors,
    estimatePerImage: crashEstimate(
      config.estimates.fullAnalysisUsdPerImage[1],
      "full-analysis",
      speed.parallelCalls,
    ),
    concurrency: speed.parallelCalls,
    minCallUsd: STEP_CEILING_USD["full-analysis"],
    image: (id) => modelCopy(paths, db, id),
    analyse: (chunk, part, label, onCost) =>
      analyseChunk(chunk, part, label, {
        producer: deps.producer,
        reviewer: deps.reviewer,
        adjudicator: deps.adjudicator,
        analysePrompt: renderAnalysisPrompt(loaded.root, paths.objects, taxonomy, speed.leanAnswer),
        adjudicatePrompt: renderPrompt(loaded.root, paths.objects, "adjudicate", taxonomy),
        taxonomy,
        coverage: config.review.enabled ? config.review.expansionCoverage : 0,
        runId,
        ctx: withOwnCost(ctx, onCost),
        lean: speed.leanAnswer,
        phase: report,
      }),
    save: writeRec,
    spent: () => spent,
    budgetLeft: book.remaining,
    shouldStop,
    progress: report,
    fail,
    counter,
    total,
  });
  let cancelled = produce.cancelled;
  let stoppedForBudget = produce.stoppedForBudget;
  let aborted = produce.aborted;
  let different: string[] = [];
  if (!cancelled && !stoppedForBudget && !aborted && layers.length) {
    const provider = make
      ? make(config.models.layerDiff)
      : providerFor(config.models.layerDiff, join(paths.objects, "schemas"), {
          inlineImages: config.options.speed.inlineImages,
        });
    const items: LayerItem[] = layers.map((i) => ({
      imageId: i.imageId,
      anchorId: i.basedOn as string,
      appId: i.appId,
      name: i.name,
      gl: i.gl,
      hl: i.hl,
      label: countryName(i.country),
      position: i.position,
    }));
    const r = await compareLayers(items, {
      paths,
      db,
      provider,
      prompt: renderReportPrompt(loaded.root, paths.objects, "layerDiff", taxonomy),
      ctx,
      runId,
      batchId,
      records: withCurrentMapping(readRecords(paths)),
      estimatePerImage: crashEstimate(
        config.estimates.layerDiffUsdPerImage[1],
        "layer-diff",
        speed.parallelCalls,
      ),
      stopAfterSameErrors: config.run.stopAfterSameErrors,
      concurrency: speed.parallelCalls,
      minCallUsd: STEP_CEILING_USD["layer-diff"],
      shouldStop,
      budgetLeft: book.remaining,
      spent: () => spent,
      progress: report,
      fail,
      counter,
      total,
      pixel: layerPixelFor(loaded, db),
    });
    cancelled = r.cancelled;
    stoppedForBudget = r.stoppedForBudget;
    aborted = r.aborted;
    different = r.differentScreens;
  }
  const stopped = cancelled || stoppedForBudget || !!aborted;
  const why = cancelled
    ? "you pressed Stop"
    : stoppedForBudget
      ? "the spending limit of this batch was reached"
      : (aborted ?? "");
  const notes: string[] = [];
  if (stopped)
    notes.push(
      `Partial version: the run ended early (${why}). Everything finished is kept; press Review and approve on this report to continue with the rest.`,
    );
  if (different.length)
    notes.push(
      `${different.length} ${different.length === 1 ? "image turned" : "images turned"} out to be a different screen under the text: ${different.length === 1 ? "it needs" : "they need"} a full analysis (about ${money(different.length * config.estimates.fullAnalysisUsdPerImage[0])} to ${money(different.length * config.estimates.fullAnalysisUsdPerImage[1])}). Nothing was sent for ${different.length === 1 ? "it" : "them"}: press Review and approve on this report to see and approve ${different.length === 1 ? "it" : "them"}.`,
    );
  if (errors.length && !stopped)
    notes.push(
      `${errors.length} ${errors.length === 1 ? "step" : "steps"} failed (see the run panel); press Review and approve to retry what is missing.`,
    );
  // The text-only steps run only after every image step finished (they read the analyses).
  const before = spent;
  const attempt = stopped
    ? null
    : startAttempt(paths, SYNTHESIS, {
        runId,
        batchId,
        estimateUsd: plan.text.usd[1],
      });
  const ai = stopped ? cachedAi(loaded) : paidAi(loaded, ctx, report, make);
  report("report", "Writing the report…");
  // The limit can also be reached during the written parts: then the version says so too.
  const textLimit = () => !stopped && budget - spent <= 0.01;
  const built = await buildCountryVersion(loaded, def, {
    ai,
    partial: () =>
      [
        ...notes,
        ...(textLimit()
          ? [
              "Partial version: the spending limit of this batch was reached while the written parts were made. Press Review and approve on this report to write the rest.",
            ]
          : []),
      ].join(" ") || null,
    planHash: plan.planHash,
    aiRunId: runId,
    research: () => researchSnapshot(loaded),
  });
  if (attempt) endAttempt(paths, SYNTHESIS, attempt, batchId, "finished", spent - before);
  for (const p of built.problems ?? []) fail(p, null, null);
  if (textLimit()) stoppedForBudget = true;
  const ended = stopped || stoppedForBudget;
  const reason = stopped ? why : "the spending limit of this batch was reached";
  report("done", ended ? `Stopped: ${reason}. Finished work is kept.` : "Finished.");
  return {
    runId,
    cancelled,
    aborted,
    stoppedForBudget,
    report: built.ok ? built.versionId : "",
    synthesisSkipped: ended ? `some written parts were not made: ${reason}` : null,
  };
}
