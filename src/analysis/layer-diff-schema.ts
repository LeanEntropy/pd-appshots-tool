import { z } from "zod";
import { normaliseText } from "./compare.ts";
import type { ImageAnalysis } from "./schema.ts";

/**
 * The text-layer comparison (plan-reports 2.4): the same picture as an analysed anchor image in
 * another country, with its marketing layer read again. Every object is strict and every field
 * required, so the same JSON Schema works for Claude structured output and OpenAI strict mode.
 */
export const LAYER_DIFF_SCHEMA = "layer-diff-schema.v1";

/** How the crops sent to the model are made; part of every comparison key. */
export const CROP_VERSION = "layer-crop.v1";

const LayerText = z.strictObject({
  role: z.enum(["headline", "subheadline", "label", "badge", "legal", "other"]),
  anchorText: z.string().describe('the anchor text this one replaces, exactly; "" when new'),
  localText: z
    .string()
    .describe('the local text, character for character in its script; "" when removed'),
  backTranslation: z.string().describe("literal English back-translation of the local text"),
  language: z.string().describe("BCP-47 code of the local text, e.g. ja, ko, zh-Hant, en"),
  change: z.enum(["translated", "kept", "reworded", "new", "removed"]),
  notes: z.string(),
});

const GenreTerm = z.strictObject({
  term: z.string().describe("the exact local string as written on the image"),
  meaning: z.string().describe("its meaning in English"),
  kind: z.enum(["loanword", "native", "english", "other"]),
});

const Band = z.strictObject({
  change: z.enum(["none", "colour", "shape", "position", "several", "added", "removed"]),
  colourName: z.string(),
  colourHex: z.string().describe('"#rrggbb" or "unknown"'),
  notes: z.string(),
});

const Elements = z.strictObject({
  change: z.enum(["none", "swapped", "added", "removed"]),
  notes: z.string(),
});

const Diff = z.strictObject({
  sameScreen: z
    .boolean()
    .describe("false when the in-game screen under the layer differs from the anchor's"),
  sameScreenReason: z.string(),
  texts: z.array(LayerText),
  genreTerms: z.array(GenreTerm),
  band: Band,
  elements: Elements,
  headline: z.string().describe('the main local headline exactly as written, or ""'),
  wordingNotes: z.string(),
});

export type LayerDiff = z.infer<typeof Diff>;
export type LayerText = z.infer<typeof LayerText>;

