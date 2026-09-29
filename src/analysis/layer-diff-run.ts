import type { ProjectPaths } from "../config/load.ts";
import { HEARTBEAT_MS } from "../storage/leases.ts";
import type { ImageDb } from "../store/imagedb.ts";
import { endAttempt, lockRecord, startAttempt } from "./attempts.ts";
import type { CallContext } from "./call.ts";
import {
  compareLayer,
  currentLayerDiff,
  type LayerDiffRecord,
  type LayerPixel,
  writeLayerDiff,
} from "./layer-diff.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";
import { type AnalysisRecord, isUsable } from "./records.ts";
import { errorKey } from "./run-chunk.ts";
import type { ImageAnalysis } from "./schema.ts";

/** One image whose text layer is compared with its anchor (the same picture, analysed). */
export interface LayerItem {
  imageId: string;
  anchorId: string;
  appId: string;
  name: string;
  gl: string;
  hl: string;
  /** Plain country name. */
  label: string;
  position: number;
}

export interface LayerLoopDeps {
  paths: ProjectPaths;
  db: Pick<ImageDb, "get" | "abs">;
  provider: Provider;
  prompt: RenderedPrompt;
  ctx: CallContext;
  runId: string;
  batchId: string | null;
  /** Anchors are looked up here (usable analyses only). */
  records: ReadonlyMap<string, AnalysisRecord>;
  estimatePerImage: number;
  stopAfterSameErrors: number;
  shouldStop: () => boolean;
  budgetLeft: () => number;
  spent: () => number;
  progress: (phase: string, message: string) => void;
  fail: (message: string, name: string | null, position: number | null) => void;
  counter: { done: number };
  total: number;
  /**
   * The pixel check of an image against its anchor (item 8): the crops then cover the texts
   * and the changed areas, and only what changed is asked. Absent (check off): as before.
   */
  pixel?: (
    imageId: string,
    anchor: AnalysisRecord & { final: ImageAnalysis },
  ) => Promise<LayerPixel | null>;
}

export interface LayerLoopResult {
  records: LayerDiffRecord[];
  stoppedForBudget: boolean;
  cancelled: boolean;
  aborted: string | null;
  /** Images whose screen turned out different: they need a full analysis (never done here). */
  differentScreens: string[];
  /** Items whose anchor has no usable analysis (skipped). */
  noAnchor: string[];
}

/** The pseudo image id of an image's text-layer attempts and lock. */
export const layerAttemptId = (imageId: string) => `layer-${imageId}`;

/**
 * Compares the text layers, one image per call. Each result is saved the moment it is done
 * (resumable); an image with a current comparison is skipped for free. A "different screen"
 * answer is saved and listed, and never escalates to a full analysis by itself. Stop, the
 * spending limit and a streak of identical errors end the loop; everything finished is kept.
 */
export async function compareLayers(
  items: readonly LayerItem[],
  d: LayerLoopDeps,
): Promise<LayerLoopResult> {
  const out: LayerLoopResult = {
    records: [],
    stoppedForBudget: false,
    cancelled: false,
    aborted: null,
    differentScreens: [],
    noAnchor: [],
  };
  let streak = { key: "", n: 0 };
  for (const it of items) {
    if (d.shouldStop()) {
      out.cancelled = true;
      break;
    }
    if (d.budgetLeft() <= 0) {
      out.stoppedForBudget = true;
      break;
    }
    const anchor = d.records.get(it.anchorId);
    if (!isUsable(anchor)) {
      out.noAnchor.push(it.imageId);
      d.counter.done++;
      continue;
    }
    const current = () =>
      currentLayerDiff(d.paths, it.imageId, anchor, d.provider.model, d.prompt.hash);
    const done = current();
    if (done) {
      if (done.status === "different-screen") out.differentScreens.push(it.imageId);
      d.counter.done++;
      continue;
    }
    const pseudo = layerAttemptId(it.imageId);
    const lock = lockRecord(d.paths, pseudo, "layer-diff");
    if ("heldBy" in lock) {
      d.counter.done++;
      d.fail("being compared by another job; it will be reused, not paid", it.name, it.position);
      continue;
    }
    const beat = setInterval(() => lock.heartbeat(), HEARTBEAT_MS);
    beat.unref();
    try {
      if (current()) {
        d.counter.done++;
        continue;
      }
      const where = `${it.name} #${it.position} in ${it.label}`;
      d.progress(
        "layer-diff",
        `Comparing text, image ${d.counter.done + 1} of ${d.total} — ${where}`,
      );
      const before = d.spent();
      const attempt = startAttempt(d.paths, pseudo, {
        runId: d.runId,
        batchId: d.batchId,
        estimateUsd: d.estimatePerImage,
      });
      let ok = false;
      try {
        const pixel = d.pixel ? await d.pixel(it.imageId, anchor).catch(() => null) : null;
        const raw = await compareLayer(it, anchor, {
          pixel,
          paths: d.paths,
          db: d.db,
          provider: d.provider,
          prompt: d.prompt,
          ctx: d.ctx,
          runId: d.runId,
        });
        const usd = d.spent() - before;
        const rec: LayerDiffRecord =
          raw.status !== "failed"
            ? {
                ...raw,
                paidBy: {
                  projectId: d.paths.projectId,
                  runId: d.runId,
                  batchId: d.batchId,
                  usd: Math.round(usd * 10000) / 10000,
                  at: raw.updatedAt,
                },
              }
            : raw;
        writeLayerDiff(d.paths, rec);
        ok = rec.status !== "failed";
        out.records.push(rec);
        d.counter.done++;
        if (rec.status === "different-screen") {
          out.differentScreens.push(it.imageId);
          d.fail(
            "the screen under the text is different: it needs a full analysis (asked separately)",
            it.name,
            it.position,
          );
        }
        if (ok) {
          streak = { key: "", n: 0 };
          continue;
        }
        const msg = rec.problems.join("; ") || "the comparison failed";
        d.fail(msg, it.name, it.position);
        const key = errorKey(msg);
        streak = key === streak.key ? { key, n: streak.n + 1 } : { key, n: 1 };
        if (streak.n >= d.stopAfterSameErrors) {
          out.aborted = `Stopped: ${streak.n} images in a row failed with the same error: ${msg}`;
          break;
        }
      } finally {
        endAttempt(
          d.paths,
          pseudo,
          attempt,
          d.batchId,
          ok ? "finished" : "failed",
          d.spent() - before,
        );
      }
    } finally {
      clearInterval(beat);
      lock.release();
    }
  }
  return out;
}
