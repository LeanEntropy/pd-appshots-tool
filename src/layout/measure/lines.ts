import { median, type Pixels, rgbAt } from "./pixels.ts";

/** A long straight colour edge across a band's width, and how uniform each side of it is. */
export interface Line {
  slope: number;
  /** y (pixels) where the line crosses the reference x. */
  yc: number;
  /** Share of sampled columns with a strong step on the line. */
  share: number;
  /** Share of the strip just above / below that is close to that strip's median colour. */
  above: number;
  below: number;
}

/** A candidate needs a strong step in this share of the columns. */
export const LINE_MIN_SHARE = 0.55;
const STRONG = 20;

const dist = (a: readonly number[], b: readonly number[]) =>
  Math.abs((a[0] ?? 0) - (b[0] ?? 0)) +
  Math.abs((a[1] ?? 0) - (b[1] ?? 0)) +
  Math.abs((a[2] ?? 0) - (b[2] ?? 0));

/** Colour step across rows y-1 / y+1 at column x (half the summed channel differences). */
function stepAt(p: Pixels, x: number, y: number): number {
  return dist(rgbAt(p, x, y - 1), rgbAt(p, x, y + 1)) / 2;
}

/** How uniform a strip of rows beside a line is (0-1): share near the strip's median colour. */
function uniform(p: Pixels, cols: number[], y: (x: number) => number, from: number, to: number) {
  const px: [number, number, number][] = [];
  for (const x of cols) for (let d = from; d <= to; d += 2) px.push(rgbAt(p, x, y(x) + d));
  if (!px.length) return 0;
  const med = [0, 1, 2].map((k) => median(px.map((c) => c[k] ?? 0)));
  return px.filter((c) => dist(c, med) <= 60).length / px.length;
}

/**
 * Every long straight edge between rows yLo and yHi (pixels, at x = xc) whose angle is within
 * 6 degrees of `angleDeg`: a small line search over angles and heights, strongest first after
 * dropping near-duplicates (within 1.2% of the image height).
 */
export function findLines(
  p: Pixels,
  x0: number,
  x1: number,
  yLo: number,
  yHi: number,
  angleDeg: number,
): Line[] {
  const cols: number[] = [];
  for (let x = Math.max(2, x0); x <= Math.min(p.w - 3, x1); x += 5) cols.push(Math.round(x));
  if (cols.length < 8) return [];
  const xc = (x0 + x1) / 2;
  const found: (Line & { score: number })[] = [];
  for (let a = angleDeg - 6; a <= angleDeg + 6; a += 0.5) {
    const slope = Math.tan((a * Math.PI) / 180);
    for (let yc = Math.max(2, yLo); yc <= Math.min(p.h - 3, yHi); yc += 1) {
      let strong = 0;
      let sum = 0;
      for (const x of cols) {
        const y = yc + slope * (x - xc);
        const g = Math.max(stepAt(p, x, y), stepAt(p, x, y + 1));
        sum += g;
        if (g >= STRONG) strong++;
      }
      const share = strong / cols.length;
      if (share >= LINE_MIN_SHARE)
        found.push({ slope, yc, share, score: sum / cols.length, above: 0, below: 0 });
    }
  }
  found.sort((u, v) => v.score - u.score);
  const kept: Line[] = [];
  for (const l of found) {
    if (kept.some((k) => Math.abs(k.yc - l.yc) < 0.012 * p.h)) continue;
    const y = (x: number) => l.yc + l.slope * (x - xc);
    const strip = Math.max(4, Math.round(0.012 * p.h));
    kept.push({
      ...l,
      above: uniform(p, cols, y, -strip - 3, -3),
      below: uniform(p, cols, y, 3, strip + 3),
    });
  }
  return kept.sort((u, v) => u.yc - v.yc);
}
