import { stableHash } from "../util/hash.ts";
import type { CallContext, ChunkImage } from "./call.ts";
import type { RenderedPrompt } from "./prompts.ts";
import { SCHEMA_VERSION } from "./schema.ts";

/** What a cached model answer is keyed by (see validatedCall). */
export interface AnswerQuery {
  step: string;
  model: string;
  system: RenderedPrompt;
  images: readonly ChunkImage[];
  ctx: CallContext;
  extraKey?: unknown;
  schemaVersion?: string;
}

export function answerKeyOf(q: AnswerQuery, task: string): string {
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
