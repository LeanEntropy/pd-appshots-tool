import { join } from "node:path";
import { ledger, STEP_CEILING_USD } from "../analysis/budget.ts";
import type { CallContext, CallLog } from "../analysis/call.ts";
import { runPool, sleepUnlessStopped } from "../analysis/pool.ts";
import { type Provider, providerFor } from "../analysis/providers.ts";
import { readRecords } from "../analysis/records.ts";
import { modelCopy } from "../analysis/run-chunk.ts";
import { withOwnCost } from "../analysis/run-context.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { answerKey } from "../library/layout.ts";
import { workspaceStorage } from "../storage/index.ts";
import { acquireAll, LOCKS } from "../storage/leases.ts";
import { openImageDb } from "../store/imagedb.ts";
import { newRunId } from "../store/manifest.ts";
import { backfillScope } from "./backfill-scope.ts";
import { LAYOUT_STEP } from "./call.ts";
import { addLayout } from "./capture.ts";
import { explainFailure, type LayoutFailure } from "./failure.ts";
import { type LayoutRunImage, type LayoutRunLog, writeLayoutRunLog } from "./run-log.ts";

export { type BackfillItem, type BackfillScope, backfillScope } from "./backfill-scope.ts";

export interface BackfillProgress {
  state: "running" | "finished" | "stopped" | "failed";
  runId: string;
  done: number;
  total: number;
  saved: number;
  missing: number;
  /** Saved layouts that needed a second (or third) attempt. */
  retried: number;
  spentUsd: number;
  /** Of which spent on images that failed (their attempts are paid too). */
  failedUsd: number;
  /** Each image that failed, with why in plain words. */
  failed: LayoutFailure[];
  message: string;
}

const running = new Map<string, { progress: BackfillProgress; stop: boolean }>();

export function backfillStatus(loaded: LoadedConfig): BackfillProgress | null {
  return running.get(loaded.config.project)?.progress ?? null;
}

/** Stop after the images in progress; every layout finished is kept. */
export function stopBackfill(loaded: LoadedConfig): boolean {
  const r = running.get(loaded.config.project);
  if (r?.progress.state !== "running") return false;
  r.stop = true;
  return true;
}

const cents = (n: number) => Math.round(n * 100) / 100;

function endMessage(p: BackfillProgress, pressedStop: boolean): string {
  const failed = p.failed.length
    ? `, ${p.failed.length} failed ($${p.failedUsd.toFixed(2)} of it spent on them)`
    : "";
  const spent = `$${p.spentUsd.toFixed(2)} spent`;
  if (p.state === "finished") return `Finished: ${p.saved} layouts added${failed}; ${spent}.`;
  const why = pressedStop ? "you pressed Stop" : "the spending limit was reached";
  return `Stopped (${why}) after ${p.done} of ${p.total}: ${p.saved} added${failed}, ${p.total - p.done} not started; ${spent}. Everything finished is kept.`;
}

/**
 * Adds the layouts of the approved list only (the fingerprint the user saw must still match),
 * 3 at a time, under a spending limit of the list's top estimate, with the AI lock held like any
 * AI job. Each layout is saved the moment it is done; a rerun skips those already saved. Every
 * call, each image's cost and each failure's reason go to the run's log (runs/<id>/layout.json).
 * `retryFailed` is the separate approval for images that failed before; nothing else retries them.
 */
