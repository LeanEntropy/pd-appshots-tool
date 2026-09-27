import { z } from "zod";
import type { Taxonomy } from "../config/load.ts";

/** Bump when the shape changes; part of every cache key. */
export const SCHEMA_VERSION = "analysis-schema.v1";

/**
 * Every object is strict and every field required (nullable instead of optional), so the same
 * JSON Schema works for Claude structured output and OpenAI strict mode.
 */
const Region = z.strictObject({
  x: z.number().describe("left edge, percent of image width 0-100"),
  y: z.number().describe("top edge, percent of image height 0-100"),
  w: z.number().describe("width, percent 0-100"),
  h: z.number().describe("height, percent 0-100"),
});

const Band = z.strictObject({
  type: z.enum(["solid", "gradient", "diagonal", "shape", "translucent"]),
  position: z.enum(["top", "bottom", "middle", "overlay"]),
  heightPercent: z.number(),
  colourName: z.string(),
  colourHex: z.string().describe('approximate hex like "#1f6fd0", or "unknown"'),
  region: Region,
});

const TextBlock = z.strictObject({
  role: z.enum(["headline", "subheadline", "label", "badge", "legal", "other"]),
  text: z.string().describe("exact text, character for character, in its original script"),
  language: z.string().describe("BCP-47 code, e.g. en, ja, ko, zh-Hant, th"),
  style: z.string(),
  fill: z.string(),
  stroke: z.string(),
  size: z.enum(["small", "medium", "large", "huge"]),
  region: Region,
});

const Callout = z.strictObject({
  kind: z.enum(["character", "item", "creature", "ui_element"]),
  identity: z.string(),
  placement: z.string(),
  scale: z.enum(["small", "medium", "large", "dominant"]),
  breaksFrame: z.boolean(),
  region: Region,
});

export function imageAnalysisSchema(taxonomy: Taxonomy) {
  const types = taxonomy.screenTypes.map((t) => t.id) as [string, ...string[]];
  return z.strictObject({
    imageRef: z.string().describe("the reference label given for this image, e.g. img1"),
    screenType: z.enum(types),
    subtype: z
      .string()
      .describe("a subtype from the taxonomy for the chosen screen type, or empty"),
    captureDescription: z.string().describe("what the underlying in-game screen shows"),
    hasMarketingLayer: z.boolean(),
    composition: z.enum(["full_bleed_capture", "framed_capture", "split", "collage", "no_capture"]),
    bands: z.array(Band),
    headline: z.string().describe("the main marketing headline exactly as written, or empty"),
    textBlocks: z.array(TextBlock),
    callouts: z.array(Callout),
    decorations: z.array(z.string()),
    relationToScreen: z.enum(["describes", "exaggerates", "unrelated", "none"]),
    occlusionPercent: z.number(),
    confidence: z.number().describe("0-1, your confidence in the screen type"),
    notes: z.string(),
  });
}
export type ImageAnalysis = z.infer<ReturnType<typeof imageAnalysisSchema>>;

export function deckAnalysisSchema(taxonomy: Taxonomy) {
  return z.strictObject({ images: z.array(imageAnalysisSchema(taxonomy)) });
}

export function adjudicationSchema(taxonomy: Taxonomy) {
  const types = taxonomy.screenTypes.map((t) => t.id) as [string, ...string[]];
  return z.strictObject({
    decisions: z.array(
      z.strictObject({
        imageRef: z.string(),
        chosen: z.enum(["first", "second", "neither"]),
        screenType: z.enum(types),
        subtype: z.string(),
        headline: z.string(),
        reason: z.string(),
      }),
    ),
  });
}
export type Adjudication = z.infer<ReturnType<typeof adjudicationSchema>>;

/** JSON Schema for the providers (Claude --json-schema, Codex --output-schema). */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}

/** Checks a validated deck result against what was sent. Returns plain-language problems. */
export function semanticProblems(
  taxonomy: Taxonomy,
  refs: readonly string[],
  images: readonly ImageAnalysis[],
): string[] {
  const problems: string[] = [];
  const got = images.map((i) => i.imageRef);
  for (const r of refs) if (!got.includes(r)) problems.push(`missing result for ${r}`);
  for (const r of got)
    if (!refs.includes(r)) problems.push(`result for an image that was not sent: ${r}`);
  if (new Set(got).size !== got.length) problems.push("an image has more than one result");
  const inRange = (n: number) => n >= 0 && n <= 100;
  for (const i of images) {
    const t = taxonomy.screenTypes.find((x) => x.id === i.screenType);
    if (i.subtype && t?.subtypes.length && !t.subtypes.includes(i.subtype)) {
      problems.push(
        `${i.imageRef}: subtype "${i.subtype}" is not in the taxonomy for ${i.screenType}`,
      );
    }
    if (i.screenType === "other" && !i.notes.trim())
      problems.push(`${i.imageRef}: "other" needs a note`);
    if (!(i.confidence >= 0 && i.confidence <= 1))
      problems.push(`${i.imageRef}: confidence out of range`);
    const regions = [...i.bands, ...i.textBlocks, ...i.callouts].map((x) => x.region);
    const inside = (r: { x: number; y: number; w: number; h: number }) =>
      [r.x, r.y, r.w, r.h].every(inRange) && r.x + r.w <= 100.5 && r.y + r.h <= 100.5;
    if (!regions.every(inside)) problems.push(`${i.imageRef}: region out of range`);
    if (!inRange(i.occlusionPercent) || !i.bands.every((b) => inRange(b.heightPercent))) {
      problems.push(`${i.imageRef}: percentage out of range`);
    }
    if (!i.bands.every((b) => b.colourHex === "unknown" || /^#[0-9a-fA-F]{6}$/.test(b.colourHex))) {
      problems.push(`${i.imageRef}: colour must be a hex like #1f6fd0 or "unknown"`);
    }
  }
  return problems;
}
