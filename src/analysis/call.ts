import type { z } from "zod";
import type { Taxonomy } from "../config/load.ts";
import type { Storage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { ModelImage, Provider } from "./providers.ts";
import { clampRegions } from "./regions.ts";
import {
  deckAnalysisSchema,
  type ImageAnalysis,
  SCHEMA_VERSION,
  semanticProblems,
  toJsonSchema,
} from "./schema.ts";

export interface ChunkImage {
  imageId: string;
  image: ModelImage;
}

export interface CallContext {
  storage: Storage;
  /**
   * Storage key of a cached model answer: per-image steps go to the shared library once the
   * project uses it; project-level steps (patterns, recommendations) stay in the project.
   */
  answerKey: (step: string, key: string) => string;
  taxonomy: Taxonomy;
  taxonomyHash: string;
  /** Per-call ceiling; each call also gets no more than what is left of the batch limit. */
  maxBudgetUsd: number;
  /** Dollars left for this batch (Claude side). Calls stop when it reaches zero. */
  remainingUsd: () => number;
  timeoutMs: number;
  /** Adds the real cost of each model call (for the budget guard). */
  onCost: (usd: number) => void;
}

export interface StoredObject {
  step: string;
  model: string;
  key: string;
  imageIds: string[];
  output: unknown;
  costUsd: number | null;
  attempts: number;
  createdAt: string;
}

export interface ChunkResult {
  readings: Map<string, ImageAnalysis>;
  failed: Map<string, string>;
  /** Object keys (cache files) that produced these readings. */
  objects: Map<string, string>;
}

const MAX_REPAIRS = 2;

/**
 * One validated model call for a set of images, cached by content: the key covers the step,
 * model, prompt text, schema version, taxonomy and the ordered image ids. An answer that fails
 * validation gets up to two repair attempts with the problems listed. `tidy` fixes harmless
 * slips (e.g. a box slightly past an edge) before the checks, for fresh and cached answers alike.
 */
export async function validatedCall<T>(
  step: string,
  provider: Provider,
  system: RenderedPrompt,
  prompt: string,
  images: readonly ChunkImage[],
  schema: z.ZodType<T>,
  check: (value: T, refs: string[]) => string[],
  ctx: CallContext,
  extraKey: unknown = null,
  tidy: (value: T) => T = (v) => v,
): Promise<{ value: T | null; key: string; problems: string[] }> {
  const refs = images.map((_, i) => `img${i + 1}`);
  const key = stableHash({
    step,
    model: provider.model,
    prompt: system.hash,
    task: prompt,
    schema: SCHEMA_VERSION,
    taxonomy: ctx.taxonomyHash,
    images: images.map((i) => i.imageId),
    extraKey,
  });
  const file = ctx.answerKey(step, key);
  const stored = ctx.storage.getJson(file) as StoredObject | undefined;
  if (stored) {
    const parsed = schema.safeParse(stored.output);
    const value = parsed.success ? tidy(parsed.data) : null;
    if (value && check(value, refs).length === 0) return { value, key, problems: [] };
  }
  let problems: string[] = [];
  let repairs: string[] = [];
  let callErrors = 0;
  const jsonSchema = toJsonSchema(schema);
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const left = ctx.remainingUsd();
    if (left <= 0.01)
      return { value: null, key, problems: ["the spending limit for this batch was reached"] };
    const repair = repairs.length
      ? `\n\nYour previous answer had these problems; fix them:\n- ${repairs.join("\n- ")}`
      : "";
    const r = await provider.call({
      model: provider.model,
      system,
      prompt: prompt + repair,
      images: images.map((im, i) => ({ ref: refs[i] as string, image: im.image })),
      schema: jsonSchema,
      maxBudgetUsd: Math.min(ctx.maxBudgetUsd, left),
      timeoutMs: ctx.timeoutMs,
    });
    if (r.costUsd) ctx.onCost(r.costUsd);
    if (!r.ok) {
      // A failed call (CLI error, timeout) is retried once; the same error twice ends it.
      const err = `${provider.model}: ${r.error ?? "the model call failed"}`;
      callErrors++;
      if (callErrors >= 2 || problems[0] === err) return { value: null, key, problems: [err] };
      problems = [err];
      continue;
    }
    const parsed = schema.safeParse(r.output);
    const value = parsed.success ? tidy(parsed.data) : null;
    problems = value
      ? check(value, refs)
      : parsed.success
        ? []
        : parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`);
    repairs = problems;
    if (value && problems.length === 0) {
      const obj: StoredObject = {
        step,
        model: provider.model,
        key,
        imageIds: images.map((i) => i.imageId),
        output: r.output,
        costUsd: r.costUsd,
        attempts: attempt + 1,
        createdAt: new Date().toISOString(),
      };
      ctx.storage.putJson(file, obj);
      return { value, key, problems: [] };
    }
  }
  return { value: null, key, problems };
}

const DECK_TASK =
  "Analyse each screenshot. They are consecutive store screenshots of one game, in store order.";

/** Deck in one call; if that fails validation, falls back to one call per image. */
export async function analyseImages(
  step: string,
  provider: Provider,
  system: RenderedPrompt,
  images: readonly ChunkImage[],
  ctx: CallContext,
): Promise<ChunkResult> {
  const schema = deckAnalysisSchema(ctx.taxonomy);
  const check = (v: z.infer<typeof schema>, refs: string[]) =>
    semanticProblems(ctx.taxonomy, refs, v.images);
  // Boxes slightly past an edge are clamped for every model (producer and reviewer alike).
  const tidy = (v: z.infer<typeof schema>) => ({ ...v, images: v.images.map(clampRegions) });
  const result: ChunkResult = { readings: new Map(), failed: new Map(), objects: new Map() };
  const take = (value: z.infer<typeof schema>, key: string, subset: readonly ChunkImage[]) => {
    value.images.forEach((a) => {
      const idx = Number(a.imageRef.replace("img", "")) - 1;
      const im = subset[idx];
      if (im) {
        result.readings.set(im.imageId, a);
        result.objects.set(im.imageId, key);
      }
    });
  };
  const deck = await validatedCall(
    step,
    provider,
    system,
    DECK_TASK,
    images,
    schema,
    check,
    ctx,
    null,
    tidy,
  );
  if (deck.value) {
    take(deck.value, deck.key, images);
    return result;
  }
  // One image, or a failed call (not a validation problem): no per-image fallback.
  if (images.length === 1 || deck.problems[0]?.startsWith(`${provider.model}: `)) {
    for (const im of images) result.failed.set(im.imageId, deck.problems.join("; "));
    return result;
  }
  for (const im of images) {
    const one = await validatedCall(
      step,
      provider,
      system,
      "Analyse this screenshot.",
      [im],
      schema,
      check,
      ctx,
      null,
      tidy,
    );
    if (one.value) take(one.value, one.key, [im]);
    else result.failed.set(im.imageId, one.problems.join("; "));
  }
  return result;
}
