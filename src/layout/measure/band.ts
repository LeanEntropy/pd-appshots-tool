import type { LayoutBox, MarketingElement } from "../schema.ts";
import { type EdgeFit, edgeOk, fitEdge } from "./edges.ts";
import { findLines, type Line } from "./lines.ts";
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

/** The top or bottom line of a model box as y(x), in pixels. */
function edgeLine(q: Quad, v: number) {
  const [px, py] = toImage(q, 0, v);
  const slope = Math.tan(q.a);
  return (x: number) => py + slope * (x - px);
}

/**
 * Band edges and tilt from the pixels, all bands of an image together, seeded by the model's
 * boxes: every long straight edge near the bands (within 6 degrees of the model's tilt, up to 8%
 * of the height beyond them) is a candidate. Top to bottom, each band takes as its top the
 * candidate nearest the model's top with a uniform strip below it (the band's colour), and as its
 * bottom the one nearest the model's bottom with a uniform strip above it; a line already used
 * as an upper band's top is not reused. Edges on the image border are not measured, and a
 * candidate more than 10% from the model's edge is never taken.
 */
export function measureBands(
  p: Pixels,
  bands: readonly MarketingElement[],
): Map<string, BandMeasure> {
  const out = new Map<string, BandMeasure>();
  const none: BandMeasure = { top: null, bottom: null, box: null, tiltDeg: null, colour: null };
  const order = [...bands].sort((a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2));
  let prevTop = Number.NEGATIVE_INFINITY;
  let prevBottom: EdgeFit | null = null;
  let prevModelBottom = Number.NEGATIVE_INFINITY;
  for (const e of order) {
    const q = quadOf(p, e.box, e.tiltDeg);
    const span = q.hw * Math.cos(q.a) * 0.9;
    const x0 = Math.max(0, q.cx - span);
    const x1 = Math.min(p.w, q.cx + span);
    const topM = edgeLine(q, -q.hh);
    const botM = edgeLine(q, q.hh);
    const border = 0.015 * p.h;
    const onBorder = (f: (x: number) => number) =>
      Math.min(f(x0), f(x1)) < border || Math.max(f(x0), f(x1)) > p.h - border;
    const lines = findLines(p, x0, x1, topM(q.cx) - 0.08 * p.h, botM(q.cx) + 0.08 * p.h, e.tiltDeg);
    const xc = (x0 + x1) / 2;
    const yOf = (l: Line) => (x: number) => l.yc + l.slope * (x - xc);
    const near = (ls: Line[], target: number) =>
      ls
        .filter((l) => Math.abs(yOf(l)(q.cx) - target) <= 0.1 * p.h)
        .sort((u, v) => Math.abs(yOf(u)(q.cx) - target) - Math.abs(yOf(v)(q.cx) - target))[0];
    const refine = (l: Line | undefined): EdgeFit | null => {
      if (!l) return null;
      const fit = fitEdge(p, x0, x1, yOf(l), 0.006 * p.h);
      return edgeOk(fit) ? fit : null;
    };
    const topLine = onBorder(topM)
      ? undefined
      : near(
          lines.filter((l) => l.below >= 0.5 && yOf(l)(q.cx) > prevTop + 0.008 * p.h),
          topM(q.cx),
        );
    const at = (f: EdgeFit) => f.y0 + f.slope * q.cx;
    // Bands the model drew touching or overlapping share a boundary: the band above's measured
    // bottom is this band's top (up to 15% from the model's top, a model that drew the two
    // bands on top of each other; otherwise 10% as for any edge).
    const own = refine(topLine);
    const touching = topM(q.cx) <= prevModelBottom + 0.01 * p.h;
    const shared =
      !onBorder(topM) &&
      prevBottom &&
      Math.abs(at(prevBottom) - topM(q.cx)) <= (touching ? 0.15 : 0.1) * p.h
        ? prevBottom
        : null;
    const gap = (f: EdgeFit | null) =>
      f ? Math.abs(at(f) - topM(q.cx)) : Number.POSITIVE_INFINITY;
    const top = gap(shared) < gap(own) ? shared : own;
    const yt = top ? at(top) : topM(q.cx);
    const botLine = onBorder(botM)
      ? undefined
      : near(
          lines.filter((l) => l.above >= 0.5 && yOf(l)(q.cx) > yt + 0.01 * p.h),
          botM(q.cx),
        );
    const bottom = refine(botLine);
    prevTop = yt;
    prevBottom = bottom;
    prevModelBottom = botM(q.cx);
    if (!top && !bottom) {
      out.set(e.id, none);
      continue;
    }
    const lead = (top ?? bottom) as EdgeFit;
    const a = Math.atan(lead.slope);
    const yb = bottom ? at(bottom) : botM(q.cx);
    const hh = (Math.max(1, yb - yt) * Math.cos(a)) / 2;
    const refined: Quad = { ...q, cy: (yt + yb) / 2, hh, a };
    const pct = (v: number, of: number) => r1((v / of) * 100);
    out.set(e.id, {
      top: top ? edgeOf(p, top) : null,
      bottom: bottom ? edgeOf(p, bottom) : null,
      box: { x: e.box.x, y: pct(refined.cy - hh, p.h), w: e.box.w, h: pct(2 * hh, p.h) },
      tiltDeg: r5((a * 180) / Math.PI),
      colour: quadColour(p, refined),
    });
  }
  return out;
}
