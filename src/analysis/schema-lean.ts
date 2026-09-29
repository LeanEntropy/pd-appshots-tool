import { z } from "zod";
import type { Taxonomy } from "../config/load.ts";
import { type ImageAnalysis, imageAnalysisSchema } from "./schema.ts";

/**
 * The lean answer the model writes (LEAN_SCHEMA_VERSION): today's answer without capture
 * descriptions, element scale, "breaks the frame", confidence and the capture share.
 */
export function leanImageSchema(taxonomy: Taxonomy) {
  const full = imageAnalysisSchema(taxonomy);
  const s = full.shape.screenshot;
  const m = full.shape.marketingLayer;
  return full.omit({ confidence: true }).extend({
    screenshot: s.omit({ captureAreaPercent: true }).extend({
      captures: z
        .array(s.shape.captures.element.omit({ description: true }))
        .describe("every in-game capture in the image, largest first; empty for pure art"),
    }),
    marketingLayer: m.extend({
      elements: z.array(m.shape.elements.element.omit({ scale: true, breaksFrame: true })),
    }),
  });
}

export function leanDeckSchema(taxonomy: Taxonomy) {
  return z.strictObject({ images: z.array(leanImageSchema(taxonomy)) });
}

/** The captures' share of the image, added up by code (capped at 100). */
export function captureShare(captures: readonly { areaPercent: number }[]): number {
  const sum = captures.reduce((a, c) => a + c.areaPercent, 0);
  return Math.round(Math.min(100, Math.max(0, sum)) * 10) / 10;
}

/**
 * A lean reading in the record shape: the capture share is computed by code; the fields the
 * lean answer leaves out stay absent. A full (v3) reading passes through unchanged.
 */
export function expandLean(a: ImageAnalysis): ImageAnalysis {
  const s = a.screenshot as ImageAnalysis["screenshot"] & { captureAreaPercent?: number };
  if (typeof s.captureAreaPercent === "number") return a;
  return { ...a, screenshot: { ...s, captureAreaPercent: captureShare(s.captures) } };
}
