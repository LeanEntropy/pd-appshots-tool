import sharp from "sharp";
import type { ProjectPaths } from "../config/load.ts";
import { libraryKey, projectKey, workspaceStorage } from "../storage/index.ts";
import type { ImageDb } from "../store/imagedb.ts";
import { sha256, stableHash } from "../util/hash.ts";
import { type CallContext, type ChunkImage, validatedCall } from "./call.ts";
import {
  CROP_VERSION,
  combinedReading,
  LAYER_DIFF_SCHEMA,
  type LayerDiff,
  layerDiffProblems,
  layerDiffSchema,
  layerDiffTask,
} from "./layer-diff-schema.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { ModelImage, Provider } from "./providers.ts";
import type { AnalysisRecord } from "./records.ts";

export { combinedReading, layerDiffTask };

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

type Box = { x: number; y: number; w: number; h: number };
const PAD = 3;

/** The union box of the anchor's text and mask regions (percent), padded and clamped. */
function layerBox(a: ImageAnalysis): Box | null {
  const m = a.marketingLayer;
  const rs = [...m.texts, ...m.backgroundMasks]
    .map((x) => x.region)
    .filter((r) => r.w > 0 && r.h > 0);
  if (!rs.length) return null;
  const x0 = Math.max(0, Math.min(...rs.map((r) => r.x)) - PAD);
  const y0 = Math.max(0, Math.min(...rs.map((r) => r.y)) - PAD);
  const x1 = Math.min(100, Math.max(...rs.map((r) => r.x + r.w)) + PAD);
  const y1 = Math.min(100, Math.max(...rs.map((r) => r.y + r.h)) + PAD);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * The crops sent to the model: the marketing-layer area of the COUNTRY image (the anchor's text
 * and mask regions), long edge up to 1024, then the whole image small (long edge 384) so the
 * model can tell a different screen. Without regions: a 1024 copy and the small copy.
 */
export async function layerCrops(
  paths: ProjectPaths,
  db: Pick<ImageDb, "get" | "abs">,
  imageId: string,
  anchor: ImageAnalysis,
): Promise<{ images: ModelImage[]; hashes: string[] }> {
  const rec = db.get(imageId);
  if (!rec) throw new Error(`Image ${imageId} is not in the project image database.`);
  const file = db.abs(rec.file);
  const meta = await sharp(file).metadata();
  const W = meta.width ?? rec.width;
  const H = meta.height ?? rec.height;
  const box = layerBox(anchor);
  const shots: Buffer[] = [];
  const fit = (edge: number) => ({
    width: edge,
    height: edge,
    fit: "inside" as const,
    withoutEnlargement: true,
  });
  if (box) {
    const left = Math.min(W - 1, Math.floor((box.x / 100) * W));
    const top = Math.min(H - 1, Math.floor((box.y / 100) * H));
    const width = Math.max(1, Math.min(W - left, Math.ceil((box.w / 100) * W)));
    const height = Math.max(1, Math.min(H - top, Math.ceil((box.h / 100) * H)));
    shots.push(
      await sharp(file)
        .extract({ left, top, width, height })
        .resize(fit(1024))
        .jpeg({ quality: 90 })
        .toBuffer(),
    );
  } else shots.push(await sharp(file).resize(fit(1024)).jpeg({ quality: 90 }).toBuffer());
  shots.push(await sharp(file).resize(fit(384)).jpeg({ quality: 85 }).toBuffer());
  const storage = workspaceStorage(paths.workspace);
  const images: ModelImage[] = [];
  const hashes: string[] = [];
  for (const bytes of shots) {
    const h = sha256(bytes);
    const name = `${imageId}-${h.slice(0, 16)}.jpg`;
    const k = paths.library
      ? libraryKey("images", "crops", name)
      : projectKey(paths, "images", "crops", name);
    storage.putBlob(k, bytes);
    hashes.push(h);
    images.push({
      mimeType: "image/jpeg",
      localPath: storage.localPath(k),
      bytes: () => storage.getBytes(k) ?? Buffer.alloc(0),
    });
  }
  return { images, hashes };
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
  },
): Promise<LayerDiffRecord> {
  const input = keyInput(item.imageId, anchor, d.provider.model, d.prompt.hash);
  const crops = await layerCrops(d.paths, d.db, item.imageId, anchor.final);
  const chunk: ChunkImage[] = crops.images.map((image, i) => ({
    imageId: `${item.imageId}-crop-${crops.hashes[i]?.slice(0, 16)}`,
    image,
  }));
  const r = await validatedCall(
    "layer-diff",
    d.provider,
    d.prompt,
    layerDiffTask(anchor.final, item),
    chunk,
    layerDiffSchema(),
    (v) => layerDiffProblems(v, anchor.final),
    d.ctx,
    input,
  );
  const status: LayerDiffRecord["status"] = !r.value
    ? "failed"
    : r.value.sameScreen
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
    diff: r.value,
    model: d.provider.model,
    promptHash: d.prompt.hash,
    schema: LAYER_DIFF_SCHEMA,
    crop: CROP_VERSION,
    cropHashes: crops.hashes,
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
