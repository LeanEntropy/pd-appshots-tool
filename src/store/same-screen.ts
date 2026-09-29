import type { ProjectPaths } from "../config/load.ts";
import { libraryKey, projectKey, type Storage } from "../storage/index.ts";
import { hamming } from "./identity.ts";
import { type GreyReader, greyPixels } from "./pixel-diff.ts";

/**
 * "The same screen uploaded twice" (code only, free): two images of one deck that show the same
 * screen and headline, often at two sizes (1080x1920 and 1242x2688, the taller one showing a bit
 * more of the game). The fingerprint and the orientation only pick candidates; the pixels
 * confirm. Both images are turned grey, 48 px on the short edge; the one with the wider shape is
 * cut into bands of 4 rows, and the bands with detail (not a flat colour) are laid over the other
 * image under one placement at a time: 25 scales (0.7 to 1.3, as a taller canvas may fit the game
 * by width or by height), 3 small sideways shifts and every height from top-aligned to
 * bottom-aligned (plus 10%). A band fits when its mean grey difference is at most 16 of 255. The
 * score is the share of detailed bands that fit under the best single placement: the same screen
 * keeps a large part of the picture in place (about half or more), while different screens with
 * the same background or band only fit a few scattered bands (at most about a tenth).
 */
export const SAME_SCREEN_VERSION = "same-screen.v1";
/** Candidates: fingerprints at most this far apart (another size moves the fingerprint more). */
export const SAME_SCREEN_MAX_BITS = 22;
/** Share of the detailed bands that must fit under one placement. */
export const SAME_SCREEN_SHARE = 0.35;
/** Enough for a pair that continues an ordered run of confirmed pairs (same distance, sizes). */
export const SAME_SCREEN_RUN_SHARE = 0.2;
const EDGE = 48;
const BAND = 4;
const MATCH = 16;
const DETAIL = 12;
const MIN_BANDS = 6;
const MAX_SCALE = 1.3;
const SCALES = Array.from({ length: 25 }, (_, i) => Math.round((0.7 + i * 0.025) * 1000) / 1000);
const SHIFTS = [-2, 0, 2];

export interface ScreenImage {
  id: string;
  phash: string;
  width: number;
  height: number;
}

export interface SameScreenResult {
  version: typeof SAME_SCREEN_VERSION;
  /** The pair, in id order. */
  a: string;
  b: string;
  /** Bands with detail, and how many of them fit under the best placement. */
  bands: number;
  matched: number;
  share: number;
  same: boolean;
}

const ratio = (x: { width: number; height: number }) => x.width / x.height;

/** Worth checking: the same file twice, or the same orientation and a close fingerprint. */
export function sameScreenCandidate(a: ScreenImage, b: ScreenImage): boolean {
  if (a.id === b.id) return true;
  if (!a.phash || a.phash.length !== b.phash.length || !a.height || !b.height) return false;
  if (ratio(a) > 1 !== ratio(b) > 1) return false;
  return hamming(a.phash, b.phash) <= SAME_SCREEN_MAX_BITS;
}

/** A grey picture: w × h bytes. */
export interface Grey {
  w: number;
  h: number;
  px: Uint8Array | Buffer;
}

/** Bilinear resample of a grey picture (pure). */
export function resample(src: Grey, w: number, h: number): Grey {
  const px = new Uint8Array(w * h);
  const sx = src.w / w;
  const sy = src.h / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(src.h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(src.h - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(src.w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(src.w - 1, x0 + 1);
      const wx = fx - x0;
      const at = (yy: number, xx: number) => src.px[yy * src.w + xx] ?? 0;
      const top = at(y0, x0) * (1 - wx) + at(y0, x1) * wx;
      const bottom = at(y1, x0) * (1 - wx) + at(y1, x1) * wx;
      px[y * w + x] = Math.round(top * (1 - wy) + bottom * wy);
    }
  }
  return { w, h, px };
}

function detailed(g: Grey, y0: number, y1: number): boolean {
  let sum = 0;
  let sq = 0;
  const n = g.w * (y1 - y0);
  for (let i = y0 * g.w; i < y1 * g.w; i++) {
    const v = g.px[i] ?? 0;
    sum += v;
    sq += v * v;
  }
  return Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) >= DETAIL;
}

/**
 * Compares two grey pictures (pure). `wide`: the image with the wider shape, `gw` px wide at scale
 * 1 (given larger, at scale 1.3 or more, so every scale is a downsample); `tall`: the other image,
 * `gw` px wide.
 */
