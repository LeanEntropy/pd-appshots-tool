import type { ProjectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import type { ImageDb } from "../store/imagedb.ts";
import {
  type GreyReader,
  greyPixels,
  type PixelRegions,
  type PixelResult,
  pixelCheck,
  pixelKey,
  readPixelCheck,
} from "../store/pixel-diff.ts";
import { reshapedPair } from "./layer-crops.ts";
import type { ImageAnalysis } from "./schema.ts";

/** The anchor's analysed boxes the pixel check splits by: texts, bands, elements. */
export function anchorRegions(a: ImageAnalysis): PixelRegions {
  const m = a.marketingLayer;
  return {
    texts: m.texts.map((t) => t.region),
    masks: m.backgroundMasks.map((b) => b.region),
    elements: m.elements.map((e) => e.region),
  };
}

/** The cached pixel check of an image against an analysed anchor, or undefined (no compute). */
export function readPairPixel(
  paths: ProjectPaths,
  imageId: string,
  anchor: { imageId: string; final: ImageAnalysis },
): PixelResult | undefined {
  const key = pixelKey(paths, imageId, anchor.imageId, anchorRegions(anchor.final));
  return readPixelCheck(workspaceStorage(paths.workspace), key);
}

/** The pixel check of an image against an analysed anchor: cached, or computed and saved. */
export async function pairPixel(
  paths: ProjectPaths,
  db: Pick<ImageDb, "get" | "abs">,
  imageId: string,
  anchor: { imageId: string; final: ImageAnalysis },
  read: GreyReader = greyPixels,
): Promise<PixelResult | null> {
  const img = db.get(imageId);
  const anc = db.get(anchor.imageId);
  // Another shape (an App Store image against a Play anchor): no pixel-by-pixel check.
  if (!img || !anc || reshapedPair(img, anc)) return null;
  const regions = anchorRegions(anchor.final);
  return pixelCheck(
    workspaceStorage(paths.workspace),
    pixelKey(paths, imageId, anchor.imageId, regions),
    { imageId, anchorId: anc.id, imageFile: db.abs(img.file), anchorFile: db.abs(anc.file) },
    { width: img.width, height: img.height },
    regions,
    read,
  );
}
