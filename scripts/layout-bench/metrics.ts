/** Scoring helpers of the layout benchmark (plan-layout-wireframes section 7, accuracy score). */
import type { ImageAnalysis } from "../../src/analysis/schema.ts";
import type { Layout, LayoutBox } from "../../src/layout/schema.ts";

export interface KeyElement {
  id: string;
  role: string;
  box: LayoutBox;
  tiltDeg: number;
  z: number;
  text: string | null;
  textEn: string | null;
  covers?: string[];
}

export interface AnswerKey {
  name: string;
  imageId: string;
  width: number;
  height: number;
  captures: number;
  marketingPresent: boolean;
  inGame: KeyElement[];
  marketing: KeyElement[];
  composition: {
    focal: { x: number; y: number; id: string };
    readingOrder: string[];
    overlaySharePercent: number;
  };
  measurements: {
    bands: {
      id: string;
      tiltDeg: number;
      top: { left: number; right: number } | null;
      bottom: { left: number; right: number } | null;
    }[];
    coveragePercent: number;
    headlineGlyphPercent: number | null;
    headlineContrast: number | null;
  };
}

type Box = { box: LayoutBox; tiltDeg: number };

/** Overlap over union of two (possibly tilted) boxes on a 200-step raster (image aspect kept). */
export function iou(a: Box, b: Box, aspect: number): number {
  const inside = (e: Box, x: number, y: number) => {
    const cx = e.box.x + e.box.w / 2;
    const cy = (e.box.y + e.box.h / 2) * aspect;
    const t = (e.tiltDeg * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    const u = dx * Math.cos(t) + dy * Math.sin(t);
    const v = -dx * Math.sin(t) + dy * Math.cos(t);
    return Math.abs(u) <= e.box.w / 2 && Math.abs(v) <= (e.box.h * aspect) / 2;
  };
  let i = 0;
  let u = 0;
  for (let y = 0.25; y < 100 * aspect; y += 0.5 * Math.max(1, aspect))
    for (let x = 0.25; x < 100; x += 0.5) {
      const A = inside(a, x, y);
      const B = inside(b, x, y);
      if (A && B) i++;
      if (A || B) u++;
    }
  return u ? i / u : 0;
}

export interface Match {
  key: KeyElement;
  got: Layout["inGame"][number] | Layout["marketing"][number];
  iou: number;
}

/** One-to-one matching of same-role elements, largest overlap first, overlap at least 0.25. */
export function matchLayer(
  key: readonly KeyElement[],
  got: readonly (Layout["inGame"][number] | Layout["marketing"][number])[],
  aspect: number,
): { matches: Match[]; f1: number } {
  const pairs: Match[] = [];
  for (const k of key)
    for (const g of got)
      if (k.role === g.role) pairs.push({ key: k, got: g, iou: iou(k, g, aspect) });
  pairs.sort((a, b) => b.iou - a.iou);
  const usedK = new Set<string>();
  const usedG = new Set<string>();
  const matches: Match[] = [];
  for (const p of pairs) {
    if (p.iou < 0.25 || usedK.has(p.key.id) || usedG.has(p.got.id)) continue;
    usedK.add(p.key.id);
    usedG.add(p.got.id);
    matches.push(p);
  }
  if (!key.length && !got.length) return { matches, f1: 1 };
  const prec = got.length ? matches.length / got.length : 0;
  const rec = key.length ? matches.length / key.length : 0;
  return { matches, f1: prec + rec ? (2 * prec * rec) / (prec + rec) : 0 };
}

/** Mean absolute difference of the four box edges, points. */
export function edgeError(a: LayoutBox, b: LayoutBox): number {
  return (
    (Math.abs(a.x - b.x) +
      Math.abs(a.y - b.y) +
      Math.abs(a.x + a.w - (b.x + b.w)) +
      Math.abs(a.y + a.h - (b.y + b.h))) /
    4
  );
}

/** Linear points: full at `good` or better, zero at `bad` or worse. */
export const lin = (err: number, good: number, bad: number) =>
  err <= good ? 1 : err >= bad ? 0 : (bad - err) / (bad - good);

function lev(a: string[], b: string[]): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0] as number;
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j] as number;
      d[j] = Math.min((d[j] as number) + 1, (d[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length] as number;
}

/** Character error rate of `got` against `key` (whitespace runs count as one space). */
export function cer(key: string, got: string): number {
  const n = (s: string) => [...s.replace(/\s+/g, " ").trim()];
  const k = n(key);
  return k.length ? lev(k, n(got)) / k.length : got.trim() ? 1 : 0;
}

/**
 * The text a layout element carries: its referenced marketing text, plus the other marketing
 * texts whose box centre lies inside it and that no other element references (a two-line logo).
 */
export function elementText(
  e: Layout["marketing"][number] | Layout["inGame"][number],
  layout: Layout,
  core: ImageAnalysis,
): string {
  if (e.text) return e.text;
  const texts = core.marketingLayer.texts;
  const refd = new Set(layout.marketing.map((m) => m.textRef).filter((r) => r !== null));
  const own = texts.filter((t, i) => {
    if (e.textRef === i) return true;
    if (refd.has(i)) return false;
    const cx = t.region.x + t.region.w / 2;
    const cy = t.region.y + t.region.h / 2;
    return cx >= e.box.x && cx <= e.box.x + e.box.w && cy >= e.box.y && cy <= e.box.y + e.box.h;
  });
  return e.textRef === null && !own.length ? "" : own.map((t) => t.text).join(" ");
}

/** A band's top or bottom edge from a box and tilt: y (percent) at x = 0 and x = 100. */
export function boxEdge(e: Box, side: "top" | "bottom", aspect: number) {
  const t = (e.tiltDeg * Math.PI) / 180;
  const cx = e.box.x + e.box.w / 2;
  const cy = (e.box.y + e.box.h / 2) * aspect;
  const v = ((side === "top" ? -1 : 1) * e.box.h * aspect) / 2;
  const px = cx - v * Math.sin(t);
  const py = cy + v * Math.cos(t);
  const at = (x: number) => (py + Math.tan(t) * (x - px)) / aspect;
  return { left: at(0), right: at(100) };
}
