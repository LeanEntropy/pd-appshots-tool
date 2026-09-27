import { z } from "zod";
import type { Taxonomy } from "../config/load.ts";

/** Bump when the shape changes; part of every cache key. Records of other versions are redone. */
export const SCHEMA_VERSION = "analysis-schema.v2";

/**
 * Every object is strict and every field required (empty or "unknown" instead of optional), so
 * the same JSON Schema works for Claude structured output and OpenAI strict mode.
 */
const Region = z.strictObject({
  x: z.number().describe("left edge, percent of image width 0-100"),
  y: z.number().describe("top edge, percent of image height 0-100"),
  w: z.number().describe("width, percent 0-100"),
  h: z.number().describe("height, percent 0-100"),
});

const Hex = z.string().describe('approximate hex like "#1f6fd0", or "unknown"');
const Colour = z.strictObject({ name: z.string(), hex: Hex });

const Mask = z.strictObject({
  shape: z.enum([
    "band",
    "diagonal_band",
    "panel",
    "full_background",
    "gradient_fade",
    "frame",
    "burst",
    "other",
  ]),
  colourName: z.string(),
  colourHex: Hex,
  location: z.enum(["top", "bottom", "middle", "left", "right", "full", "overlay"]),
  region: Region,
});

const TextBlock = z.strictObject({
  role: z.enum(["headline", "subheadline", "label", "badge", "legal", "other"]),
  text: z.string().describe("exact text, character for character, in its original script"),
  language: z.string().describe("BCP-47 code, e.g. en, ja, ko, zh-Hant, th"),
  colour: z.string().describe("fill colour name and hex, e.g. yellow #f7f704"),
  strokeColour: z.string().describe('outline or shadow colour, or "none"'),
  fontStyle: z
    .string()
    .describe("e.g. heavy rounded sans, brush, serif; bold, italic, 3D, outlined"),
  size: z.enum(["small", "medium", "large", "huge"]),
  position: z.enum(["top", "upper_middle", "middle", "lower_middle", "bottom"]),
  region: Region,
});

const Element = z.strictObject({
  kind: z.enum(["character", "creature", "item", "logo", "badge", "ui_element", "effect", "other"]),
  what: z.string().describe("what it is, e.g. the knight hero, a golden chest"),
  position: z.string().describe("where, e.g. bottom-left, over the band's right end"),
  pose: z.string().describe('pose or angle, or "n/a" for objects'),
  colours: z.string().describe("main colours of the element"),
  scale: z.enum(["small", "medium", "large", "dominant"]),
  breaksFrame: z.boolean(),
  region: Region,
});

export function imageAnalysisSchema(taxonomy: Taxonomy) {
  const types = taxonomy.screenTypes.map((t) => t.id) as [string, ...string[]];
  return z.strictObject({
    imageRef: z.string().describe("the reference label given for this image, e.g. img1"),
    screenshot: z.strictObject({
      orientation: z
        .enum(["portrait", "landscape", "not_applicable"])
        .describe("orientation of the in-game capture itself; not_applicable when there is none"),
      screenType: z.enum(types),
      subtype: z.string().describe("a subtype from the taxonomy for the screen type, or empty"),
      description: z.string().describe("what the underlying in-game screen shows"),
      action: z.string().describe("what is happening, what the player is doing"),
      atmosphere: z.string().describe("the overall mood, e.g. tense, cheerful, epic, cosy"),
      mainColours: z.array(Colour).describe("2-5 dominant colours of the capture, most first"),
      captureAreaPercent: z
        .number()
        .describe("percent of the whole image area where the in-game capture is visible, 0-100"),
      framing: z.enum(["full_bleed", "framed", "tilted_device", "multiple", "none"]),
    }),
    marketingLayer: z.strictObject({
      present: z.boolean().describe("false when nothing was added on top of the capture"),
      coveragePercent: z
        .number()
        .describe("percent of the whole image covered by marketing additions, 0-100"),
      backgroundMasks: z.array(Mask),
      texts: z.array(TextBlock),
      elements: z.array(Element),
      mainColours: z.array(Colour).describe("2-4 dominant colours of the marketing layer"),
      relationToScreen: z.enum(["describes", "exaggerates", "unrelated", "none"]),
    }),
    headline: z.string().describe("the main marketing headline exactly as written, or empty"),
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
        orientation: z.enum(["portrait", "landscape", "not_applicable"]),
        marketingLayerPresent: z.boolean(),
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

type Box = { x: number; y: number; w: number; h: number };
const inRange = (n: number) => n >= 0 && n <= 100;
const inside = (r: Box) =>
  [r.x, r.y, r.w, r.h].every(inRange) && r.x + r.w <= 100.5 && r.y + r.h <= 100.5;
const hexOk = (h: string) => h === "unknown" || /^#[0-9a-fA-F]{6}$/.test(h);

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
  for (const i of images) {
    const s = i.screenshot;
    const m = i.marketingLayer;
    const t = taxonomy.screenTypes.find((x) => x.id === s.screenType);
    if (s.subtype && t?.subtypes.length && !t.subtypes.includes(s.subtype)) {
      problems.push(
        `${i.imageRef}: subtype "${s.subtype}" is not in the taxonomy for ${s.screenType}`,
      );
    }
    if (s.screenType === "other" && !i.notes.trim())
      problems.push(`${i.imageRef}: "other" needs a note`);
    if (!(i.confidence >= 0 && i.confidence <= 1))
      problems.push(`${i.imageRef}: confidence out of range`);
    const regions = [...m.backgroundMasks, ...m.texts, ...m.elements].map((x) => x.region);
    if (!regions.every(inside)) problems.push(`${i.imageRef}: region out of range`);
    if (!inRange(s.captureAreaPercent) || !inRange(m.coveragePercent))
      problems.push(`${i.imageRef}: percentage out of range`);
    const hexes = [
      ...s.mainColours.map((c) => c.hex),
      ...m.mainColours.map((c) => c.hex),
      ...m.backgroundMasks.map((b) => b.colourHex),
    ];
    if (!hexes.every(hexOk))
      problems.push(`${i.imageRef}: colours must be hex like #1f6fd0 or "unknown"`);
    if (!m.present && (m.texts.length || m.backgroundMasks.length || m.elements.length)) {
      problems.push(
        `${i.imageRef}: the marketing layer is marked absent but has texts, masks or elements`,
      );
    }
    if (
      !m.present &&
      (m.coveragePercent > 0 || m.mainColours.length || m.relationToScreen !== "none" || i.headline)
    ) {
      problems.push(
        `${i.imageRef}: with no marketing layer, coverage must be 0, layer colours empty, relation "none" and the headline empty`,
      );
    }
    if (m.present && !m.texts.length && !m.backgroundMasks.length && !m.elements.length) {
      problems.push(`${i.imageRef}: the marketing layer is marked present but lists nothing`);
    }
  }
  return problems;
}
