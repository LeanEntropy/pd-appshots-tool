import { median, type Pixels, rgbAt } from "./pixels.ts";

/** A straight edge fitted to pixels: y = y0 + slope * x (pixels), with its quality. */
export interface EdgeFit {
  slope: number;
  y0: number;
  /** Share of sampled columns on the line (after outlier rejection). */
  share: number;
  /** Root-mean-square distance of those columns from the line, pixels. */
  rms: number;
  /** Mean edge strength (colour step, 0-382) on the line. */
  strength: number;
}

/** Quality rule: below it no measured value is saved (the model's value stays, "estimated"). */
export const EDGE_QUALITY = { minShare: 0.6, maxRms: 4, minStrength: 15 } as const;

export const edgeOk = (f: EdgeFit | null): f is EdgeFit =>
  !!f &&
  f.share >= EDGE_QUALITY.minShare &&
  f.rms <= EDGE_QUALITY.maxRms &&
  f.strength >= EDGE_QUALITY.minStrength;

/**
 * Colour step across a point (vertical: the rows above and below; else the columns left and
 * right), averaged over three neighbours: its size (half the summed channel differences) and a
 * signature (the channel that changes most, and in which direction), so one straight edge
 * between two colours keeps one signature even when both have the same brightness.
 */
function step(p: Pixels, x: number, y: number, vertical: boolean): { mag: number; sig: number } {
  const d = [0, 0, 0];
  for (let k = -1; k <= 1; k++) {
    const [ax, ay, bx, by] = vertical ? [x + k, y - 1, x + k, y + 1] : [x - 1, y + k, x + 1, y + k];
    const a = rgbAt(p, ax, ay);
    const b = rgbAt(p, bx, by);
    for (let c = 0; c < 3; c++) d[c] = (d[c] ?? 0) + ((b[c] ?? 0) - (a[c] ?? 0)) / 3;
  }
  const abs = d.map(Math.abs);
  const top = abs.indexOf(Math.max(...abs));
  return { mag: abs.reduce((s, v) => s + v, 0) / 2, sig: top * 2 + ((d[top] ?? 0) > 0 ? 1 : 0) };
}

function lsq(pts: [number, number][]): { slope: number; y0: number } {
  const n = pts.length;
  const mx = pts.reduce((a, q) => a + q[0], 0) / n;
  const my = pts.reduce((a, q) => a + q[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, y0: my - slope * mx };
}

/**
 * The strongest near-horizontal edge along [x0, x1] within `win` pixels of the expected line:
 * per column the row with the largest colour step, the columns of the dominant signature, then
 * a straight-line fit with outlier rejection. Null when too few columns are usable.
 */
export function fitEdge(
  p: Pixels,
  x0: number,
  x1: number,
  expect: (x: number) => number,
  win: number,
): EdgeFit | null {
  const cols: { x: number; y: number; g: number; sig: number }[] = [];
  const a = Math.max(2, Math.ceil(x0));
  const b = Math.min(p.w - 3, Math.floor(x1));
  for (let x = a; x <= b; x += 3) {
    const e = expect(x);
    let best = { y: -1, g: 0, sig: 0 };
    const y1 = Math.min(p.h - 2, Math.round(e + win));
    for (let y = Math.max(1, Math.round(e - win)); y <= y1; y++) {
      const s = step(p, x, y, true);
      if (s.mag > best.g) best = { y, g: s.mag, sig: s.sig };
    }
    if (best.y >= 0) cols.push({ x, ...best });
  }
  if (cols.length < 8) return null;
  // Keep the dominant signature (one band edge is one colour change).
  const counts = new Map<number, number>();
  for (const c of cols) counts.set(c.sig, (counts.get(c.sig) ?? 0) + 1);
  const sig = [...counts].sort((u, v) => v[1] - u[1])[0]?.[0];
  let pts = cols.filter((c) => c.sig === sig);
  const total = cols.length;
  if (pts.length < 6) return null;
  let fit = lsq(pts.map((c) => [c.x, c.y]));
  for (let i = 0; i < 4 && pts.length >= 6; i++) {
    const res = pts.map((c) => Math.abs(c.y - (fit.y0 + fit.slope * c.x)));
    const cut = Math.max(2, 2.5 * median(res));
    const kept = pts.filter((_, j) => (res[j] ?? 0) <= cut);
    if (kept.length === pts.length || kept.length < 6) break;
    pts = kept;
    fit = lsq(pts.map((c) => [c.x, c.y]));
  }
  if (pts.length < 6) return null;
  const res = pts.map((c) => c.y - (fit.y0 + fit.slope * c.x));
  return {
    ...fit,
    share: pts.length / total,
    rms: Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length),
    strength: pts.reduce((s, c) => s + c.g, 0) / pts.length,
  };
}

/** The strongest straight edge along one side of an axis-aligned box, within `win` pixels. */
export function snapLine(
  p: Pixels,
  horizontal: boolean,
  pos: number,
  from: number,
  to: number,
  win: number,
): { pos: number; strength: number; contrast: number } | null {
  const profile: { pos: number; g: number }[] = [];
  const lim = horizontal ? p.h : p.w;
  const end = Math.min((horizontal ? p.w : p.h) - 1, Math.round(to));
  for (
    let q = Math.max(1, Math.round(pos - win));
    q <= Math.min(lim - 2, Math.round(pos + win));
    q++
  ) {
    let s = 0;
    let n = 0;
    for (let t = Math.max(0, Math.round(from)); t <= end; t += 2) {
      s += horizontal ? step(p, t, q, true).mag : step(p, q, t, false).mag;
      n++;
    }
    profile.push({ pos: q, g: n ? s / n : 0 });
  }
  if (profile.length < 3) return null;
  const top = profile.reduce((a, b) => (b.g > a.g ? b : a));
  const mid = median(profile.map((x) => x.g));
  return { pos: top.pos, strength: top.g, contrast: mid ? top.g / mid : top.g };
}
