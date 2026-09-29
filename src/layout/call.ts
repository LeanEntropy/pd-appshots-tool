import { type CallContext, type ChunkImage, validatedCall } from "../analysis/call.ts";
import type { RenderedPrompt } from "../analysis/prompts.ts";
import type { Provider } from "../analysis/providers.ts";
import type { ImageAnalysis } from "../analysis/schema.ts";
import { layoutProblems, tidyLayout } from "./checks.ts";
import { type Layout, layoutAnswerSchema } from "./schema.ts";
import { LAYOUT_CONTRACT, LAYOUT_SCHEMA_VERSION } from "./vocab.ts";

/** The layout call's step name (its answers are per-image, shared in the library). */
export const LAYOUT_STEP = "layout";

const TASK = "Draw the layout of this screenshot (img1). Its finished analysis:";

/** What the layout call is told about the finished analysis (indexes it must refer to). */
export function readingForLayout(a: ImageAnalysis): string {
  const s = a.screenshot;
  const m = a.marketingLayer;
  return JSON.stringify({
    composition: s.composition,
    screenType: s.screenType,
    captures: s.captures.map((c, index) => ({ index, screenType: c.screenType, region: c.region })),
    marketingLayer: {
      present: m.present,
      texts: m.texts.map((t, index) => ({ index, text: t.text, role: t.role, region: t.region })),
      masks: m.backgroundMasks.map((b) => ({
        shape: b.shape,
        colour: b.colourName,
        region: b.region,
      })),
      elements: m.elements.map((e) => ({ kind: e.kind, what: e.what, region: e.region })),
    },
  });
}

/**
 * The layout of one analysed image in its own call (the main analysis is never touched): the
 * image and the finished reading go in, the layout comes back, checked against the reading
 * (text and capture references, marketing layer present or not). Cached by content like every
 * model answer; a failed layout never affects the analysis.
 */
export async function layoutCall(
  provider: Provider,
  system: RenderedPrompt,
  image: ChunkImage,
  reading: ImageAnalysis,
  ctx: CallContext,
): Promise<{ layout: Layout | null; key: string; problems: string[] }> {
  const core = { ...reading, imageRef: "img1" };
  const r = await validatedCall(
    LAYOUT_STEP,
    provider,
    system,
    `${TASK}\n${readingForLayout(reading)}`,
    [image],
    layoutAnswerSchema,
    (v) => layoutProblems(v.layout, core),
    // Each call is tagged with the contract, so the estimates count today's contract only.
    { ...ctx, onCall: (c) => ctx.onCall?.({ ...c, contract: LAYOUT_CONTRACT }) },
    { contract: LAYOUT_CONTRACT },
    (v) => ({ layout: tidyLayout(v.layout, core) }),
    LAYOUT_SCHEMA_VERSION,
  );
  return { layout: r.value?.layout ?? null, key: r.key, problems: r.problems };
}
