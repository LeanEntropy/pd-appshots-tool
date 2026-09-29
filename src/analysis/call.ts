import type { z } from "zod";
import type { Taxonomy } from "../config/load.ts";
import type { Storage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";
import type { Reservation } from "./budget.ts";
import { rateLimitWait } from "./pool.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { CallUsage, ModelImage, Provider, VisionResult } from "./providers.ts";
import { type ImageAnalysis, SCHEMA_VERSION, toJsonSchema } from "./schema.ts";
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

export interface AnswerQuery {
  step: string;
  model: string;
  system: RenderedPrompt;
  images: readonly ChunkImage[];
  ctx: CallContext;
  extraKey?: unknown;
  schemaVersion?: string;
}

function answerKeyOf(q: AnswerQuery, task: string): string {
  return stableHash({
    step: q.step,
    model: q.model,
    prompt: q.system.hash,
    task,
    schema: q.schemaVersion ?? SCHEMA_VERSION,
    taxonomy: q.ctx.taxonomyHash,
    images: q.images.map((i) => i.imageId),
    extraKey: q.extraKey ?? null,
  });
}

/** A saved, still valid answer for exactly this call, or null (never calls a model). */
export function cachedAnswer<T>(
  q: AnswerQuery,
  task: string,
  schema: z.ZodType<T>,
  check: (value: T, refs: string[]) => string[],
  tidy: (value: T) => T = (v) => v,
  core: (raw: unknown) => unknown = (raw) => raw,
): { value: T; key: string } | null {
  const key = answerKeyOf(q, task);
  const stored = q.ctx.storage.getJson(q.ctx.answerKey(q.step, key)) as StoredObject | undefined;
  if (!stored) return null;
  const parsed = schema.safeParse(core(stored.output));
  const value = parsed.success ? tidy(parsed.data) : null;
  const refs = q.images.map((_, i) => `img${i + 1}`);
  return value && check(value, refs).length === 0 ? { value, key } : null;
}

/**
 * An add-on asked for in the same call but checked apart from the core answer
 * (plan-layout-wireframes 2.4): its problems never fail a valid core. They join the repair
 * request while the core also needs one, or get one repair of their own; if they remain, the
 * valid core is kept (the add-on then reads as missing from the saved answer).
 */
export interface SplitCheck<T> {
  /** The answer's JSON Schema as sent: the core plus its add-on. */
  sendSchema: z.ZodType;
  /** The raw answer without the add-on (what the core schema parses). */
  core: (raw: unknown) => unknown;
  /** The add-on's problems, given the valid core value. */
  addOn: (raw: unknown, value: T) => string[];
}

/**
 * One validated model call for a set of images, cached by content: the key covers the step,
 * model, prompt text, schema version, taxonomy and the ordered image ids. An answer that fails
 * validation gets up to two repair attempts with the problems listed. `tidy` fixes harmless
 * slips (e.g. a box slightly past an edge) before the checks, for fresh and cached answers alike.
 * The raw answer is saved as soon as its core is valid.
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
  split?: SplitCheck<T>,
): Promise<{ value: T | null; key: string; problems: string[] }> {
  const refs = images.map((_, i) => `img${i + 1}`);
  const q = { step, model: provider.model, system, images, ctx, extraKey, schemaVersion };
  const key = answerKeyOf(q, prompt);
  const file = ctx.answerKey(step, key);
  const hit = cachedAnswer(q, prompt, schema, check, tidy, split?.core);
  if (hit) return { value: hit.value, key: hit.key, problems: [] };
  let problems: string[] = [];
  let repairs: string[] = [];
  let callErrors = 0;
  let usage: CallUsage | undefined;
  // A valid core, already saved, while its add-on gets the one repair of its own.
  let kept: T | null = null;
  const end = (p: string[]) =>
    kept !== null ? { value: kept, key, problems: [] } : { value: null, key, problems: p };
  const jsonSchema = toJsonSchema(split?.sendSchema ?? schema);
  // Up to two repairs for the core, plus one for the add-on alone once the core is valid.
  for (let attempt = 0; attempt <= MAX_REPAIRS + 1; attempt++) {
    if (attempt > MAX_REPAIRS && kept === null) break;
    // Check and reservation in one synchronous step: no other call can take the same dollars.
    const left = ctx.remainingUsd();
    if (left <= 0.01) return end([LIMIT_REACHED]);
    const held = ctx.reserve ? ctx.reserve(step) : undefined;
    if (held === null) return end([LIMIT_REACHED]);
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
    held?.done(cost ?? 0);
    usage = addUsage(usage, r.usage);
    ctx.onCall?.({
      step,
      model: provider.model,
      key,
      imageIds: images.map((i) => i.imageId),
      ok: r.ok,
      costUsd: r.costUsd,
      usage: r.usage ?? null,
      at: new Date().toISOString(),
    });
    if (!r.ok) {
      // A failed call (CLI error, timeout) is retried once; the same error twice ends it.
      const err = `${provider.model}: ${r.error ?? "the model call failed"}`;
      callErrors++;
      // In a pool, a rate limit is not retried here: the pool waits and retries it (pool.ts).
      if (
        kept !== null ||
        callErrors >= 2 ||
        problems[0] === err ||
        (ctx.poolRetries && rateLimitWait(err) !== null)
      )
        return end([err]);
      problems = [err];
      continue;
    }
    const parsed = schema.safeParse(split ? split.core(r.output) : r.output);
    const value = parsed.success ? tidy(parsed.data) : null;
    problems = value
      ? check(value, refs)
      : parsed.success
        ? []
        : parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`);
    const addOn = value && split ? split.addOn(r.output, value) : [];
    repairs = [...problems, ...addOn];
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
        ...(usage ? { usage } : {}),
      };
      ctx.storage.putJson(file, obj);
      // One repair for the add-on alone; after it the core stays.
      if (!addOn.length || kept !== null) return { value, key, problems: [] };
      kept = value;
      repairs = addOn;
      continue;
    }
    // The add-on's own repair broke the core: the saved answer (valid core) stays.
    if (kept !== null) return end(problems);
  }
  return end(problems);
}
