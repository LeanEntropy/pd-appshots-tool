import { join } from "node:path";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { coreDeck } from "../core/selection.ts";
import { ImageDb } from "../store/imagedb.ts";
import { newRunId } from "../store/manifest.ts";
import { ensureDir, writeJsonOnce } from "../util/fsx.ts";
import type { CallContext, ChunkImage } from "./call.ts";
import { batchDataHash, batchEntries } from "./entries.ts";
import { writeFinalReport } from "./final-report.ts";
import { labeler } from "./labels.ts";
import { enrichOrder, type OrderSnapshot, snapshotOrder } from "./orders.ts";
import { compareOurs, type OursVsPatterns } from "./ours-vs.ts";
import { findPatterns, type Patterns } from "./patterns.ts";
import type { AnalysisPlan, PlanItem } from "./plan.ts";
import { renderPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";
import { recordWriter } from "./record-refresh.ts";
import { type AnalysisRecord, isUsable, readRecord, readRecords } from "./records.ts";
import { analyseChunk, errorKey, modelCopy } from "./run-chunk.ts";
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
}

export interface RunOutcome {
  runId: string;
  records: AnalysisRecord[];
  spentUsd: number;
  stoppedForBudget: boolean;
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
  const db = ImageDb.open(paths.imageDb, paths.imagesOrig, paths.imagesThumb);
  ensureDir(paths.imagesModel);
  const writeRec = recordWriter(loaded, db);
  const runId = newRunId(plan.stage);
  const budget = Math.min(
    config.budget.maxUsdPerIncrement,
    Math.max(plan.estimate.usd[1] * 1.5, 1),
  );
  let spent = 0;
  const ctx: CallContext = {
    objectsDir: paths.objects,
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
  let done = 0;
  const report = (phase: string, message: string) =>
    deps.onProgress({
      phase,
      done,
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

  let stoppedForBudget = false;
  let aborted: string | null = null;
  let streak = { key: "", n: 0 };
  const size = config.estimates.imagesPerCall;
  const byApp = new Map<string, PlanItem[]>();
  for (const it of full) byApp.set(it.appId, [...(byApp.get(it.appId) ?? []), it]);
  outer: for (const [, appItems] of byApp) {
    for (let i = 0; i < appItems.length; i += size) {
      if (spent >= budget) {
        stoppedForBudget = true;
        break outer;
      }
      // Resumable: anything already analysed (by an earlier, interrupted run) is skipped.
      const part = appItems.slice(i, i + size).filter((it) => {
        const skip = isUsable(readRecord(paths, it.imageId));
        if (skip) done++;
        return !skip;
      });
      if (!part.length) continue;
      const first = part[0] as PlanItem;
      const label = `${first.name} #${part.map((p) => p.position).join(", #")}`;
      const range = part.length > 1 ? `${done + 1}–${done + part.length}` : `${done + 1}`;
      report("analysis", `Analysing image ${range} / ${full.length} — ${label}`);
      const chunk: ChunkImage[] = [];
      for (const it of part)
        chunk.push({
          imageId: it.imageId,
          path: await modelCopy(db, paths.imagesModel, it.imageId),
        });
      const recs = await analyseChunk(chunk, part, label, {
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
      });
      for (const raw of recs) {
        // Saved immediately (with its identity block), before the next image.
        records.push(writeRec(raw));
        const rec = records.at(-1) as AnalysisRecord;
        done++;
        const item = part.find((p) => p.imageId === rec.imageId);
        if (isUsable(rec) || rec.status === "disputed") {
          if (rec.status === "disputed")
            fail(
              `disagreement not settled: ${rec.differences.join("; ")}`,
              item?.name ?? null,
              rec.position,
            );
          streak = { key: "", n: 0 };
          continue;
        }
        const msg = rec.problems.join("; ") || `status ${rec.status}`;
        fail(msg, item?.name ?? null, rec.position);
        const key = errorKey(msg);
        streak = key === streak.key ? { key, n: streak.n + 1 } : { key, n: 1 };
        if (streak.n >= config.run.stopAfterSameErrors) {
          aborted = `Stopped: ${streak.n} images in a row failed with the same error: ${msg}`;
          break outer;
        }
      }
      report("analysis", `${label}: saved`);
    }
  }

  const all = readRecords(paths);
  for (const s of snaps) enrichOrder(paths, s, all);
  const entries = batchEntries(plan, all, db, config.ourApp.id);
  let patterns: Patterns | null = null;
  let oursVs: OursVsPatterns | null = null;
  let synthesis: SynthesisResult | null = null;
  let synthesisSkipped: string | null = null;
  if (aborted) synthesisSkipped = "the batch stopped early";
  else if (stoppedForBudget) synthesisSkipped = "the spending limit for this batch was reached";
  else if (entries.missing.length)
    synthesisSkipped = `${entries.missing.length} screenshots have no usable analysis yet (${entries.missing.slice(0, 5).join(", ")}${entries.missing.length > 5 ? ", ..." : ""}). Press Start analysis again to retry them; patterns and recommendations are written once every screenshot is analysed.`;
  else if (!entries.competitors.length)
    synthesisSkipped = "no competitor screenshots in this batch";
  if (!synthesisSkipped) {
    report("patterns", "Finding patterns…");
    patterns = findPatterns(entries.competitors, entries.decks);
    oursVs = compareOurs(entries.ours, patterns, entries.ourDeckLength, labeler(taxonomy));
    if (deps.writer) {
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
          ours: entries.ours,
          competitors: entries.competitors,
          ourDeckLength: entries.ourDeckLength,
        },
        ctx,
        report,
      );
      for (const p of synthesis.problems) fail(p, null, null);
    }
  }
  report("report", "Writing the report…");
  const outcome: RunOutcome = {
    runId,
    records,
    spentUsd: spent,
    stoppedForBudget,
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
    aborted ??
      (stoppedForBudget ? "Stopped: the spending limit for this batch was reached." : "Finished."),
  );
  return outcome;
}
