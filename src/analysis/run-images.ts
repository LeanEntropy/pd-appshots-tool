import type { ProjectPaths } from "../config/load.ts";
import { HEARTBEAT_MS, type Lease } from "../storage/leases.ts";
import { endAttempt, lockRecord, startAttempt } from "./attempts.ts";
import type { ChunkImage } from "./call.ts";
import type { PlanItem } from "./plan.ts";
import { rateLimitWait, runPool, sleepUnlessStopped } from "./pool.ts";
import { type AnalysisRecord, isUsable, readRecord } from "./records.ts";
import { errorKey } from "./run-chunk.ts";

export interface ImageLoopDeps {
  paths: ProjectPaths;
  runId: string;
  batchId: string | null;
  /** Images sent per model call. */
  size: number;
  stopAfterSameErrors: number;
  /** Estimated cost of one image, logged with its attempt (used if the run is interrupted). */
  estimatePerImage: number;
  image: (imageId: string) => Promise<ChunkImage["image"]>;
  /** `onCost` receives the cost of this chunk's own calls. */
  analyse: (
    chunk: ChunkImage[],
    part: PlanItem[],
    label: string,
    onCost?: (usd: number) => void,
  ) => Promise<AnalysisRecord[]>;
  save: (r: AnalysisRecord) => Promise<AnalysisRecord>;
  spent: () => number;
  budgetLeft: () => number;
  /** True when the user pressed Stop: the loop ends after the current image. */
  shouldStop: () => boolean;
  progress: (phase: string, message: string) => void;
  fail: (message: string, name: string | null, position: number | null) => void;
  counter: { done: number };
  total: number;
  /** Model calls at the same time (Settings); 1 = one after another. */
  concurrency?: number;
  /** Waiting after a rate limit (tests pass a fake). */
  sleep?: (ms: number, shouldStop: () => boolean) => Promise<void>;
}

export interface ImageLoopResult {
  records: AnalysisRecord[];
  stoppedForBudget: boolean;
  cancelled: boolean;
  aborted: string | null;
  /** Images another project finished while this batch ran: reused, nothing paid. */
  reusedMeanwhile: number;
  /** Images another job was still analysing at the end: they will be reused, not paid. */
  heldElsewhere: string[];
}

/**
 * Analyses the batch's full-analysis images, one call at a time. Before each paid call it takes
 * the image's record lock and checks the record again: an image finished meanwhile (by another
 * project or an earlier run) is skipped as already analysed, free; an image locked by another
 * live job is tried again at the end of the batch and, if still locked, left to that job.
 * Each paid call is logged as an attempt before it starts. Stop ends the loop after the
 * current image; everything finished is kept.
 */
