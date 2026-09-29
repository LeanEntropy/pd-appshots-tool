import type { z } from "zod";
import type { Taxonomy } from "../config/load.ts";
import type { KbRun } from "../kb/run.ts";
import type { Storage } from "../storage/index.ts";
import { type AnswerQuery, answerKeyOf } from "./answer-key.ts";
import type { Reservation } from "./budget.ts";
import { rateLimitWait } from "./pool.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { CallUsage, ModelImage, Provider, VisionResult } from "./providers.ts";
import { clampRegions } from "./regions.ts";
import {
  deckAnalysisSchema,
  type ImageAnalysis,
  LEAN_SCHEMA_VERSION,
  SCHEMA_VERSION,
  semanticProblems,
  toJsonSchema,
} from "./schema.ts";
import { expandLean, leanDeckSchema } from "./schema-lean.ts";
import { addUsage } from "./usage.ts";

export interface ChunkImage {
  imageId: string;
  image: ModelImage;
}

/** One paid model call as it happened (kept per run, going forward, for time and cost). */
export interface CallLog {
  step: string;
  model: string;
  key: string;
  imageIds: string[];
  ok: boolean;
  costUsd: number | null;
  usage: CallUsage | null;
  at: string;
  /** Layout calls: the layout contract asked for (its cost differs between contracts). */
  contract?: string;
  /** Why this answer was rejected and repaired (the check results), when it was. */
  problems?: string[];
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
  /**
   * Reserves a call's ceiling before it starts (calls running at the same time); null when
   * what is left cannot fund it. Without it, a call only needs something left.
   */
  reserve?: (step: string) => Reservation | null;
  /** Every paid call, with its tokens and time. */
  onCall?: (c: CallLog) => void;
  /** The batch's pool retries a rate-limited task later: no immediate retry here. */
  poolRetries?: boolean;
  /** The knowledge base of this report's text steps; absent when its Settings switch is off. */
  kb?: KbRun;
}

export interface StoredObject {
  step: string;
  model: string;
  key: string;
  imageIds: string[];
  output: unknown;
  costUsd: number | null;
  attempts: number;
  spentUsd?: number; // every attempt together (costUsd is the last call only)
  createdAt: string;
  /** Tokens and time of the calls that produced this answer (summed over repairs). */
  usage?: CallUsage;
}

export interface ChunkResult {
  readings: Map<string, ImageAnalysis>;
  failed: Map<string, string>;
  /** Object keys (cache files) that produced these readings. */
  objects: Map<string, string>;
}

const MAX_REPAIRS = 2;
const LIMIT_REACHED = "the spending limit for this batch was reached";

