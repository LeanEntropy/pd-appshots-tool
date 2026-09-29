import sharp from "sharp";
import { hamming } from "../store/identity.ts";

/**
 * "Same picture apart from file compression" (plan-app-store 4, step 2), code only. Strict:
 * - the same pixel size (a scaled or reshaped image never qualifies);
 * - each channel within 24 of 255 levels on at least 99.99% of pixels;
 * - no cluster of changed pixels anywhere (a changed word or icon always fails): no 16×16 cell
 *   holds 8 or more changed pixels.
 * The perceptual hash only picks candidates to check (at most 12 bits apart).
 */
export const SAME_PICTURE = {
  noiseLevel: 24,
  maxChangedShare: 0.0001,
  cell: 16,
  cellMax: 8,
  candidateBits: 12,
} as const;

export interface RawImage {
  width: number;
  height: number;
  /** RGB, 3 bytes per pixel. */
  data: Uint8Array;
}

export interface PixelCompare {
  same: boolean;
  changedShare: number;
  meanDiff: number;
  /** Most changed pixels in one cell. */
  worstCell: number;
  reason: string;
}

export function comparePictures(a: RawImage, b: RawImage, t = SAME_PICTURE): PixelCompare {
  if (a.width !== b.width || a.height !== b.height)
    return { same: false, changedShare: 1, meanDiff: 255, worstCell: 0, reason: "other size" };
  const { width: w, height: h } = a;
  const cw = Math.ceil(w / t.cell);
  const cells = new Uint16Array(cw * Math.ceil(h / t.cell));
  let changed = 0;
  let sum = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      let max = 0;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs((a.data[i + c] ?? 0) - (b.data[i + c] ?? 0));
        sum += d;
        if (d > max) max = d;
      }
      if (max > t.noiseLevel) {
        changed++;
        const k = Math.floor(y / t.cell) * cw + Math.floor(x / t.cell);
        cells[k] = (cells[k] ?? 0) + 1;
      }
    }
  let worstCell = 0;
  for (const n of cells) if (n > worstCell) worstCell = n;
  const changedShare = changed / (w * h);
  const meanDiff = sum / (w * h * 3);
  const reason =
    changedShare > t.maxChangedShare
      ? "too many changed pixels"
      : worstCell >= t.cellMax
        ? "a cluster of changed pixels"
        : "";
  return { same: !reason, changedShare, meanDiff, worstCell, reason };
}

export async function rawOf(file: string | Buffer): Promise<RawImage> {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
}

export interface PictureFacts {
  id: string;
  phash: string;
  width: number;
  height: number;
}

/** Candidates worth the pixel check: same size, perceptual hashes close; closest first. */
export function twinCandidates<T extends PictureFacts>(img: PictureFacts, pool: readonly T[]): T[] {
  return pool
    .filter(
      (p) =>
        p.id !== img.id &&
        p.width === img.width &&
        p.height === img.height &&
        p.phash.length === img.phash.length &&
        hamming(p.phash, img.phash) <= SAME_PICTURE.candidateBits,
    )
    .sort((x, y) => hamming(x.phash, img.phash) - hamming(y.phash, img.phash));
}
