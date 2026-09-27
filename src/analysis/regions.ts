import type { ImageAnalysis } from "./schema.ts";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How far (percent points) a box may overshoot the image and still be trusted after clamping. */
const TOLERANCE = 10;

/** The "no usable region" box: passes the range check and carries no position. */
const NONE: Box = { x: 0, y: 0, w: 0, h: 0 };

/**
 * A region clamped into the image (0-100). Models often draw a box slightly past an edge; that
 * box is clamped. A nonsensical one (not a number, far outside, or empty after clamping) is
 * replaced by an empty box, so the text or element it belongs to is kept without a position.
 */
export function clampRegion(r: Box): Box {
  const vals = [r.x, r.y, r.w, r.h];
  if (!vals.every(Number.isFinite) || r.w < 0 || r.h < 0) return { ...NONE };
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  if (x0 < -TOLERANCE || y0 < -TOLERANCE || x1 > 100 + TOLERANCE || y1 > 100 + TOLERANCE)
    return { ...NONE };
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(100, x1);
  const cy1 = Math.min(100, y1);
  if (cx1 <= cx0 || cy1 <= cy0) return { ...NONE };
  return { x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 };
}

/**
 * Every region of a reading clamped into the image. A nonsensical box (texts, masks, elements
 * and captures alike) keeps its item but loses its position; the capture count stays intact, so
 * the composition checks still hold. Nothing downstream uses capture positions.
 */
export function clampRegions(a: ImageAnalysis): ImageAnalysis {
  const m = a.marketingLayer;
  const s = a.screenshot;
  return {
    ...a,
    marketingLayer: {
      ...m,
      backgroundMasks: m.backgroundMasks.map((b) => ({ ...b, region: clampRegion(b.region) })),
      texts: m.texts.map((t) => ({ ...t, region: clampRegion(t.region) })),
      elements: m.elements.map((e) => ({ ...e, region: clampRegion(e.region) })),
    },
    screenshot: {
      ...s,
      captures: s.captures.map((c) => ({ ...c, region: clampRegion(c.region) })),
    },
  };
}
