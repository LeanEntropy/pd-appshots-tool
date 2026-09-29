import sharp from "sharp";
import type { ProjectPaths } from "../config/load.ts";
import { libraryKey, projectKey, workspaceStorage } from "../storage/index.ts";
import type { ImageDb } from "../store/imagedb.ts";
import type { Box, PixelResult, PixelVerdict } from "../store/pixel-diff.ts";
import { sha256 } from "../util/hash.ts";
import { ALL_PARTS, type LayerParts } from "./layer-diff-schema.ts";
import type { ModelImage } from "./providers.ts";
import type { ImageAnalysis } from "./schema.ts";
/** What the text comparison uses of the pixel check (item 8): its result and verdict. */
export interface LayerPixel {
  result: PixelResult;
  verdict: PixelVerdict;
}

/** Two pictures of different shapes (more than 3% apart): an App Store image and its Play anchor. */
export function reshapedPair(
  a: { width: number; height: number } | undefined,
  b: { width: number; height: number } | undefined,
): boolean {
  if (!a?.height || !b?.height) return false;
  const ra = a.width / a.height;
  const rb = b.width / b.height;
  return Math.abs(ra - rb) / Math.max(ra, rb) > 0.03;
}

/** A share of changed pixels (0 to 1) above which a part of the layer counts as changed. */
const NOTICE = 0.0002;

/** What one comparison is asked, from the pixel check (everything without one). */
export function layerParts(p: LayerPixel | null | undefined): LayerParts {
  if (!p) return ALL_PARTS;
  return {
    band: p.result.bandOnly > NOTICE,
    elements: p.result.elements > NOTICE,
    screen: p.verdict !== "same-new-text",
    whole: p.verdict === "different",
  };
}

const PAD = 3;
/** Boxes closer than this (percent) share one crop; at most MAX_CROPS crops. */
const GAP = 6;
const MAX_CROPS = 3;
/** Crops keep their native resolution up to this long edge; nothing sent is ever larger. */
export const CROP_EDGE = 1024;

const union = (a: Box, b: Box): Box => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
};
const near = (a: Box, b: Box) =>
  a.x <= b.x + b.w + GAP &&
  b.x <= a.x + a.w + GAP &&
  a.y <= b.y + b.h + GAP &&
  b.y <= a.y + a.h + GAP;

/**
 * The crop boxes (percent): the anchor's text boxes and the areas the pixel check found changed,
 * padded; boxes near each other share a crop, and the closest crops merge until at most three
 * remain. Without texts or changes: the band boxes; without any: none (the whole image).
 */
export function cropBoxes(anchor: ImageAnalysis, pixel?: LayerPixel | null): Box[] {
  const m = anchor.marketingLayer;
  const ok = (r: Box) => r.w > 0 && r.h > 0;
  let src = [...m.texts.map((t) => t.region), ...(pixel?.result.areas ?? [])].filter(ok);
  if (!src.length) src = m.backgroundMasks.map((b) => b.region).filter(ok);
  let bs = src.map((r) => {
    const x = Math.max(0, r.x - PAD);
    const y = Math.max(0, r.y - PAD);
    return { x, y, w: Math.min(100, r.x + r.w + PAD) - x, h: Math.min(100, r.y + r.h + PAD) - y };
  });
  for (let merged = true; merged; ) {
    merged = false;
    for (let i = 0; i < bs.length && !merged; i++)
      for (let j = i + 1; j < bs.length && !merged; j++)
        if (near(bs[i] as Box, bs[j] as Box)) {
          bs = [...bs.filter((_, k) => k !== i && k !== j), union(bs[i] as Box, bs[j] as Box)];
          merged = true;
        }
  }
  while (bs.length > MAX_CROPS) {
    let best: [number, number, number] = [0, 1, Number.POSITIVE_INFINITY];
    for (let i = 0; i < bs.length; i++)
      for (let j = i + 1; j < bs.length; j++) {
        const u = union(bs[i] as Box, bs[j] as Box);
        if (u.w * u.h < best[2]) best = [i, j, u.w * u.h];
      }
    const [i, j] = best;
    bs = [...bs.filter((_, k) => k !== i && k !== j), union(bs[i] as Box, bs[j] as Box)];
  }
  return bs.filter((b) => b.w > 0 && b.h > 0).sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * The crops sent to the model (layer-crop.v2): up to three cut-outs of the COUNTRY image around
 * the anchor's texts and the changed areas, at native resolution up to 1024 px, then the whole
 * image small (long edge 384) so the model can tell a different screen, left out when the pixel
 * check showed the same screen. Without any box: a 1024 copy of the whole image.
 */
export async function layerCrops(
  paths: ProjectPaths,
  db: Pick<ImageDb, "get" | "abs">,
  imageId: string,
  anchor: ImageAnalysis,
  pixel?: LayerPixel | null,
  /** The same screen in another shape: the anchor's boxes do not fit, the whole image is sent. */
  reshaped = false,
): Promise<{ images: ModelImage[]; hashes: string[] }> {
  const rec = db.get(imageId);
  if (!rec) throw new Error(`Image ${imageId} is not in the project image database.`);
  const file = db.abs(rec.file);
  const meta = await sharp(file).metadata();
  const W = meta.width ?? rec.width;
  const H = meta.height ?? rec.height;
  const shots: Buffer[] = [];
  const fit = (edge: number) => ({
    width: edge,
    height: edge,
    fit: "inside" as const,
    withoutEnlargement: true,
  });
  const boxes = reshaped ? [] : cropBoxes(anchor, pixel);
  for (const box of boxes) {
    const left = Math.min(W - 1, Math.floor((box.x / 100) * W));
    const top = Math.min(H - 1, Math.floor((box.y / 100) * H));
    const width = Math.max(1, Math.min(W - left, Math.ceil((box.w / 100) * W)));
    const height = Math.max(1, Math.min(H - top, Math.ceil((box.h / 100) * H)));
    shots.push(
      await sharp(file)
        .extract({ left, top, width, height })
        .resize(fit(CROP_EDGE))
        .jpeg({ quality: 90 })
        .toBuffer(),
    );
  }
  if (!boxes.length)
    shots.push(await sharp(file).resize(fit(CROP_EDGE)).jpeg({ quality: 90 }).toBuffer());
  if (!reshaped && layerParts(pixel).whole)
    shots.push(await sharp(file).resize(fit(384)).jpeg({ quality: 85 }).toBuffer());
  const storage = workspaceStorage(paths.workspace);
  const images: ModelImage[] = [];
  const hashes: string[] = [];
  for (const bytes of shots) {
    const h = sha256(bytes);
    const name = `${imageId}-${h.slice(0, 16)}.jpg`;
    const k = paths.library
      ? libraryKey("images", "crops", name)
      : projectKey(paths, "images", "crops", name);
    storage.putBlob(k, bytes);
    hashes.push(h);
    images.push({
      mimeType: "image/jpeg",
      localPath: storage.localPath(k),
      bytes: () => storage.getBytes(k) ?? Buffer.alloc(0),
    });
  }
  return { images, hashes };
}
