import type { LayoutBox } from "../schema.ts";
import { snapLine } from "./edges.ts";
import { at, type Pixels, rgbAt } from "./pixels.ts";

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Snap rule: an edge moves to the strongest straight edge within 3% if it clearly stands out. */
export const SNAP = { window: 0.03, minContrast: 2.5, minStrength: 8 } as const;

export type Side = "top" | "bottom" | "left" | "right";

/**
 * A level rectangular element (band, frame, dialog, panel, nav-bar) with each side snapped to
 * the strongest edge near it; sides without a clear edge keep the model's value.
 */
export function snapBox(p: Pixels, b: LayoutBox): { box: LayoutBox; snapped: Side[] } | null {
  let x0 = (b.x / 100) * p.w;
  let x1 = ((b.x + b.w) / 100) * p.w;
  let y0 = (b.y / 100) * p.h;
  let y1 = ((b.y + b.h) / 100) * p.h;
  const snapped: Side[] = [];
  const ok = (s: ReturnType<typeof snapLine>) =>
    !!s && s.contrast >= SNAP.minContrast && s.strength >= SNAP.minStrength;
  const wy = SNAP.window * p.h;
  const wx = SNAP.window * p.w;
  // Sides on the image border stay there.
  const sides: [Side, boolean, number, number, number, number][] = [
    ["top", true, y0, x0, x1, wy],
    ["bottom", true, y1, x0, x1, wy],
    ["left", false, x0, y0, y1, wx],
    ["right", false, x1, y0, y1, wx],
  ];
  const out: Record<Side, number> = { top: y0, bottom: y1, left: x0, right: x1 };
  let needed = 0;
  for (const [side, horizontal, pos, from, to, win] of sides) {
    const lim = horizontal ? p.h : p.w;
    if (pos < 0.01 * lim || pos > 0.99 * lim) continue;
    needed++;
    const s = snapLine(p, horizontal, pos, from, to, win);
    if (s && ok(s)) {
      out[side] = s.pos;
      snapped.push(side);
    }
  }
  // Measured only when every side off the image border found its edge (else: estimated).
  if (!snapped.length || snapped.length < needed) return null;
  ({ top: y0, bottom: y1, left: x0, right: x1 } = out);
  if (y1 <= y0 || x1 <= x0) return null;
  return {
    box: {
      x: r1((x0 / p.w) * 100),
      y: r1((y0 / p.h) * 100),
      w: r1(((x1 - x0) / p.w) * 100),
      h: r1(((y1 - y0) / p.h) * 100),
    },
    snapped,
  };
}

/** Uniform-colour margins around the whole image (a framed or inset capture), percent. */
export function insets(p: Pixels): Record<Side, number> {
  const uniform = (horizontal: boolean, i: number, ref: [number, number, number]) => {
    const n = horizontal ? p.w : p.h;
    let s = 0;
    let s2 = 0;
    let far = 0;
    let k = 0;
    for (let t = 0; t < n; t += 2) {
      const x = horizontal ? t : i;
      const y = horizontal ? i : t;
      const g = at(p, x, y);
      s += g;
      s2 += g * g;
      const c = rgbAt(p, x, y);
      if (Math.abs(c[0] - ref[0]) + Math.abs(c[1] - ref[1]) + Math.abs(c[2] - ref[2]) > 60) far++;
      k++;
    }
    const sd = Math.sqrt(Math.max(0, s2 / k - (s / k) ** 2));
    return sd < 10 && far / k < 0.05;
  };
  const march = (horizontal: boolean, fromEnd: boolean) => {
    const n = horizontal ? p.h : p.w;
    const edge = fromEnd ? n - 1 : 0;
    const ref = horizontal ? rgbAt(p, p.w / 2, edge) : rgbAt(p, edge, p.h / 2);
    let d = 0;
    while (d < n * 0.45 && uniform(horizontal, fromEnd ? n - 1 - d : d, ref)) d++;
    return r1((d / n) * 100);
  };
  return {
    top: march(true, false),
    bottom: march(true, true),
    left: march(false, false),
    right: march(false, true),
  };
}
