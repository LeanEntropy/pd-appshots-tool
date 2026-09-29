import type { LayoutBox, MarketingElement } from "../schema.ts";
import { type EdgeFit, edgeOk, fitEdge } from "./edges.ts";
import { hex, inside, median, type Pixels, type Quad, quadOf, rgbAt, toImage } from "./pixels.ts";

/** A measured straight edge: its height (percent) where it meets the left and right border. */
export interface EdgeMeasure {
  left: number;
  right: number;
  angleDeg: number;
  quality: { share: number; rms: number; strength: number };
}

export interface BandMeasure {
  top: EdgeMeasure | null;
  bottom: EdgeMeasure | null;
  /** Refined box and tilt (unrotated box, tilt of the top edge), when an edge passed. */
  box: LayoutBox | null;
  tiltDeg: number | null;
  colour: string | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r5 = (n: number) => Math.round(n * 2) / 2;

function edgeOf(p: Pixels, f: EdgeFit): EdgeMeasure {
  return {
    left: r1((f.y0 / p.h) * 100),
    right: r1(((f.y0 + f.slope * p.w) / p.h) * 100),
    angleDeg: r5((Math.atan(f.slope) * 180) / Math.PI),
    quality: { share: r1(f.share * 100) / 100, rms: r1(f.rms), strength: r1(f.strength) },
  };
}

/** Median colour inside a rotated rectangle (sampled every 3 pixels). */
export function quadColour(p: Pixels, q: Quad): string | null {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const ext = Math.hypot(q.hw, q.hh);
  for (let y = Math.max(0, q.cy - ext); y < Math.min(p.h, q.cy + ext); y += 3)
    for (let x = Math.max(0, q.cx - ext); x < Math.min(p.w, q.cx + ext); x += 3) {
      if (!inside(q, x, y)) continue;
      const c = rgbAt(p, x, y);
      r.push(c[0]);
      g.push(c[1]);
      b.push(c[2]);
    }
  return r.length ? hex([median(r), median(g), median(b)]) : null;
}

/**
 * Band edges and tilt from the pixels, seeded by the model's box: the top and bottom edge are
 * searched within 3.5% of the image height of where the model put them (an edge on the image
 * border is not measured). The refined band keeps the model's horizontal extent.
 */
export function measureBand(p: Pixels, e: MarketingElement): BandMeasure {
  const q = quadOf(p, e.box, e.tiltDeg);
  const slope = Math.tan(q.a);
  const span = q.hw * Math.cos(q.a) * 0.9;
  const x0 = Math.max(0, q.cx - span);
  const x1 = Math.min(p.w, q.cx + span);
  const win = 0.035 * p.h;
  const line = (v: number) => {
    const [px, py] = toImage(q, 0, v);
    return (x: number) => py + slope * (x - px);
  };
  const measure = (v: number): EdgeFit | null => {
    const f = line(v);
    const edge = 0.015 * p.h;
    if (f(x0) < edge || f(x1) < edge || f(x0) > p.h - edge || f(x1) > p.h - edge) return null;
    const fit = fitEdge(p, x0, x1, f, win);
    return edgeOk(fit) ? fit : null;
  };
  const top = measure(-q.hh);
  const bottom = measure(q.hh);
  if (!top && !bottom) return { top: null, bottom: null, box: null, tiltDeg: null, colour: null };
  const at = (f: EdgeFit) => f.y0 + f.slope * q.cx;
  const lead = (top ?? bottom) as EdgeFit;
  const a = Math.atan(lead.slope);
  const yt = top ? at(top) : line(-q.hh)(q.cx);
  const yb = bottom ? at(bottom) : line(q.hh)(q.cx);
  const hh = (Math.max(1, yb - yt) * Math.cos(a)) / 2;
  const refined: Quad = { ...q, cy: (yt + yb) / 2, hh, a };
  const pct = (v: number, of: number) => r1((v / of) * 100);
  return {
    top: top ? edgeOf(p, top) : null,
    bottom: bottom ? edgeOf(p, bottom) : null,
    box: { x: e.box.x, y: pct(refined.cy - hh, p.h), w: e.box.w, h: pct(2 * hh, p.h) },
    tiltDeg: r5((a * 180) / Math.PI),
    colour: quadColour(p, refined),
  };
}