export function startBackfill(
  loaded: LoadedConfig,
  scopeHash: string,
  make: (ref: string) => Provider = (ref) =>
    providerFor(ref, join(projectPaths(loaded).objects, "schemas"), {
      inlineImages: loaded.config.options.speed.inlineImages,
    }),
  retryFailed = false,
): { ok: true; done: Promise<BackfillProgress> } | { ok: false; status: number; problem: string } {
  const scope = backfillScope(loaded, { retryFailed });
  if (scope.scopeHash !== scopeHash)
    return {
      ok: false,
      status: 409,
      problem: "The list changed since it was shown. Review it again.",
    };
  if (!scope.items.length)
    return { ok: false, status: 409, problem: "Every image has its layout." };
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  // Everything that can fail is set up before the AI lock is taken (it is released only at the end).
  const { taxonomy, hash } = loadTaxonomy(loaded);
  const db = openImageDb(paths);
  const provider = make(loaded.config.models.fullAnalysis);
  const records = readRecords(paths);
  const held = acquireAll(storage, [LOCKS.ai], {
    projectId: paths.projectId,
    kind: "layout-backfill",
  });
  if ("heldBy" in held)
    return {
      ok: false,
      status: 409,
      problem: "Another job is using the AI now. Start this when it finishes.",
    };
  let spent = 0;
  const book = ledger(scope.limitUsd, () => spent);
  const ceiling = STEP_CEILING_USD[LAYOUT_STEP] ?? 0.25;
  const calls: CallLog[] = [];
  const ctx: CallContext = {
    storage,
    answerKey: (step, key) => answerKey(paths, step, key),
    taxonomy,
    taxonomyHash: hash,
    maxBudgetUsd: 0.45,
    remainingUsd: book.remaining,
    timeoutMs: 600_000,
    onCost: (u) => {
      spent += u;
    },
    reserve: book.reserve,
    onCall: (c) => {
      calls.push(c);
    },
    poolRetries: true,
  };
  const runId = newRunId("layout-backfill");
  const job = {
    stop: false,
    progress: {
      state: "running",
      runId,
      done: 0,
      total: scope.items.length,
      saved: 0,
      missing: 0,
      retried: 0,
      spentUsd: 0,
      failedUsd: 0,
      failed: [],
      message: "Starting…",
    } as BackfillProgress,
  };
  running.set(loaded.config.project, job);
  const p = job.progress;
  const images: LayoutRunImage[] = [];
  const startedAt = new Date().toISOString();
  const save = (endedAt: string | null) => {
    const log: LayoutRunLog = {
      runId,
      kind: "layout-backfill",
      startedAt,
      endedAt,
      state: p.state,
      retryFailed,
      total: p.total,
      estimateUsd: scope.usd,
      limitUsd: scope.limitUsd,
      spentUsd: cents(spent),
      failedUsd: p.failedUsd,
      images,
      failed: p.failed,
      calls,
    };
    writeLayoutRunLog(paths, log);
  };
  const done = runPool(scope.items, {
    concurrency: Math.max(1, loaded.config.options.speed.parallelCalls),
    gate: () => !job.stop && book.remaining() >= ceiling,
    shouldStop: () => job.stop,
    sleep: sleepUnlessStopped,
    slowDown: () => {},
    run: async (it) => {
      const r = records.get(it.imageId);
      let usd = 0;
      const own = withOwnCost(ctx, (u) => {
        usd += u;
      });
      const out = r
        ? await addLayout(
            { paths, db, provider, ctx: own, root: loaded.root },
            r,
            { imageId: it.imageId, image: await modelCopy(paths, db, it.imageId) },
            "backfill",
          )
        : { outcome: "skipped" as const, problems: ["the image's analysis is missing"] };
      const n = calls.filter((c) => c.imageIds[0] === it.imageId).length;
      const why = explainFailure(out.problems, provider.model);
      // Refused by the spending limit before any call: not started, and not a failure.
      const notStarted = out.outcome === "failed" && why.kind === "budget" && n === 0;
      images.push({ imageId: it.imageId, game: it.game, outcome: out.outcome, calls: n, usd });
      if (!notStarted) p.done++;
      if (out.outcome === "saved" || out.outcome === "had") {
        p.saved++;
        if (n > 1) p.retried++;
      } else if (!notStarted) {
        p.missing++;
        p.failedUsd = cents(p.failedUsd + usd);
        p.failed.push({
          imageId: it.imageId,
          game: it.game,
          where: it.where,
          ...why,
          problems: out.problems.slice(0, 10),
          usd: cents(usd),
          calls: n,
          at: new Date().toISOString(),
        });
      }
      p.spentUsd = cents(spent);
      p.message = `Adding layout to image ${p.done} / ${p.total} (${it.game})`;
      save(null);
      return { ok: true, paid: usd > 0 };
    },
  })
    .then(() => {
      p.state = !job.stop && p.done >= p.total ? "finished" : "stopped";
      p.spentUsd = cents(spent);
      p.message = endMessage(p, job.stop);
      return p;
    })
    .catch((e: unknown) => {
      p.state = "failed";
      p.spentUsd = cents(spent);
      p.message = `The layout step failed: ${e instanceof Error ? e.message : String(e)}; $${p.spentUsd.toFixed(2)} spent.`;
      return p;
    })
    .finally(() => {
      save(new Date().toISOString());
      held.release();
    });
  return { ok: true, done };
}
