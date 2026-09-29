import type { MarketingElement } from "../schema.ts";
import { median, type Pixels, quadOf, rgbAt, toImage } from "./pixels.ts";

/** WCAG relative luminance of an sRGB colour. */
function luminance(c: readonly number[]): number {
  const l = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (l[0] ?? 0) + 0.7152 * (l[1] ?? 0) + 0.0722 * (l[2] ?? 0);
}

const dist = (a: readonly number[], b: readonly number[]) =>
  Math.abs((a[0] ?? 0) - (b[0] ?? 0)) +
  Math.abs((a[1] ?? 0) - (b[1] ?? 0)) +
  Math.abs((a[2] ?? 0) - (b[2] ?? 0));

/**
 * EXPERIMENTAL (plan section 3): the headline's glyph height and contrast. Text pixels are the
 * ones far in colour from the box's median (the background); the tallest run of rows holding
 * text is the glyph height. Outlined, shadowed or gradient text often defeats this, so a result
 * whose text share looks implausible is dropped (null).
 */
export function headlineText(
  p: Pixels,
  e: MarketingElement,
): { glyphPercent: number; contrast: number } | null {
  const q = quadOf(p, e.box, e.tiltDeg);
  if (q.hh < 3 || q.hw < 3) return null;
  const samples: [number, number, number][][] = [];
  for (let v = -q.hh; v <= q.hh; v += 1) {
    const row: [number, number, number][] = [];
    for (let u = -q.hw; u <= q.hw; u += 2) {
      const [x, y] = toImage(q, u, v);
      row.push(rgbAt(p, x, y));
    }
    samples.push(row);
  }
  const flat = samples.flat();
  const bg = [0, 1, 2].map((k) => median(flat.map((c) => c[k] ?? 0)));
  const isText = (c: readonly number[]) => dist(c, bg) > 90;
  const share = flat.filter(isText).length / Math.max(1, flat.length);
  if (share < 0.05 || share > 0.6) return null;
  let best = 0;
  let run = 0;
  for (const row of samples) {
    run = row.filter(isText).length / row.length > 0.06 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  if (best < 4) return null;
  const text = flat.filter(isText);
  const fg = [0, 1, 2].map((k) => median(text.map((c) => c[k] ?? 0)));
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return {
    glyphPercent: Math.round((best / p.h) * 1000) / 10,
    contrast: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 10) / 10,
  };
}