export function compareScreens(
  wide: Grey,
  tall: Grey,
  gw: number,
): { bands: number; matched: number; share: number; same: boolean } {
  const wh = Math.round((wide.h * gw) / wide.w);
  const one = resample(wide, gw, wh);
  const rows: number[] = [];
  for (let i = 0; (i + 1) * BAND <= wh; i++)
    if (detailed(one, i * BAND, (i + 1) * BAND)) rows.push(i);
  let best = 0;
  for (const s of SCALES) {
    const w = Math.max(1, Math.round(gw * s));
    const h = Math.max(1, Math.round(wh * s));
    const a = s === 1 ? one : resample(wide, w, h);
    const centre = Math.floor((w - gw) / 2);
    const margin = Math.round(tall.h * 0.1);
    const lo = Math.min(0, tall.h - h) - margin;
    const hi = Math.max(0, tall.h - h) + margin;
    for (const dx of SHIFTS) {
      const off = centre + dx;
      const x0 = Math.max(0, -off);
      const x1 = Math.min(gw, w - off);
      if (x1 - x0 < gw * 0.7) continue;
      for (let ty = lo; ty <= hi; ty++) {
        let fit = 0;
        for (const [k, i] of rows.entries()) {
          // Not enough bands left to beat the best placement.
          if (fit + rows.length - k <= best) break;
          const y0 = Math.round(i * BAND * s);
          const y1 = Math.round((i + 1) * BAND * s);
          if (y1 <= y0 || y0 + ty < 0 || y1 + ty > tall.h) continue;
          const limit = MATCH * (y1 - y0) * (x1 - x0);
          let d = 0;
          for (let y = y0; y < y1 && d <= limit; y++) {
            const ra = y * w + off;
            const rb = (y + ty) * gw;
            for (let x = x0; x < x1; x++)
              d += Math.abs((a.px[ra + x] ?? 0) - (tall.px[rb + x] ?? 0));
          }
          if (d <= limit) fit++;
        }
        if (fit > best) best = fit;
      }
    }
  }
  const bands = rows.length;
  const share = bands ? Math.round((best / bands) * 1000) / 1000 : 0;
  return { bands, matched: best, share, same: bands >= MIN_BANDS && share >= SAME_SCREEN_SHARE };
}

/** Runs the check of one pair from the two image files (not cached). */
export async function sameScreenFiles(
  a: ScreenImage & { file: string },
  b: ScreenImage & { file: string },
  read: GreyReader = greyPixels,
): Promise<SameScreenResult> {
  const [x, y] = a.id < b.id ? [a, b] : [b, a];
  const base = { version: SAME_SCREEN_VERSION, a: x.id, b: y.id } as const;
  if (x.id === y.id) return { ...base, bands: 0, matched: 0, share: 1, same: true };
  // The wider shape is laid over the taller one; 48 px on the wider image's short edge.
  const [wide, tall] = ratio(x) >= ratio(y) ? [x, y] : [y, x];
  const gw = ratio(wide) > 1 ? Math.round(EDGE * ratio(wide)) : EDGE;
  const ww = Math.round(gw * MAX_SCALE);
  const wh = Math.max(1, Math.round(ww / ratio(wide)));
  const th = Math.max(1, Math.round(gw / ratio(tall)));
  const [pw, pt] = await Promise.all([read(wide.file, ww, wh), read(tall.file, gw, th)]);
  return { ...base, ...compareScreens({ w: ww, h: wh, px: pw }, { w: gw, h: th, px: pt }, gw) };
}

/**
 * How sure the check is that two images show the same screen: 2 = confirmed on its own, 1 =
 * likely (enough only inside an ordered run of confirmed pairs), 0 = no or not checked.
 */
export type SameLevel = 0 | 1 | 2;

export function sameLevel(r: SameScreenResult | undefined): SameLevel {
  if (!r) return 0;
  if (r.same) return 2;
  return r.bands >= MIN_BANDS && r.share >= SAME_SCREEN_RUN_SHARE ? 1 : 0;
}

/** Where a pair's check is cached: in the shared library when the project uses one. */
export function sameScreenKey(
  paths: Pick<ProjectPaths, "projectId" | "library">,
  a: string,
  b: string,
): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  const name = `${y}.${SAME_SCREEN_VERSION}.json`;
  return paths.library
    ? libraryKey("same-screen", x, name)
    : projectKey(paths, "same-screen", x, name);
}

/** The cached check of a pair, when it ran (never computes). */
export function readSameScreen(storage: Storage, key: string): SameScreenResult | undefined {
  const r = storage.getJson(key) as SameScreenResult | undefined;
  return r?.version === SAME_SCREEN_VERSION ? r : undefined;
}
