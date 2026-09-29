import sharp from "sharp";
import type { ProjectPaths, Taxonomy } from "../config/load.ts";
import { imageKey, modelFile } from "../library/layout.ts";
import { workspaceStorage } from "../storage/index.ts";
import type { ImageDb } from "../store/imagedb.ts";
import { sha256 } from "../util/hash.ts";
import { analyseImages, type CallContext, type ChunkImage, type ChunkResult } from "./call.ts";
import { compareReadings } from "./compare.ts";
import { MODEL_COPY } from "./pipeline.ts";
import type { PlanItem } from "./plan.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { ModelImage, Provider } from "./providers.ts";
import type { AnalysisRecord } from "./records.ts";
import { LEAN_SCHEMA_VERSION, SCHEMA_VERSION, semanticProblems } from "./schema.ts";
import { buildRecord, type Decision, settle } from "./settle.ts";

/**
 * Model copy of an image (see MODEL_COPY), cached by image id, as a provider-neutral image:
 * command-line providers use the local file, an API provider would send the bytes.
 */
export async function modelCopy(
  paths: ProjectPaths,
  db: ImageDb,
  imageId: string,
): Promise<ModelImage> {
  const storage = workspaceStorage(paths.workspace);
  const k = imageKey(paths, modelFile(!!paths.library, imageId));
  if (!storage.exists(k)) {
    const rec = db.get(imageId);
    if (!rec) throw new Error(`Image ${imageId} is not in the project image database.`);
    const bytes = await sharp(db.abs(rec.file))
      .resize({
        width: MODEL_COPY.longEdge,
        height: MODEL_COPY.longEdge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: MODEL_COPY.quality })
      .toBuffer();
    storage.putBlob(k, bytes);
  }
  return {
    mimeType: "image/jpeg",
    localPath: storage.localPath(k),
    bytes: () => storage.getBytes(k) ?? Buffer.alloc(0),
  };
}

/** Error text without volatile parts (numbers, paths), so repeats of one failure match. */
export function errorKey(s: string): string {
  return s
    .replace(/[A-Za-z]:\\[^\s"']+|\/[^\s"']+/g, "<path>")
    .replace(/\d+/g, "#")
    .trim();
}

/** Deterministic review sample: all when coverage is 1, else the lowest-hash share per deck. */
export function reviewSample(ids: readonly string[], coverage: number): Set<string> {
  if (coverage >= 1) return new Set(ids);
  const n = Math.ceil(ids.length * coverage);
  return new Set([...ids].sort((a, b) => (sha256(a) < sha256(b) ? -1 : 1)).slice(0, n));
}

export interface ChunkDeps {
  producer: Provider;
  reviewer: Provider | null;
  adjudicator: Provider;
  analysePrompt: RenderedPrompt;
  adjudicatePrompt: RenderedPrompt;
  taxonomy: Taxonomy;
  coverage: number;
  runId: string;
  ctx: CallContext;
  /** Ask for the lean answer (Settings, "Shorter answers"). */
  lean?: boolean;
  /** Phase changes inside the chunk ("review", "settle"). */
  phase: (phase: string, message: string) => void;
}

/** Produce → blind second opinion → settle disagreements → one record per image. */
export async function analyseChunk(
  chunk: readonly ChunkImage[],
  items: readonly PlanItem[],
  label: string,
  d: ChunkDeps,
): Promise<AnalysisRecord[]> {
  const lean = !!d.lean;
  const produced = await analyseImages(
    "full-analysis",
    d.producer,
    d.analysePrompt,
    chunk,
    d.ctx,
    lean,
  );
  const sample = reviewSample(
    chunk.map((c) => c.imageId),
    d.coverage,
  );
  const toReview = chunk.filter((c) => sample.has(c.imageId) && produced.readings.has(c.imageId));
  let reviewed: ChunkResult = { readings: new Map(), failed: new Map(), objects: new Map() };
  if (d.reviewer && toReview.length) {
    d.phase("review", `Checking ${label} (second opinion)…`);
    reviewed = await analyseImages("review", d.reviewer, d.analysePrompt, toReview, d.ctx, lean);
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
    d.phase("settle", `Settling a disagreement on ${label}…`);
    settled = await settle(
      d.adjudicator,
      d.adjudicatePrompt,
      d.taxonomy,
      disputed,
      produced,
      reviewed,
      disputes,
      d.ctx,
    );
  }
  return chunk.map((c) =>
    buildRecord({
      item: items.find((x) => x.imageId === c.imageId) as PlanItem,
      produced,
      reviewed,
      reviewRequired: !!d.reviewer && sample.has(c.imageId),
      check: (a) => semanticProblems(d.taxonomy, [a.imageRef], [a]),
      disputes,
      notes,
      decision: settled.decisions.get(c.imageId),
      adjudicationKey: settled.key,
      models: {
        producer: d.producer.model,
        reviewer: d.reviewer?.model ?? null,
        adjudicator: d.adjudicator.model,
      },
      runId: d.runId,
      schema: lean ? LEAN_SCHEMA_VERSION : SCHEMA_VERSION,
    }),
  );
}
export { layoutAfterSave } from "../layout/capture.ts";
