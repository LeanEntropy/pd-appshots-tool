import sharp from "sharp";
import type { ProjectPaths } from "../config/load.ts";
import { libraryKey, projectKey, type Storage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";
import { hamming } from "./identity.ts";
import { areasOf } from "./pixel-areas.ts";

/**
 * The pixel check of near-identical pictures across countries (plan-analysis-speed item 8), code
 * only: a country image and its candidate anchor (same shape within 3%, fingerprint within 14
 * bits) are both scaled to 320 px on the long edge and turned grey; a pixel counts as changed
 * above 40/255. The result is the share of changed pixels inside and outside the anchor's
 * analysed text and band boxes (each with a 3% margin), plus the changed areas as boxes.
 */
export const PIXEL_VERSION = "pixel-check.v1";
/** Candidate pairs: fingerprints at most this far apart. */
export const PIXEL_MAX_BITS = 14;
/** "Different picture" pairs are asked only when the fingerprint is this close. */
export const PIXEL_ASK_BITS = 10;
const EDGE = 320;
const LEVEL = 40;
const MARGIN = 3;

/** A box in percent of the image (x, y, width, height). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The anchor's analysed boxes, by what they hold. */
export interface PixelRegions {
  texts: Box[];
  masks: Box[];
  elements: Box[];
}

export interface PixelResult {
  version: typeof PIXEL_VERSION;
  imageId: string;
  anchorId: string;
  /** Hash of the anchor boxes the split used (a re-analysed anchor gets a new check). */
  regions: string;
  /** Shares of all pixels (0 to 1). */
  changed: number;
  inside: number;
  outside: number;
  /** Changed (in grey or colour) inside the band boxes but outside the text boxes (a recoloured band, a badge). */
  bandOnly: number;
  /** Changed inside the element boxes (characters or items on the layer). */
  elements: number;
  /** The changed areas, largest first (percent boxes). */
  areas: Box[];
}

export type PixelVerdict = "same-new-text" | "same-screen" | "different";

export interface PixelThresholds {
  sameMaxOutside: number;
  differentMinOutside: number;
}

/** Candidate pair: same shape within 3% and fingerprints within 14 bits. */
export function pixelCandidate(
  a: { phash: string; width: number; height: number },
  b: { phash: string; width: number; height: number },
): boolean {
  if (!a.phash || a.phash.length !== b.phash.length || !a.height || !b.height) return false;
  const ra = a.width / a.height;
  const rb = b.width / b.height;
  if (Math.abs(ra - rb) / Math.max(ra, rb) > 0.03) return false;
  return hamming(a.phash, b.phash) <= PIXEL_MAX_BITS;
}

/** The rule of the plan's table, with the thresholds of the Settings page. */
export function pixelVerdict(r: Pick<PixelResult, "outside">, t: PixelThresholds): PixelVerdict {
  if (r.outside <= t.sameMaxOutside) return "same-new-text";
  if (r.outside <= t.differentMinOutside) return "same-screen";
  return "different";
}

/** Is the pair asked? Same picture, new text: no; same screen: yes; different: when close. */
export function pixelAsks(v: PixelVerdict, bits: number): boolean {
  if (v === "same-new-text") return false;
  if (v === "same-screen") return true;
  return bits <= PIXEL_ASK_BITS;
}

export const regionsHash = (r: PixelRegions) => stableHash(r).slice(0, 16);

/** Where a pair's check is cached: in the shared library when the project uses one. */
export function pixelKey(
  paths: Pick<ProjectPaths, "projectId" | "library">,
  imageId: string,
  anchorId: string,
  regions: PixelRegions,
): string {
  const name = `${anchorId}-${regionsHash(regions)}.json`;
  return paths.library
    ? libraryKey("pixel-check", imageId, name)
    : projectKey(paths, "pixel-check", imageId, name);
}

/** The cached check of a pair, when it ran (never computes). */
export function readPixelCheck(storage: Storage, key: string): PixelResult | undefined {
  const r = storage.getJson(key) as PixelResult | undefined;
  return r?.version === PIXEL_VERSION ? r : undefined;
}

/** Pixels of an image file at exactly w × h (scaled to fill): grey, or RGB with `colour`. */
export type GreyReader = (file: string, w: number, h: number, colour?: boolean) => Promise<Buffer>;

export const greyPixels: GreyReader = (file, w, h, colour = false) => {
  const s = sharp(file).resize(w, h, { fit: "fill" });
  return (colour ? s.removeAlpha().toColourspace("srgb") : s.greyscale()).raw().toBuffer();
};

/** A reader that keeps each decoded image for the rest of one pass over many pairs. */
export function cachedGrey(read: GreyReader = greyPixels): GreyReader {
  const seen = new Map<string, Promise<Buffer>>();
  return (file, w, h, colour = false) => {
    const k = `${file}|${w}x${h}|${colour}`;
    let p = seen.get(k);
    if (!p) {
      p = read(file, w, h, colour);
      seen.set(k, p);
    }
    return p;
  };
}

/** The grid size the pair is compared at: 320 px on the country image's long edge. */
export function gridOf(width: number, height: number): { w: number; h: number } {
  if (width >= height) return { w: EDGE, h: Math.max(1, Math.round((EDGE * height) / width)) };
  return { w: Math.max(1, Math.round((EDGE * width) / height)), h: EDGE };
}

const usable = (b: Box) => b.w > 0 && b.h > 0 && !(b.w >= 99 && b.h >= 99);

/** Pixel mask (w × h) of the boxes, each grown by the margin. */
function maskOf(boxes: Box[], w: number, h: number, margin: number): Uint8Array {
  const m = new Uint8Array(w * h);
  for (const b of boxes.filter(usable)) {
    const x0 = Math.max(0, Math.floor(((b.x - margin) / 100) * w));
    const y0 = Math.max(0, Math.floor(((b.y - margin) / 100) * h));
    const x1 = Math.min(w - 1, Math.ceil(((b.x + b.w + margin) / 100) * w));
    const y1 = Math.min(h - 1, Math.ceil(((b.y + b.h + margin) / 100) * h));
    for (let y = y0; y <= y1; y++) m.fill(1, y * w + x0, y * w + x1 + 1);
  }
  return m;
}

const share = (n: number, total: number) => Math.round((1e5 * n) / total) / 1e5;

/**
 * Compares two grey pictures of the same size (pure). With their RGB copies, a band recoloured
 * at the same brightness (invisible in grey) still counts as a band change.
 */
export function comparePixels(
  image: Buffer,
  anchor: Buffer,
  w: number,
  h: number,
  regions: PixelRegions,
  colour?: { image: Buffer; anchor: Buffer },
): Omit<PixelResult, "version" | "imageId" | "anchorId" | "regions"> {
  const layer = maskOf([...regions.texts, ...regions.masks], w, h, MARGIN);
  // Without the margin: a badge right next to a text still counts as a band change.
  const text = maskOf(regions.texts, w, h, 0);
  const band = maskOf(regions.masks, w, h, MARGIN);
  const elements = maskOf(regions.elements, w, h, 0);
  const diff = new Uint8Array(w * h);
  let changed = 0;
  let inside = 0;
  let bandOnly = 0;
  let inElements = 0;
  const recoloured = (i: number) => {
    if (!colour) return false;
    for (let c = 0; c < 3; c++)
      if (Math.abs((colour.image[i * 3 + c] ?? 0) - (colour.anchor[i * 3 + c] ?? 0)) > LEVEL)
        return true;
    return false;
  };
  for (let i = 0; i < w * h; i++) {
    if (Math.abs((image[i] ?? 0) - (anchor[i] ?? 0)) <= LEVEL) {
      if (band[i] && !text[i] && recoloured(i)) bandOnly++;
      continue;
    }
    diff[i] = 1;
    changed++;
    if (layer[i]) inside++;
    if (band[i] && !text[i]) bandOnly++;
    if (elements[i]) inElements++;
  }
  const total = w * h;
  return {
    changed: share(changed, total),
    inside: share(inside, total),
    outside: share(changed - inside, total),
    bandOnly: share(bandOnly, total),
    elements: share(inElements, total),
    areas: areasOf(diff, w, h),
  };
}

/** Runs the check of one pair from the two image files (not cached). */
export async function pixelCheckFiles(
  pair: { imageId: string; anchorId: string; imageFile: string; anchorFile: string },
  size: { width: number; height: number },
  regions: PixelRegions,
  read: GreyReader = greyPixels,
): Promise<PixelResult> {
  const { w, h } = gridOf(size.width, size.height);
  const [a, b, ca, cb] = await Promise.all([
    read(pair.imageFile, w, h),
    read(pair.anchorFile, w, h),
    read(pair.imageFile, w, h, true),
    read(pair.anchorFile, w, h, true),
  ]);
  return {
    version: PIXEL_VERSION,
    imageId: pair.imageId,
    anchorId: pair.anchorId,
    regions: regionsHash(regions),
    ...comparePixels(a, b, w, h, regions, { image: ca, anchor: cb }),
  };
}

/** The cached check of a pair, computed and saved (write-once) when missing. */
export async function pixelCheck(
  storage: Storage,
  key: string,
  pair: { imageId: string; anchorId: string; imageFile: string; anchorFile: string },
  size: { width: number; height: number },
  regions: PixelRegions,
  read: GreyReader = greyPixels,
): Promise<PixelResult> {
  const done = readPixelCheck(storage, key);
  if (done) return done;
  const r = await pixelCheckFiles(pair, size, regions, read);
  storage.putJsonOnce(key, r);
  return r;
}