export function layerDiffSchema(): z.ZodType<LayerDiff> {
  return Diff;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Checks an answer against the anchor it was compared with. Plain-language problems. */
export function layerDiffProblems(d: LayerDiff, anchor: ImageAnalysis): string[] {
  const out: string[] = [];
  if (d.band.colourHex !== "unknown" && !HEX.test(d.band.colourHex))
    out.push('the band colour must be hex like #1f6fd0 or "unknown"');
  if (!d.sameScreen) return out;
  const given = d.texts.map((t) => t.anchorText).filter((t) => t !== "");
  const seen = new Set<string>();
  for (const t of given) {
    if (seen.has(t)) out.push(`the anchor text "${t}" is listed more than once`);
    seen.add(t);
  }
  for (const t of anchor.marketingLayer.texts)
    if (!seen.has(t.text))
      out.push(`the anchor text "${t.text}" is missing: say what replaces it or mark it removed`);
  for (const t of d.texts) {
    if (t.change === "new" && t.anchorText) out.push(`a new text must have an empty anchorText`);
    if (t.change === "removed" && t.localText)
      out.push(`a removed text must have an empty localText`);
    if (t.change !== "new" && !t.anchorText)
      out.push(`the text "${t.localText}" has no anchorText: mark it new`);
  }
  if (d.headline) {
    const h = normaliseText(d.headline);
    if (!d.texts.some((t) => t.localText && normaliseText(t.localText) === h))
      out.push("the headline must be one of the local texts, exactly");
  }
  return out;
}

type AnchorText = ImageAnalysis["marketingLayer"]["texts"][number];
const DEFAULT_TEXT: AnchorText = {
  role: "headline",
  text: "",
  language: "",
  colour: "unknown",
  strokeColour: "none",
  fontStyle: "unknown",
  size: "large",
  position: "top",
  region: { x: 5, y: 2, w: 90, h: 10 },
};

/**
 * The country image's reading, assembled by code: the anchor's screenshot layer plus the new
 * marketing layer. Replaced texts keep the anchor text's role, region, colour, size and
 * position; removed ones are dropped; new ones take the headline's place and look.
 */
export function combinedReading(anchor: ImageAnalysis, diff: LayerDiff): ImageAnalysis {
  const m = anchor.marketingLayer;
  const look = m.texts.find((t) => t.role === "headline") ?? m.texts[0] ?? DEFAULT_TEXT;
  const used = new Set<number>();
  const texts: AnchorText[] = [];
  for (const t of diff.texts) {
    if (t.change === "removed" || !t.localText) continue;
    const i = t.anchorText
      ? m.texts.findIndex((a, k) => !used.has(k) && a.text === t.anchorText)
      : -1;
    if (i >= 0) used.add(i);
    const base = i >= 0 ? (m.texts[i] as AnchorText) : { ...look, role: t.role };
    texts.push({ ...base, text: t.localText, language: t.language || base.language });
  }
  let masks = m.backgroundMasks;
  const b = diff.band;
  const hex = HEX.test(b.colourHex) ? b.colourHex : "unknown";
  const first = masks[0];
  if (b.change === "removed") masks = [];
  else if (b.change === "added" && !first)
    masks = [
      {
        shape: "band",
        colourName: b.colourName || "unknown",
        colourHex: hex,
        location: "top",
        region: look.region,
      },
    ];
  else if ((b.change === "colour" || b.change === "several") && hex !== "unknown" && first)
    masks = [
      { ...first, colourName: b.colourName || first.colourName, colourHex: hex },
      ...masks.slice(1),
    ];
  const elements = diff.elements.change === "removed" ? [] : m.elements;
  const present = texts.length > 0 || masks.length > 0 || elements.length > 0;
  const named = diff.headline && texts.some((t) => t.text === diff.headline);
  const headline = !present
    ? ""
    : named
      ? diff.headline
      : (texts.find((t) => t.role === "headline")?.text ?? "");
  return {
    ...anchor,
    marketingLayer: present
      ? {
          ...m,
          present: true,
          coveragePercent: Math.max(1, m.coveragePercent),
          backgroundMasks: masks,
          texts,
          elements,
          relationToScreen: m.relationToScreen === "none" ? "describes" : m.relationToScreen,
        }
      : {
          present: false,
          coveragePercent: 0,
          backgroundMasks: [],
          texts: [],
          elements: [],
          mainColours: [],
          relationToScreen: "none",
        },
    headline,
  };
}

/** The task: the anchor's marketing layer as JSON, the country and what each image is. */
export function layerDiffTask(
  anchor: ImageAnalysis,
  market: { label: string; hl: string },
): string {
  const m = anchor.marketingLayer;
  const layer = {
    present: m.present,
    headline: anchor.headline,
    texts: m.texts.map((t) => ({
      role: t.role,
      text: t.text,
      language: t.language,
      position: t.position,
    })),
    masks: m.backgroundMasks.map((b) => ({
      shape: b.shape,
      colour: `${b.colourName} ${b.colourHex}`,
      location: b.location,
    })),
    elements: m.elements.map((e) => ({ kind: e.kind, what: e.what, position: e.position })),
    screen: anchor.screenshot.description,
  };
  return [
    `Compare the marketing layer of this store image from ${market.label} (store language ${market.hl}) with the anchor: the same picture in another country, analysed in full.`,
    "The images, in order: every image but the last is the marketing-layer area of the country image; the last is the whole country image, small.",
    `The anchor's marketing layer and screen (JSON):\n${JSON.stringify(layer)}`,
  ].join("\n\n");
}
