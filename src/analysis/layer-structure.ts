import { categoryOf, isArtCategory, PROMO_BANNER } from "./categories.ts";
import type { ImageAnalysis } from "./schema.ts";

/**
 * How an image is built (user, 2026-10-30), by code from the saved analysis: a game screen or
 * art, and whether the store text is a separate layer on top or drawn into the artwork itself.
 * Each value is defined in categories.ts (LAYER_TAGS).
 */
export type LayerStructure =
  | "screenshot_layer"
  | "screenshot_only"
  | "art_layer"
  | "all_art"
  | "art_plain";

/** Product or hero art the model listed as a marketing element: the art itself is the advert. */
const DRAWN_IN = new Set(["character", "creature", "item"]);
const BIG = new Set(["large", "dominant"]);

export function layerStructure(a: ImageAnalysis): LayerStructure {
  const m = a.marketingLayer;
  const cat = categoryOf(a);
  if (!isArtCategory(cat)) return m.present ? "screenshot_layer" : "screenshot_only";
  if (!m.present) return "art_plain";
  // A band, ribbon, badge or panel behind the text is a separate layer on top of the art.
  if (m.backgroundMasks.length) return "art_layer";
  // A banner is one designed advert: its logo and slogan are part of the artwork.
  if (cat === PROMO_BANNER) return "all_art";
  const drawn = m.elements.some((e) => DRAWN_IN.has(e.kind) && BIG.has(e.scale ?? ""));
  return drawn ? "all_art" : "art_layer";
}