/** A saved, still valid answer for exactly this call, or null (never calls a model). */
export function cachedAnswer<T>(
  q: AnswerQuery,
  task: string,
  schema: z.ZodType<T>,
  check: (value: T, refs: string[]) => string[],
  tidy: (value: T) => T = (v) => v,
): { value: T; key: string } | null {
  const key = answerKeyOf(q, task);
  const stored = q.ctx.storage.getJson(q.ctx.answerKey(q.step, key)) as StoredObject | undefined;
  if (!stored) return null;
  const parsed = schema.safeParse(stored.output);
  const value = parsed.success ? tidy(parsed.data) : null;
  const refs = q.images.map((_, i) => `img${i + 1}`);
  return value && check(value, refs).length === 0 ? { value, key } : null;
}

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
  schemaVersion: string = SCHEMA_VERSION,
): Promise<{ value: T | null; key: string; problems: string[] }> {
  const refs = images.map((_, i) => `img${i + 1}`);
  const q = { step, model: provider.model, system, images, ctx, extraKey, schemaVersion };
  const key = answerKeyOf(q, prompt);
  const file = ctx.answerKey(step, key);
  const hit = cachedAnswer(q, prompt, schema, check, tidy);
  if (hit) return { value: hit.value, key: hit.key, problems: [] };
  let problems: string[] = [];
  let repairs: string[] = [];
  let callErrors = 0;
  let paid = 0;
  let usage: CallUsage | undefined;
  const jsonSchema = toJsonSchema(schema);
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    // Check and reservation in one synchronous step: no other call can take the same dollars.
    const left = ctx.remainingUsd();
    if (left <= 0.01) return { value: null, key, problems: [LIMIT_REACHED] };
    const held = ctx.reserve ? ctx.reserve(step) : undefined;
    if (held === null) return { value: null, key, problems: [LIMIT_REACHED] };
    const repair = repairs.length
      ? `\n\nYour previous answer had these problems; fix them:\n- ${repairs.join("\n- ")}`
      : "";
    const r: VisionResult = await provider
      .call({
        model: provider.model,
        system,
        prompt: prompt + repair,
        images: images.map((im, i) => ({ ref: refs[i] as string, image: im.image })),
        schema: jsonSchema,
        maxBudgetUsd: Math.min(ctx.maxBudgetUsd, held ? held.maxUsd : left),
        timeoutMs: ctx.timeoutMs,
      })
      .catch((e: unknown) => ({
        ok: false,
        output: null,
        costUsd: null,
        error: e instanceof Error ? e.message : String(e),
      }));
    // A Claude call that reports no cost (killed, timed out) may still have spent up to its
    // reservation: it counts at that amount, so the spending limit stays a hard limit.
    const cost =
      r.costUsd ?? (held && provider.family === "anthropic" && !r.ok ? held.maxUsd : null);
    if (cost) ctx.onCost(cost);
    paid += cost ?? 0;
    held?.done(cost ?? 0);
    usage = addUsage(usage, r.usage);
    const logCall = (rejected: string[]) =>
      ctx.onCall?.({
        step,
        model: provider.model,
        key,
        imageIds: images.map((i) => i.imageId),
        ok: r.ok,
        costUsd: r.costUsd,
        usage: r.usage ?? null,
        at: new Date().toISOString(),
        ...(rejected.length ? { problems: rejected.slice(0, 10) } : {}),
      });
    if (!r.ok) {
      logCall([]);
      // A failed call (CLI error, timeout) is retried once; the same error twice ends it.
      const err = `${provider.model}: ${r.error ?? "the model call failed"}`;
      callErrors++;
      // In a pool, a rate limit is not retried here: the pool waits and retries it (pool.ts).
      if (
        callErrors >= 2 ||
        problems[0] === err ||
        (ctx.poolRetries && rateLimitWait(err) !== null)
      )
        return { value: null, key, problems: [err] };
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
    logCall(problems);
    if (value && problems.length === 0) {
      const obj: StoredObject = {
        step,
        model: provider.model,
        key,
        imageIds: images.map((i) => i.imageId),
        output: r.output,
        costUsd: r.costUsd,
        attempts: attempt + 1,
        spentUsd: paid,
        createdAt: new Date().toISOString(),
        ...(usage ? { usage } : {}),
      };
      ctx.storage.putJson(file, obj);
      return { value, key, problems: [] };
    }
  }
  return { value: null, key, problems };
}

const DECK_TASK =
  "Analyse each screenshot. They are consecutive store screenshots of one game, in store order.";

type Deck = { images: ImageAnalysis[] };

/**
 * Deck in one call; if that fails validation, falls back to one call per image. `lean` asks for
 * the lean answer (LEAN_SCHEMA_VERSION); it is expanded to the record shape before the checks.
 */
export async function analyseImages(
  step: string,
  provider: Provider,
  system: RenderedPrompt,
  images: readonly ChunkImage[],
  ctx: CallContext,
  lean = false,
): Promise<ChunkResult> {
  // Cast: the lean answer lacks the capture share until `tidy` (expandLean) adds it, before
  // any check or caller sees the value; both shapes are one type from then on.
  const schema: z.ZodType<Deck> = lean
    ? (leanDeckSchema(ctx.taxonomy) as unknown as z.ZodType<Deck>)
    : deckAnalysisSchema(ctx.taxonomy);
  const version = lean ? LEAN_SCHEMA_VERSION : SCHEMA_VERSION;
  const check = (v: Deck, refs: string[]) => semanticProblems(ctx.taxonomy, refs, v.images);
  // Boxes slightly past an edge are clamped for every model (producer and reviewer alike).
  const tidy = (v: Deck) => ({ ...v, images: v.images.map((a) => clampRegions(expandLean(a))) });
  const result: ChunkResult = { readings: new Map(), failed: new Map(), objects: new Map() };
  const take = (value: Deck, key: string, subset: readonly ChunkImage[]) => {
    value.images.forEach((a) => {
      const idx = Number(a.imageRef.replace("img", "")) - 1;
      const im = subset[idx];
      if (im) {
        result.readings.set(im.imageId, a);
        result.objects.set(im.imageId, key);
      }
    });
  };
  const one = (task: string, subset: readonly ChunkImage[]) =>
    validatedCall(step, provider, system, task, subset, schema, check, ctx, null, tidy, version);
  const deck = await one(DECK_TASK, images);
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
    const r = await one("Analyse this screenshot.", [im]);
    if (r.value) take(r.value, r.key, [im]);
    else result.failed.set(im.imageId, r.problems.join("; "));
  }
  return result;
}
