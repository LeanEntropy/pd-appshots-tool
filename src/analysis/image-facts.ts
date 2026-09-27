import { getPalette } from "colorthief";
import type { ProjectPaths } from "../config/load.ts";
import { imageKey, pixelsKey } from "../library/layout.ts";
import { workspaceStorage } from "../storage/index.ts";
import type { ImageDb } from "../store/imagedb.ts";
import { hexFamily } from "./colours.ts";

export type ImageOrientation = "portrait" | "landscape" | "square";

/** Facts about the whole image, computed by code from its pixels (never by a model). */
export interface ImageFacts {
  version: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
  orientation: ImageOrientation;
  /** Width / height, e.g. 0.5625. */
  aspectRatio: number;
  /** Nearest common ratio, e.g. "9:16", or the exact reduced ratio. */
  ratio: string;
  /** Dominant colours of the whole image (colorthief), most first, with their share. */
  dominantColours: { hex: string; share: number; family: string | null }[];
}

export const IMAGE_FACTS_VERSION = "image-facts.v2";

/** Within 2% of equal sides counts as square. */
export function orientationOf(width: number, height: number): ImageOrientation {
  if (!width || !height) return "square";
  const r = width / height;
  if (Math.abs(r - 1) <= 0.02) return "square";
  return r > 1 ? "landscape" : "portrait";
}

const COMMON: [number, number][] = [
  [9, 16],
  [9, 19.5],
  [9, 20],
  [9, 18],
  [2, 3],
  [3, 4],
  [1, 1],
  [4, 3],
  [3, 2],
  [16, 9],
  [18, 9],
  [19.5, 9],
  [20, 9],
];

export function ratioLabel(width: number, height: number): string {
  if (!width || !height) return "unknown";
  const r = width / height;
  const near = COMMON.find(([a, b]) => Math.abs(a / b - r) / r <= 0.015);
  if (near) return `${near[0]}:${near[1]}`;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(width, height);
  return `${width / g}:${height / g}`;
}

/**
 * Computed once per image and cached: images/facts/<id>.json in a project that has not moved
 * to the shared library yet, library images/pixels/<id>.<version>.json afterwards.
 */
export async function imageFacts(
  paths: ProjectPaths,
  db: ImageDb,
  imageId: string,
): Promise<ImageFacts | null> {
  const storage = workspaceStorage(paths.workspace);
  const cache = pixelsKey(paths, imageId, IMAGE_FACTS_VERSION);
  const cached = storage.getJson(cache) as ImageFacts | undefined;
  if (cached?.version === IMAGE_FACTS_VERSION) return cached;
  const rec = db.get(imageId);
  if (!rec) return null;
  // Colours are measured on the 240 px thumbnail (same palette, about 20 times faster).
  // Read as bytes, so no file handle stays open (Windows cannot move or remove open files).
  const src =
    storage.getBytes(imageKey(paths, rec.thumb)) ?? storage.getBytes(imageKey(paths, rec.file));
  const palette = src ? ((await getPalette(src, { colorCount: 6 }).catch(() => null)) ?? []) : [];
  const total = palette.reduce((n, c) => n + c.population, 0) || 1;
  const facts: ImageFacts = {
    version: IMAGE_FACTS_VERSION,
    width: rec.width,
    height: rec.height,
    format: rec.format,
    bytes: rec.bytes,
    orientation: orientationOf(rec.width, rec.height),
    aspectRatio: Math.round((rec.width / rec.height) * 10000) / 10000,
    ratio: ratioLabel(rec.width, rec.height),
    dominantColours: palette
      .map((c) => ({
        hex: c.hex(),
        share: Math.round((c.population / total) * 100) / 100,
        family: hexFamily(c.hex()),
      }))
      .filter((c) => c.share >= 0.01)
      .sort((a, b) => b.share - a.share),
  };
  storage.putJson(cache, facts);
  return facts;
}
