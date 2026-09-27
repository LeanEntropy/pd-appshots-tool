import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { ImageDb } from "../store/imagedb.ts";
import { newRunId } from "../store/manifest.ts";
import { ensureDir, writeJsonOnce } from "../util/fsx.ts";
import { sha256 } from "../util/hash.ts";
import { analyseImages, type CallContext, type ChunkImage, type ChunkResult } from "./call.ts";
import { compareReadings } from "./compare.ts";
import type { AnalysisPlan, PlanItem } from "./plan.ts";
import { renderPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";
import { type AnalysisRecord, writeRecord } from "./records.ts";
import { buildRecord, type Decision, settle } from "./settle.ts";

export interface Progress {
  phase: string;
  done: number;
  total: number;
  message: string;
  spentUsd: number;
}

export interface RunDeps {
  producer: Provider;
  reviewer: Provider | null;
  adjudicator: Provider;
  onProgress: (p: Progress) => void;
}

export interface RunOutcome {
  runId: string;
  records: AnalysisRecord[];
  spentUsd: number;
  stoppedForBudget: boolean;
}

const MODEL_LONG_EDGE = 1568;

async function modelCopy(db: ImageDb, dir: string, imageId: string): Promise<string> {
  const out = join(dir, `${imageId}.jpg`);
  if (!existsSync(out)) {
    const rec = db.get(imageId);
    if (!rec) throw new Error(`Image ${imageId} is not in the project image database.`);
    await sharp(db.abs(rec.file))
      .resize({
        width: MODEL_LONG_EDGE,
        height: MODEL_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toFile(out);
  }
  return out;
}

/** Deterministic review sample: all when coverage is 1, else the lowest-hash share per deck. */
export function reviewSample(ids: readonly string[], coverage: number): Set<string> {
  if (coverage >= 1) return new Set(ids);
  const n = Math.ceil(ids.length * coverage);
  return new Set([...ids].sort((a, b) => (sha256(a) < sha256(b) ? -1 : 1)).slice(0, n));
}

/** Runs an approved plan: full analysis, blind cross-check, settling disagreements. */
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
  const runId = newRunId(plan.stage);
  const budget = Math.min(
    config.budget.maxUsdPerIncrement,
    Math.max(plan.estimate.usd[1] * 1.5, 1),
  );
  let spent = 0;
  let stoppedForBudget = false;
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
  const byApp = new Map<string, PlanItem[]>();
  for (const it of full) byApp.set(it.appId, [...(byApp.get(it.appId) ?? []), it]);
  const records: AnalysisRecord[] = [];
  let done = 0;
  const report = (phase: string, message: string) =>
    deps.onProgress({
      phase,
      done,
      total: full.length,
      message,
      spentUsd: Math.round(spent * 100) / 100,
    });

  for (const [, items] of byApp) {
    if (spent >= budget) {
      stoppedForBudget = true;
      break;
    }
    const name = items[0]?.name ?? "";
    const chunks: ChunkImage[][] = [];
    for (let i = 0; i < items.length; i += config.estimates.imagesPerCall) {
      const part = items.slice(i, i + config.estimates.imagesPerCall);
      chunks.push(
        await Promise.all(
          part.map(async (it) => ({
            imageId: it.imageId,
            path: await modelCopy(db, paths.imagesModel, it.imageId),
          })),
        ),
      );
    }
    for (const chunk of chunks) {
      report("analysis", `Analysing ${name} (${chunk.length} screenshots)`);
      const produced = await analyseImages(
        "full-analysis",
        deps.producer,
        analysePrompt,
        chunk,
        ctx,
      );
      const sample = reviewSample(
        chunk.map((c) => c.imageId),
        config.review.enabled ? config.review.coreCoverage : 0,
      );
      const toReview = chunk.filter(
        (c) => sample.has(c.imageId) && produced.readings.has(c.imageId),
      );
      let reviewed: ChunkResult = { readings: new Map(), failed: new Map(), objects: new Map() };
      if (deps.reviewer && toReview.length) {
        report("review", `Second opinion on ${name}`);
        reviewed = await analyseImages("review", deps.reviewer, analysePrompt, toReview, ctx);
      }
      const disputes = new Map<string, string[]>();
      const notes = new Map<string, string[]>();
      for (const c of chunk) {
        const a = produced.readings.get(c.imageId);
        const b = reviewed.readings.get(c.imageId);
        if (a && b) {
          const cmp = compareReadings(a, b);
          if (cmp.disputes.length) disputes.set(c.imageId, cmp.disputes);
          notes.set(c.imageId, [...cmp.disputes, ...cmp.notes]);
        }
      }
      const disputed = chunk.filter((c) => disputes.has(c.imageId));
      let settled = { decisions: new Map<string, Decision>(), key: "" };
      if (disputed.length) {
        report("settle", `Settling ${disputed.length} disagreements for ${name}`);
        settled = await settle(
          deps.adjudicator,
          adjudicatePrompt,
          taxonomy,
          disputed,
          produced,
          reviewed,
          disputes,
          ctx,
        );
      }
      for (const c of chunk) {
        const rec = buildRecord({
          item: items.find((x) => x.imageId === c.imageId) as PlanItem,
          produced,
          reviewed,
          reviewRequired: !!deps.reviewer && sample.has(c.imageId),
          disputes,
          notes,
          decision: settled.decisions.get(c.imageId),
          adjudicationKey: settled.key,
          models: {
            producer: deps.producer.model,
            reviewer: deps.reviewer?.model ?? null,
            adjudicator: deps.adjudicator.model,
          },
          runId,
        });
        writeRecord(paths, rec);
        records.push(rec);
        done++;
      }
      report("analysis", `${name}: ${chunk.length} screenshots done`);
      if (spent >= budget) {
        stoppedForBudget = true;
        break;
      }
    }
  }
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
    stoppedForBudget ? "Stopped: the spending limit for this batch was reached." : "Finished.",
  );
  return { runId, records, spentUsd: spent, stoppedForBudget };
}
