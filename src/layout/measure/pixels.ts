import sharp from "sharp";
import type { LayoutBox } from "../schema.ts";

/** A working copy of an image: long edge 1024 px, RGB and grey (0-255). */
export interface Pixels {
  w: number;
  h: number;
  rgb: Uint8Array;
  grey: Float32Array;
}

export const WORK_EDGE = 1024;

export async function loadPixels(bytes: Buffer, longEdge = WORK_EDGE): Promise<Pixels> {
  const { data, info } = await sharp(bytes)
    .resize({ width: longEdge, height: longEdge, fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const rgb = new Uint8Array(data.buffer, data.byteOffset, n * 3);
  const grey = new Float32Array(n);
  for (let i = 0; i < n; i++)
    grey[i] =
      0.299 * (rgb[i * 3] ?? 0) + 0.587 * (rgb[i * 3 + 1] ?? 0) + 0.114 * (rgb[i * 3 + 2] ?? 0);
  return { w: info.width, h: info.height, rgb, grey };
}

export const at = (p: Pixels, x: number, y: number): number =>
  p.grey[
    Math.min(p.h - 1, Math.max(0, Math.round(y))) * p.w +
      Math.min(p.w - 1, Math.max(0, Math.round(x)))
  ] ?? 0;

export function rgbAt(p: Pixels, x: number, y: number): [number, number, number] {
  const i =
    (Math.min(p.h - 1, Math.max(0, Math.round(y))) * p.w +
      Math.min(p.w - 1, Math.max(0, Math.round(x)))) *
    3;
  return [p.rgb[i] ?? 0, p.rgb[i + 1] ?? 0, p.rgb[i + 2] ?? 0];
}

/** A rotated rectangle in pixels: centre, half sizes, angle (radians, image coordinates). */
export interface Quad {
  cx: number;
  cy: number;
  hw: number;
  hh: number;
  a: number;
}

/** A layout box (percent, unrotated) and its tilt as a rotated rectangle in pixels. */
export function quadOf(p: Pixels, b: LayoutBox, tiltDeg: number): Quad {
  const w = (b.w / 100) * p.w;
  const h = (b.h / 100) * p.h;
  return {
    cx: (b.x / 100) * p.w + w / 2,
    cy: (b.y / 100) * p.h + h / 2,
    hw: w / 2,
    hh: h / 2,
    a: (tiltDeg * Math.PI) / 180,
  };
}

/** Image point of the rectangle's local point (u, v), measured from its centre. */
export function toImage(q: Quad, u: number, v: number): [number, number] {
  const c = Math.cos(q.a);
  const s = Math.sin(q.a);
  return [q.cx + u * c - v * s, q.cy + u * s + v * c];
}

/** True when an image point lies inside the rotated rectangle. */
export function inside(q: Quad, x: number, y: number): boolean {
  const c = Math.cos(q.a);
  const s = Math.sin(q.a);
  const dx = x - q.cx;
  const dy = y - q.cy;
  const u = dx * c + dy * s;
  const v = -dx * s + dy * c;
  return Math.abs(u) <= q.hw && Math.abs(v) <= q.hh;
}

export const hex = (c: readonly number[]) =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
