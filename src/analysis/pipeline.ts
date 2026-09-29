import type { Config } from "../config/schema.ts";
import { stableHash } from "../util/hash.ts";
import { LEAN_FULL_ANALYSIS, PROMPT_VERSIONS } from "./prompts.ts";
import { LEAN_SCHEMA_VERSION, SCHEMA_VERSION } from "./schema.ts";

/**
 * Model copy of an image: long edge 1568 px, JPEG quality 90. Changing any of these needs a new
 * version, which changes the analysis key (plan 12A, A2) and the model-copy file name.
 */
export const MODEL_COPY = { version: "model-copy.v1", longEdge: 1568, quality: 90 } as const;

/** Rules that compare two readings and settle disputes (compare.ts, settle.ts). */
export const SETTLE_RULES_VERSION = "settle-rules.v1";

/**
 * Everything that decides what one image's analysis contains. Two projects share an analysis
 * only when their pipeline specs are equal. The taxonomy is deliberately not part of it: label
 * changes are deterministic mappings applied without re-analysis.
 */
export interface PipelineSpec {
  schema: string;
  prompts: { fullAnalysis: string; review: string; adjudicate: string };
  models: { producer: string; reviewer: string; settle: string };
  /** Which images get a second opinion; "none" when reviews are off. */
  review: ReviewPolicy | "none";
  modelCopy: string;
  settleRules: string;
}

export interface ReviewPolicy {
  coreCoverage: number;
  expansionCoverage: number;
  alsoBelowConfidence: number;
}

export function reviewPolicy(config: Config): ReviewPolicy | "none" {
  const r = config.review;
  if (!r.enabled) return "none";
  return {
    coreCoverage: r.coreCoverage,
    expansionCoverage: r.expansionCoverage,
    alsoBelowConfidence: r.alsoBelowConfidence,
  };
}

/** The pipeline a project's settings run today. */
export function currentPipeline(config: Config): PipelineSpec {
  const lean = config.options.speed.leanAnswer;
  const analysis = lean ? LEAN_FULL_ANALYSIS.version : PROMPT_VERSIONS.fullAnalysis;
  return {
    schema: lean ? LEAN_SCHEMA_VERSION : SCHEMA_VERSION,
    // The second opinion reads the image with the same analysis prompt as the producer.
    prompts: {
      fullAnalysis: analysis,
      review: analysis,
      adjudicate: PROMPT_VERSIONS.adjudicate,
    },
    models: {
      producer: config.models.fullAnalysis,
      reviewer: config.review.enabled ? config.models.imageReview : "none",
      settle: config.models.adjudicate,
    },
    review: reviewPolicy(config),
    modelCopy: MODEL_COPY.version,
    settleRules: SETTLE_RULES_VERSION,
  };
}

/** The one place an analysis key is made. */
export function analysisKey(spec: PipelineSpec): string {
  return stableHash(spec).slice(0, 32);
}

export const isLean = (spec: PipelineSpec) => spec.schema === LEAN_SCHEMA_VERSION;

/**
 * Keys whose records a project with this pipeline reads as current, own key first. One
 * direction only: the lean pipeline also accepts records of the same pipeline with today's full
 * answer (a complete superset of the lean one); a pipeline with the full answer never accepts
 * lean records.
 */
export function acceptedKeys(spec: PipelineSpec): string[] {
  const own = analysisKey(spec);
  if (!isLean(spec)) return [own];
  const full: PipelineSpec = {
    ...spec,
    schema: SCHEMA_VERSION,
    prompts: {
      ...spec.prompts,
      fullAnalysis: PROMPT_VERSIONS.fullAnalysis,
      review: PROMPT_VERSIONS.fullAnalysis,
    },
  };
  return [own, analysisKey(full)];
}

/** Name of the per-project record for analyses whose settings cannot be proven (import only). */
export function unprovenKey(projectId: string): string {
  return `unproven-${projectId}`;
}

/** Per-image model answers live in the shared library; synthesis answers stay in the project. */
export const PER_IMAGE_STEPS: ReadonlySet<string> = new Set([
  "full-analysis",
  "review",
  "adjudicate",
  // The layout breakdown's own call (src/layout/call.ts); not part of the analysis key.
  "layout",
]);
