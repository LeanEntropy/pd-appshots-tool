import type { z } from "zod";
import { readLayout } from "../layout/checks.ts";
import { splitLayouts, withLayoutDeckSchema } from "../layout/schema.ts";
import { LAYOUT_CONTRACT } from "../layout/vocab.ts";
import {
  type CallContext,
  type ChunkImage,
  type ChunkResult,
  type SplitCheck,
  validatedCall,
} from "./call.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";
import { clampRegions } from "./regions.ts";
import {
  deckAnalysisSchema,
  type ImageAnalysis,
  LEAN_SCHEMA_VERSION,
  SCHEMA_VERSION,
  semanticProblems,
} from "./schema.ts";
import { expandLean, leanDeckSchema } from "./schema-lean.ts";

const DECK_TASK =
  "Analyse each screenshot. They are consecutive store screenshots of one game, in store order.";

type Deck = { images: ImageAnalysis[] };

/**
 * The layout add-on of a per-image answer (plan-layout-wireframes 2.4): sent as part of the
 * answer schema, checked apart from the core, so a bad layout never costs the core reading.
 */
export function layoutSplit(ctx: CallContext, lean: boolean): SplitCheck<Deck> {
  return {
    sendSchema: withLayoutDeckSchema(ctx.taxonomy, lean),
    core: (raw) => splitLayouts(raw).core,
    addOn: (raw, deck) => {
      const layouts = splitLayouts(raw).layouts;
      return deck.images.flatMap((a) => readLayout(layouts.get(a.imageRef), a).problems);
    },
  };
}

/**
 * Deck in one call; if that fails validation, falls back to one call per image. `lean` asks for
 * the lean answer (LEAN_SCHEMA_VERSION); it is expanded to the record shape before the checks.
 * `layout` also asks for the layout breakdown (the producer's prompt must carry its block).
 */
export async function analyseImages(
  step: string,
  provider: Provider,
  system: RenderedPrompt,
  images: readonly ChunkImage[],
  ctx: CallContext,
  lean = false,
  layout = false,
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
  const split = layout ? layoutSplit(ctx, lean) : undefined;
  const extraKey = layout ? { layout: LAYOUT_CONTRACT } : null;
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
    validatedCall(
      step,
      provider,
      system,
      task,
      subset,
      schema,
      check,
      ctx,
      extraKey,
      tidy,
      version,
      split,
    );
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