export async function analyseImages(
  full: readonly PlanItem[],
  d: ImageLoopDeps,
): Promise<ImageLoopResult> {
  const out: ImageLoopResult = {
    records: [],
    stoppedForBudget: false,
    cancelled: false,
    aborted: null,
    reusedMeanwhile: 0,
    heldElsewhere: [],
  };
  const deferred: PlanItem[] = [];
  let streak = { key: "", n: 0 };
  let rateWait: number | null = null;
  const lastRateLimit = {
    take: () => {
      const w = rateWait;
      rateWait = null;
      return w;
    },
  };
  const many = (d.concurrency ?? 1) > 1 ? ` (${d.concurrency} at a time)` : "";
  const usable = (id: string) => isUsable(readRecord(d.paths, id));

  const gate = (): boolean => {
    if (d.shouldStop()) out.cancelled = true;
    else if (d.budgetLeft() <= 0) out.stoppedForBudget = true;
    return !out.cancelled && !out.stoppedForBudget;
  };

  /** false when the batch must stop (repeated identical errors). */
  async function run(items: PlanItem[], last: boolean): Promise<boolean> {
    const leases: Lease[] = [];
    const part: PlanItem[] = [];
    for (const it of items) {
      if (usable(it.imageId)) {
        d.counter.done++;
        continue;
      }
      const lock = lockRecord(d.paths, it.imageId, "analysis");
      if ("heldBy" in lock) {
        if (!last) deferred.push(it);
        else {
          d.counter.done++;
          const who = lock.heldBy?.projectId ?? "another job";
          out.heldElsewhere.push(`${it.name} #${it.position} (being analysed by ${who})`);
        }
        continue;
      }
      if (usable(it.imageId)) {
        lock.release();
        d.counter.done++;
        out.reusedMeanwhile++;
        continue;
      }
      leases.push(lock);
      part.push(it);
    }
    if (!part.length) return true;
    const beat = setInterval(() => {
      for (const l of leases) l.heartbeat();
    }, HEARTBEAT_MS);
    beat.unref();
    try {
      const first = part[0] as PlanItem;
      const label = `${first.name} #${part.map((p) => p.position).join(", #")}`;
      const done = d.counter.done;
      const range = part.length > 1 ? `${done + 1}–${done + part.length}` : `${done + 1}`;
      d.progress("analysis", `Analysing image ${range} / ${d.total}${many} — ${label}`);
      const before = d.spent();
      const attempt = new Map(
        part.map((it) => [
          it.imageId,
          startAttempt(d.paths, it.imageId, {
            runId: d.runId,
            batchId: d.batchId,
            estimateUsd: d.estimatePerImage,
          }),
        ]),
      );
      let recs: AnalysisRecord[] = [];
      let share: number | null = null;
      // This chunk's own calls (other chunks may be running at the same time).
      let own: number | null = null;
      const closed = new Set<string>();
      // Closed only after the record is saved: a crash in between leaves the attempt "started",
      // counted at its estimate, never a paid attempt without its result on disk.
      const close = (id: string, ok: boolean) => {
        const a = attempt.get(id);
        if (!a || closed.has(id)) return;
        closed.add(id);
        endAttempt(d.paths, id, a, d.batchId, ok ? "finished" : "failed", share ?? 0);
      };
      try {
        const chunk: ChunkImage[] = [];
        for (const it of part)
          chunk.push({ imageId: it.imageId, image: await d.image(it.imageId) });
        recs = await d.analyse(chunk, part, label, (u) => {
          own = (own ?? 0) + u;
        });
        share = (own ?? d.spent() - before) / part.length;
        // Still ours? After a long pause (sleep) another job may have taken an image over: then
        // nothing more is written, so its work is never overwritten.
        if (leases.some((l) => !l.heartbeat())) {
          out.aborted =
            "Stopped: the computer paused during an analysis and another job took over the image. Nothing more was written.";
          return false;
        }
        for (const raw of recs) {
          const paid =
            !raw.paidBy && isUsable(raw)
              ? {
                  ...raw,
                  paidBy: {
                    projectId: d.paths.projectId,
                    runId: d.runId,
                    batchId: d.batchId,
                    usd: Math.round(share * 10000) / 10000,
                    at: raw.updatedAt,
                  },
                }
              : raw;
          // Saved immediately (with its identity block), under the lock, before the next image.
          const rec = await d.save(paid);
          const ok = isUsable(rec) || rec.status === "disputed";
          close(rec.imageId, ok);
          out.records.push(rec);
          d.counter.done++;
          const item = part.find((p) => p.imageId === rec.imageId);
          if (ok) {
            if (rec.status === "disputed")
              d.fail(
                `disagreement not settled: ${rec.differences.join("; ")}`,
                item?.name ?? null,
                rec.position,
              );
            streak = { key: "", n: 0 };
            continue;
          }
          const msg = rec.problems.join("; ") || `status ${rec.status}`;
          d.fail(msg, item?.name ?? null, rec.position);
          rateWait = rateLimitWait(msg) ?? rateWait;
          const key = errorKey(msg);
          streak = key === streak.key ? { key, n: streak.n + 1 } : { key, n: 1 };
          if (streak.n >= d.stopAfterSameErrors) {
            out.aborted = `Stopped: ${streak.n} images in a row failed with the same error: ${msg}`;
            return false;
          }
        }
      } finally {
        share ??= (own ?? d.spent() - before) / part.length;
        for (const id of attempt.keys()) close(id, false);
      }
      d.progress("analysis", `${label}: saved`);
      return true;
    } finally {
      clearInterval(beat);
      for (const l of leases) l.release();
    }
  }

  const byApp = new Map<string, PlanItem[]>();
  for (const it of full) byApp.set(it.appId, [...(byApp.get(it.appId) ?? []), it]);
  const chunks: PlanItem[][] = [];
  for (const [, appItems] of byApp)
    for (let i = 0; i < appItems.length; i += d.size) chunks.push(appItems.slice(i, i + d.size));
  await runPool(chunks, {
    concurrency: Math.max(1, d.concurrency ?? 1),
    gate,
    run: (items) => run(items, false),
    shouldStop: d.shouldStop,
    sleep: d.sleep ?? sleepUnlessStopped,
    slowDown: (waitMs) =>
      d.progress(
        "analysis",
        `The AI service asked us to slow down; continuing one image at a time (waiting ${Math.round(waitMs / 1000)} s).`,
      ),
    rateLimit: () => lastRateLimit.take(),
  });
  // Images another job held: checked again once, at the end (free if finished meanwhile).
  for (const it of deferred) {
    if (out.aborted || !gate()) break;
    if (!(await run([it], true))) break;
  }
  return out;
}
