import { join } from "node:path";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { coreDeck } from "../core/selection.ts";
import { answerKey } from "../library/layout.ts";
import { workspaceStorage } from "../storage/index.ts";
import { openImageDb } from "../store/imagedb.ts";
import { newRunId } from "../store/manifest.ts";
import { writeJsonOnce } from "../util/fsx.ts";
import { endAttempt, SYNTHESIS, startAttempt } from "./attempts.ts";
import type { CallContext } from "./call.ts";
import { batchDataHash, batchEntries } from "./entries.ts";
import { writeFinalReport } from "./final-report.ts";
import { labeler } from "./labels.ts";
import { enrichOrder, type OrderSnapshot, snapshotOrder } from "./orders.ts";
import { compareOurs, type OursVsPatterns } from "./ours-vs.ts";
import { patternFit } from "./pattern-fit.ts";
import { findPatterns, type Patterns } from "./patterns.ts";
import type { AnalysisPlan } from "./plan.ts";
import { renderPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";
import { recordWriter } from "./record-refresh.ts";
import { type AnalysisRecord, readRecords } from "./records.ts";
import { analyseChunk, modelCopy } from "./run-chunk.ts";
import { analyseImages } from "./run-images.ts";
import { type SynthesisResult, synthesise } from "./synthesis.ts";

export { errorKey, reviewSample } from "./run-chunk.ts";

export interface Progress {
  phase: string;
  done: number;
  total: number;
  message: string;
  spentUsd: number;
}

export interface RunError {
  message: string;
  name: string | null;
  position: number | null;
  at: string;
}

export interface RunDeps {
  producer: Provider;
  reviewer: Provider | null;
  adjudicator: Provider;
  /** Pattern summary and recommendations (Opus); none = synthesis skipped. */
  writer?: Provider | null;
  /** Cross-family review of the recommendations. */
  recommendationReviewer?: Provider | null;
  onProgress: (p: Progress) => void;
  onError?: (e: RunError) => void;
  /** Dollars this run may spend (the batch limit minus what the batch spent already). */
  budgetUsd?: number;
  /** The approved batch this run belongs to (its spend ledger across stops and continues). */
  batchId?: string | null;
  /** Checked before each image: true after the user pressed Stop. */
  shouldStop?: () => boolean;
}

export interface RunOutcome {
  runId: string;
  records: AnalysisRecord[];
  spentUsd: number;
  stoppedForBudget: boolean;
  /** The user pressed Stop: the run ended after the current image. */
  cancelled: boolean;
  /** Why the batch stopped early (repeated identical errors), or null. */
  aborted: string | null;
  errors: RunError[];
  patterns: Patterns | null;
  oursVs: OursVsPatterns | null;
  synthesis: SynthesisResult | null;
  /** Why patterns and recommendations were not written, or null. */
  synthesisSkipped: string | null;
  report: string;
}

/**
 * Runs an approved plan. Each image is produced, cross-checked, settled and saved before the
 * next starts; images that already have a usable analysis are skipped. The batch stops after
 * the same error repeats; patterns and recommendations run only when every screenshot is done.
 */
export async function runAnalysis(
  loaded: LoadedConfig,
  plan: AnalysisPlan,
  deps: RunDeps,
): Promise<RunOutcome> {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const { taxonomy, hash: taxonomyHash } = loadTaxonomy(loaded);
  const db = openImageDb(paths);
  const writeRec = recordWriter(loaded, db);
  const runId = newRunId(plan.stage);
  const budget = deps.budgetUsd ?? batchLimit(loaded, plan);
  const batchId = deps.batchId ?? null;
  let spent = 0;
  const ctx: CallContext = {
    storage: workspaceStorage(paths.workspace),
    answerKey: (step, key) => answerKey(paths, step, key),
    taxonomy,
    taxonomyHash,
    maxBudgetUsd: 3,
    remainingUsd: () => budget - spent,
    timeoutMs: 900_000,
    onCost: (u) => {
      spent += u;
    },
  };
  const analysePrompt = renderPrompt(loaded.root, paths.objects, "fullAnalysis", taxonomy);
  const adjudicatePrompt = renderPrompt(loaded.root, paths.objects, "adjudicate", taxonomy);
  const full = plan.items.filter((i) => i.tier === "full");
  const records: AnalysisRecord[] = [];
  const errors: RunError[] = [];
  const counter = { done: 0 };
  const report = (phase: string, message: string) =>
    deps.onProgress({
      phase,
      done: counter.done,
      total: full.length,
      message,
      spentUsd: Math.round(spent * 100) / 100,
    });
  const fail = (message: string, name: string | null, position: number | null) => {
    const e = { message, name, position, at: new Date().toISOString() };
    errors.push(e);
    deps.onError?.(e);
  };

  // The store order is saved first, so it is kept even if the run stops early.
  const snaps: OrderSnapshot[] = [];
  for (const g of plan.games) {
    const deck = coreDeck(loaded, g.appId);
    if (deck) snaps.push(snapshotOrder(paths, deck, g.name));
  }

  const loop = await analyseImages(full, {
    paths,
    runId,
    batchId,
    size: config.estimates.imagesPerCall,
    stopAfterSameErrors: config.run.stopAfterSameErrors,
    estimatePerImage: full.length ? plan.estimate.usd[1] / full.length : 0,
    image: (id) => modelCopy(paths, db, id),
    analyse: (chunk, part, label) =>
      analyseChunk(chunk, part, label, {
        producer: deps.producer,
        reviewer: deps.reviewer,
        adjudicator: deps.adjudicator,
        analysePrompt,
        adjudicatePrompt,
        taxonomy,
        coverage: config.review.enabled ? config.review.coreCoverage : 0,
        runId,
        ctx,
        phase: report,
      }),
    save: writeRec,
    spent: () => spent,
    budgetLeft: () => budget - spent,
    shouldStop: deps.shouldStop ?? (() => false),
    progress: report,
    fail,
    counter,
    total: full.length,
  });
  records.push(...loop.records);
  const { stoppedForBudget, cancelled, aborted } = loop;
  for (const h of loop.heldElsewhere) fail(`${h}; it will be reused, not paid`, null, null);

  const all = readRecords(paths);
  for (const s of snaps) enrichOrder(paths, s, all);
  const entries = batchEntries(plan, all, db, config.ourApp.id);
  let patterns: Patterns | null = null;
  let oursVs: OursVsPatterns | null = null;
  let synthesis: SynthesisResult | null = null;
  let synthesisSkipped: string | null = null;
  if (cancelled) synthesisSkipped = "you stopped the batch";
  else if (aborted) synthesisSkipped = "the batch stopped early";
  else if (stoppedForBudget) synthesisSkipped = "the spending limit for this batch was reached";
  else if (entries.missing.length)
    synthesisSkipped = `${entries.missing.length} screenshots have no usable analysis yet (${entries.missing.slice(0, 5).join(", ")}${entries.missing.length > 5 ? ", ..." : ""}). Press Start analysis again to retry them; patterns and recommendations are written once every screenshot is analysed.`;
  else if (!entries.competitors.length)
    synthesisSkipped = "no competitor screenshots in this batch";
  if (!synthesisSkipped) {
    report("patterns", "Finding patternsâ€¦");
    patterns = findPatterns(entries.competitors, entries.decks);
    oursVs = compareOurs(entries.ours, patterns, entries.ourDeckLength, labeler(taxonomy));
    if (deps.writer) {
      const before = spent;
      const attempt = startAttempt(paths, SYNTHESIS, {
        runId,
        batchId,
        estimateUsd: config.estimates.synthesisUsd[1],
      });
      synthesis = await synthesise(
        {
          writer: deps.writer,
          reviewer: deps.recommendationReviewer ?? null,
          prompts: {
            patterns: renderPrompt(loaded.root, paths.objects, "patterns", taxonomy),
            recommend: renderPrompt(loaded.root, paths.objects, "recommend", taxonomy),
            review: renderPrompt(loaded.root, paths.objects, "recommendReview", taxonomy),
          },
        },
        taxonomy,
        {
          patterns,
          oursVs,
          fit: patternFit(
            entries.competitors,
            entries.ours,
            patterns,
            entries.ourDeckLength,
            labeler(taxonomy),
          ),
          ours: entries.ours,
          competitors: entries.competitors,
          ourDeckLength: entries.ourDeckLength,
        },
        ctx,
        report,
      );
      endAttempt(paths, SYNTHESIS, attempt, batchId, "finished", spent - before);
      for (const p of synthesis.problems) fail(p, null, null);
    }
  }
  report("report", "Writing the reportâ€¦");
  const outcome: RunOutcome = {
    runId,
    records,
    spentUsd: spent,
    stoppedForBudget,
    cancelled,
    aborted,
    errors,
    patterns,
    oursVs,
    synthesis,
    synthesisSkipped,
    report: "",
  };
  outcome.report = writeFinalReport(
    loaded,
    plan,
    outcome,
    db,
    synthesis?.recommendations ? batchDataHash(plan, all) : null,
  );
  writeJsonOnce(join(paths.runs, runId, "manifest.json"), {
    runId,
    kind: `analysis-${plan.stage}`,
    createdAt: new Date().toISOString(),
    planHash: plan.planHash,
    configHash: loaded.hash,
    versions: plan.versions,
    models: plan.models,
    spentUsd: spent,
    stoppedForBudget,
    aborted,
    errors,
    report: outcome.report,
    records: records.map((r) => ({
      imageId: r.imageId,
      status: r.status,
      producer: r.producer?.object ?? null,
      reviewer: r.reviewer?.object ?? null,
      adjudication: r.adjudication?.object ?? null,
    })),
  });
  report(
    "done",
    cancelled
      ? "Stopped: you pressed Stop. Finished images are kept."
      : (aborted ??
          (stoppedForBudget
            ? "Stopped: the spending limit for this batch was reached."
            : "Finished.")),
  );
  return outcome;
}

/** Spending limit of a new batch: 1.5 times its top estimate (at least $1), within the cap. */
export function batchLimit(loaded: LoadedConfig, plan: AnalysisPlan): number {
  return Math.min(loaded.config.budget.maxUsdPerIncrement, Math.max(plan.estimate.usd[1] * 1.5, 1));
}
