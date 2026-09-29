import type { ProjectPaths } from "../config/load.ts";
import { libraryKey, projectKey, workspaceStorage } from "../storage/index.ts";
import type { ImageDb } from "../store/imagedb.ts";
import type { PixelVerdict } from "../store/pixel-diff.ts";
import { stableHash } from "../util/hash.ts";
import { type CallContext, type ChunkImage, validatedCall } from "./call.ts";
import { type LayerPixel, layerCrops, layerParts, reshapedPair } from "./layer-crops.ts";
import {
  CROP_VERSION,
  combinedReading,
  fillAnswer,
  LAYER_DIFF_SCHEMA,
  type LayerDiff,
  layerAnswerSchema,
  layerDiffProblems,
  layerDiffTask,
} from "./layer-diff-schema.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";
import type { AnalysisRecord } from "./records.ts";

export type { LayerPixel };
export { combinedReading, layerCrops, layerDiffTask };

import { type ImageAnalysis, SCHEMA_VERSION } from "./schema.ts";

/** One saved text-layer comparison (plan-reports 2.4), in the shared library when there is one. */
export interface LayerDiffRecord {
  imageId: string;
  anchorId: string;
  appId: string;
  gl: string;
  hl: string;
  position: number;
  /** The exact anchor analysis compared with: its record key and updatedAt. */
  anchor: { key: string; updatedAt: string };
  key: string;
  status: "ok" | "different-screen" | "failed";
  diff: LayerDiff | null;
  model: string;
  promptHash: string;
  schema: string;
  crop: string;
  cropHashes: string[];
  /** The pixel check the crops and the question were made from (none: everything asked). */
  pixel?: { verdict: PixelVerdict; outside: number };
  problems: string[];
  runId: string;
  updatedAt: string;
  paidBy: {
    projectId: string;
    runId: string;
    batchId: string | null;
    usd: number | null;
    at: string;
  } | null;
}

export interface LayerKeyInput {
  imageId: string;
  anchorId: string;
  anchorKey: string;
  anchorUpdatedAt: string;
  model: string;
  promptHash: string;
}

/**
 * The comparison's key. The crops are a deterministic function of the image, the anchor's
 * regions and the crop method, so their hashes are kept as provenance, not in the key.
 */
export function layerDiffKey(x: LayerKeyInput): string {
  return stableHash({ ...x, schema: LAYER_DIFF_SCHEMA, crop: CROP_VERSION }).slice(0, 40);
}

export function layerDiffStoreKey(paths: ProjectPaths, imageId: string, key: string): string {
  return paths.library
    ? libraryKey("layer-diff", imageId, `${key}.json`)
    : projectKey(paths, "layer-diff", imageId, `${key}.json`);
}

export function readLayerDiff(
  paths: ProjectPaths,
  imageId: string,
  key: string,
): LayerDiffRecord | undefined {
  const raw = workspaceStorage(paths.workspace).getJson(layerDiffStoreKey(paths, imageId, key));
  return raw as LayerDiffRecord | undefined;
}

export function writeLayerDiff(paths: ProjectPaths, r: LayerDiffRecord): void {
  workspaceStorage(paths.workspace).putJson(layerDiffStoreKey(paths, r.imageId, r.key), r);
}

const anchorKeyOf = (a: AnalysisRecord) => a.key ?? "project";

function keyInput(
  imageId: string,
  anchor: AnalysisRecord,
  model: string,
  promptHash: string,
): LayerKeyInput {
  return {
    imageId,
    anchorId: anchor.imageId,
    anchorKey: anchorKeyOf(anchor),
    anchorUpdatedAt: anchor.updatedAt,
    model,
    promptHash,
  };
}

/** The current comparison of an image against an anchor record (code only, no AI). */
export function currentLayerDiff(
  paths: ProjectPaths,
  imageId: string,
  anchor: AnalysisRecord,
  model: string,
  promptHash: string,
): LayerDiffRecord | undefined {
  const r = readLayerDiff(
    paths,
    imageId,
    layerDiffKey(keyInput(imageId, anchor, model, promptHash)),
  );
  return r && r.status !== "failed" ? r : undefined;
}

/** One comparison, not saved: crops, one validated call, then the record. */
export async function compareLayer(
  item: { imageId: string; appId: string; gl: string; hl: string; position: number; label: string },
  anchor: AnalysisRecord & { final: ImageAnalysis },
  d: {
    paths: ProjectPaths;
    db: Pick<ImageDb, "get" | "abs">;
    provider: Provider;
    prompt: RenderedPrompt;
    ctx: CallContext;
    runId: string;
    /** The pixel check of the pair (item 8); none: everything is asked, as before. */
    pixel?: LayerPixel | null;
  },
): Promise<LayerDiffRecord> {
  const input = keyInput(item.imageId, anchor, d.provider.model, d.prompt.hash);
  // An App Store image against a Play anchor of another shape: no pixel check, the whole image.
  const reshaped = reshapedPair(d.db.get(item.imageId), d.db.get(anchor.imageId));
  const pixel = reshaped ? null : d.pixel;
  const parts = layerParts(pixel);
  const crops = await layerCrops(d.paths, d.db, item.imageId, anchor.final, pixel, reshaped);
  const chunk: ChunkImage[] = crops.images.map((image, i) => ({
    imageId: `${item.imageId}-crop-${crops.hashes[i]?.slice(0, 16)}`,
    image,
  }));
  const r = await validatedCall(
    "layer-diff",
    d.provider,
    d.prompt,
    layerDiffTask(anchor.final, item, parts, reshaped),
    chunk,
    layerAnswerSchema(parts),
    (v) => layerDiffProblems(v, anchor.final),
    d.ctx,
    input,
  );
  const value = r.value ? fillAnswer(r.value) : null;
  const status: LayerDiffRecord["status"] = !value
    ? "failed"
    : value.sameScreen
      ? "ok"
      : "different-screen";
  return {
    imageId: item.imageId,
    anchorId: anchor.imageId,
    appId: item.appId,
    gl: item.gl,
    hl: item.hl,
    position: item.position,
    anchor: { key: input.anchorKey, updatedAt: input.anchorUpdatedAt },
    key: layerDiffKey(input),
    status,
    diff: value,
    model: d.provider.model,
    promptHash: d.prompt.hash,
    schema: LAYER_DIFF_SCHEMA,
    crop: CROP_VERSION,
    cropHashes: crops.hashes,
    ...(pixel ? { pixel: { verdict: pixel.verdict, outside: pixel.result.outside } } : {}),
    problems: r.problems,
    runId: d.runId,
    updatedAt: new Date().toISOString(),
    paidBy: null,
  };
}
/** The country image as an analysis record (never written to the analysis store). */
export function combinedRecord(
  r: LayerDiffRecord,
  anchor: AnalysisRecord & { final: ImageAnalysis },
): AnalysisRecord | null {
  if (r.status !== "ok" || !r.diff) return null;
  return {
    imageId: r.imageId,
    schema: SCHEMA_VERSION,
    appId: r.appId,
    gl: r.gl,
    hl: r.hl,
    position: r.position,
    status: "ok",
    final: combinedReading(anchor.final, r.diff),
    producer: { model: r.model, object: r.key },
    reviewer: null,
    adjudication: null,
    differences: [],
    problems: [],
    runId: r.runId,
    updatedAt: r.updatedAt,
  };
}
