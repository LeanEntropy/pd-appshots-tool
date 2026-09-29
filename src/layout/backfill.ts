import { join } from "node:path";
import { ledger, STEP_CEILING_USD } from "../analysis/budget.ts";
import type { CallContext } from "../analysis/call.ts";
import { runPool, sleepUnlessStopped } from "../analysis/pool.ts";
import { type Provider, providerFor } from "../analysis/providers.ts";
import { isUsable, readRecords } from "../analysis/records.ts";
import { modelCopy } from "../analysis/run-chunk.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { answerKey } from "../library/layout.ts";
import { workspaceStorage } from "../storage/index.ts";
import { acquireAll, LOCKS } from "../storage/leases.ts";
import { openImageDb } from "../store/imagedb.ts";
import { stableHash } from "../util/hash.ts";
import { LAYOUT_STEP } from "./call.ts";
import { addLayout } from "./capture.ts";
import { layoutStatus } from "./store.ts";
import { LAYOUT_USD_PER_IMAGE } from "./vocab.ts";

export interface BackfillItem {
  imageId: string;
  game: string;
  ours: boolean;
  where: string[];
}

export interface BackfillScope {
  items: BackfillItem[];
  ours: number;
  competitors: number;
  usd: [number, number];
  /** The spending limit: the run stops there. */
  limitUsd: number;
  /** Fingerprint of exactly this list: the approval refers to it. */
  scopeHash: string;
}

/**
 * Earlier images without a current layout that reports need first (user decision D3): ours in
 * every country, and competitors' store positions 1 to 3. Free to compute; nothing is called.
 */
export function backfillScope(loaded: LoadedConfig): BackfillScope {
  const paths = projectPaths(loaded);
  const ours = loaded.config.ourApp.id;
  const items: BackfillItem[] = [];
  for (const r of readRecords(paths).values()) {
    if (!isUsable(r)) continue;
    const st = layoutStatus(paths, r).status;
    if (st === "current" || st === "stale") continue;
    const apps = r.identity?.appearances ?? [
      { appId: r.appId, gl: r.gl, hl: r.hl, position: r.position, game: r.appId },
    ];
    const isOurs = r.appId === ours || apps.some((a) => a.appId === ours);
    if (!isOurs && !apps.some((a) => a.position <= 3)) continue;
    items.push({
      imageId: r.imageId,
      game: r.identity?.game ?? r.appId,
      ours: isOurs,
      where: apps.map((a) => `${a.gl.toUpperCase()}-${a.hl} #${a.position}`),
    });
  }
  items.sort((a, b) => Number(b.ours) - Number(a.ours) || a.game.localeCompare(b.game));
  const n = items.length;
  const usd = LAYOUT_USD_PER_IMAGE.map((u) => Math.round(n * u * 100) / 100) as [number, number];
  // It stops at the top of the range, and never below one call's reserved ceiling.
  const limitUsd = n ? Math.max(usd[1], STEP_CEILING_USD[LAYOUT_STEP] ?? 0.25) : 0;
  return {
    items,
    ours: items.filter((i) => i.ours).length,
    competitors: items.filter((i) => !i.ours).length,
    usd,
    limitUsd,
    scopeHash: stableHash({ items, usd, limitUsd }),
  };
}

export interface BackfillProgress {
  state: "running" | "finished" | "stopped" | "failed";
  done: number;
  total: number;
  saved: number;
  missing: number;
  spentUsd: number;
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

/**
 * Adds the layouts of the approved list only (the fingerprint the user saw must still match),
 * 3 at a time, under a spending limit of the list's top estimate, with the AI lock held like any
 * AI job. Each layout is saved the moment it is done; a rerun skips those already saved.
 */
export function startBackfill(
  loaded: LoadedConfig,
  scopeHash: string,
  make: (ref: string) => Provider = (ref) =>
    providerFor(ref, join(projectPaths(loaded).objects, "schemas"), {
      inlineImages: loaded.config.options.speed.inlineImages,
    }),
): { ok: true; done: Promise<BackfillProgress> } | { ok: false; status: number; problem: string } {
  const scope = backfillScope(loaded);
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
    poolRetries: true,
  };
  const job = {
    stop: false,
    progress: {
      state: "running",
      done: 0,
      total: scope.items.length,
      saved: 0,
      missing: 0,
      spentUsd: 0,
      message: "Starting…",
    } as BackfillProgress,
  };
  running.set(loaded.config.project, job);
  const p = job.progress;
  const done = runPool(scope.items, {
    concurrency: Math.max(1, loaded.config.options.speed.parallelCalls),
    gate: () => !job.stop && book.remaining() >= ceiling,
    shouldStop: () => job.stop,
    sleep: sleepUnlessStopped,
    slowDown: () => {},
    run: async (it) => {
      const r = records.get(it.imageId);
      const before = spent;
      const out = r
        ? await addLayout(
            { paths, db, provider, ctx, root: loaded.root },
            r,
            { imageId: it.imageId, image: await modelCopy(paths, db, it.imageId) },
            "backfill",
          )
        : { outcome: "skipped", problems: [] };
      p.done++;
      if (out.outcome === "saved" || out.outcome === "had") p.saved++;
      else p.missing++;
      p.spentUsd = Math.round(spent * 100) / 100;
      p.message = `Adding layout to image ${p.done} / ${p.total} (${it.game})`;
      return { ok: true, paid: spent > before };
    },
  })
    .then(() => {
      p.state = job.stop ? "stopped" : p.done < p.total ? "stopped" : "finished";
      p.message =
        p.state === "finished"
          ? `Finished: ${p.saved} layouts added${p.missing ? `, ${p.missing} missing (you can try them again)` : ""}; $${p.spentUsd.toFixed(2)} spent.`
          : `Stopped after ${p.done} of ${p.total}: everything finished is kept; $${p.spentUsd.toFixed(2)} spent.`;
      return p;
    })
    .catch((e: unknown) => {
      p.state = "failed";
      p.message = `The layout step failed: ${e instanceof Error ? e.message : String(e)}`;
      return p;
    })
    .finally(() => held.release());
  return { ok: true, done };
}
