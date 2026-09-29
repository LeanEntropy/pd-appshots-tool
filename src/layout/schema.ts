import { z } from "zod";
import { IN_GAME_ROLES, MARKETING_ROLES, MAX_PER_LAYER } from "./vocab.ts";

/**
 * The layout part of a per-image answer (plan-layout-wireframes 2.2). Every field is required
 * ("none" is null), so the same JSON Schema works for Claude structured output.
 */
const Box = z.strictObject({
  x: z.number().describe("left edge, percent of image width 0-100"),
  y: z.number().describe("top edge, percent of image height 0-100"),
  w: z.number().describe("width, percent 0-100"),
  h: z.number().describe("height, percent 0-100"),
});

const common = {
  box: Box.describe("box of the unrotated element; a tilted one is rotated around its centre"),
  tiltDeg: z.number().describe("-45 to 45; 0 when level; negative = rising to the right"),
  z: z.number().int().describe("draw order within the layer, 0 = bottom"),
  textEn: z.string().nullable().describe("English meaning of the element's text, or null"),
  note: z.string().describe('at most 80 characters; required for "other"'),
};

const InGame = z.strictObject({
  id: z.string().describe("S1 to S8"),
  role: z.enum(IN_GAME_ROLES),
  ...common,
  capture: z
    .number()
    .int()
    .nullable()
    .describe("0-based index into screenshot.captures; null for full-screen art"),
  textRef: z.null().describe("always null in the in-game layer"),
  text: z.string().nullable().describe("in-game text worth reading, original script, or null"),
  covers: z.array(z.string()).describe("always empty in the in-game layer"),
});

const Marketing = z.strictObject({
  id: z.string().describe("M1 to M8"),
  role: z.enum(MARKETING_ROLES),
  ...common,
  capture: z.null().describe("always null in the marketing layer"),
  textRef: z
    .number()
    .int()
    .nullable()
    .describe("0-based index into marketingLayer.texts for its text, or null"),
  text: z
    .string()
    .nullable()
    .describe("logo or badge text not in marketingLayer.texts (textRef null), as drawn; else null"),
  covers: z.array(z.string()).describe("ids of the in-game elements this element hides"),
});

export const layoutSchema = z.strictObject({
  inGame: z.array(InGame).max(MAX_PER_LAYER),
  marketing: z.array(Marketing).max(MAX_PER_LAYER),
  composition: z.strictObject({
    focal: z.strictObject({
      x: z.number(),
      y: z.number(),
      id: z.string().describe("id of the element at the focal point"),
    }),
    readingOrder: z.array(z.string()).max(5).describe("up to 5 ids, first seen first"),
    overlaySharePercent: z.number().describe("percent of the image the marketing layer covers"),
    summary: z.string().describe("one sentence"),
  }),
});

export type Layout = z.infer<typeof layoutSchema>;
export type LayoutBox = z.infer<typeof Box>;
export type InGameElement = z.infer<typeof InGame>;
export type MarketingElement = z.infer<typeof Marketing>;
export type LayoutElement = InGameElement | MarketingElement;

/** The layout call's answer (its own step, apart from the main analysis). */
export const layoutAnswerSchema = z.strictObject({ layout: layoutSchema });
