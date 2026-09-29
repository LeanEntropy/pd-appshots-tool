/**
 * Label placement for the wireframe panels, in panel pixels: inside the box when the text fits
 * and nothing drawn above it is in the way, else next to the box with a leader line, else in a
 * strip under the picture. Labels never overlap each other.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box in its own frame: centre, size and rotation (degrees) around the centre. */
export interface Frame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

export interface WireLabel {
  lines: string[];
  /** Top-left of the unrotated text block; it is rotated by `rot` around its centre. */
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  /** White backing so the text reads over other shapes. */
  chip: boolean;
  /** Leader line x1 y1 x2 y2 from the label to its box, or null. */
  lead: number[] | null;
}

export interface LabelJob {
  text: string;
  frame: Frame;
  /** Visible bounds of the box inside the picture. */
  bounds: Rect;
  /** Bounds of the shapes drawn above this one. */
  above: Rect[];
  /** A repeat of a role already labelled: labelled only when it fits inside its box. */
  optional?: boolean;
}

export const FONT = 11;
const LINE = 13;
const PAD = 3;

/** Approximate width of a string at FONT px (sans-serif). */
export function textWidth(s: string): number {
  let w = 0;
  for (const c of s) {
    if (/[　-鿿가-힯＀-￯]/.test(c)) w += 11;
    else if (/[MW@%]/.test(c)) w += 9.5;
    else if (/[A-Z0-9&#]/.test(c)) w += 7.4;
    else if (/[iljtf.,:;'!|“”‘’()-]/.test(c)) w += 3.4;
    else if (c === " ") w += 3.1;
    else w += 6.1;
  }
  return w;
}

/** Greedy word wrap to `maxW` px, at most `maxLines` lines (the last one ends with … if cut). */
export function wrap(text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  const words = text.split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let word = words[i] ?? "";
    while (textWidth(word) > maxW && word.length > 1) {
      let cut = word.length - 1;
      while (cut > 1 && textWidth(word.slice(0, cut)) > maxW) cut--;
      if (cur) lines.push(cur);
      lines.push(word.slice(0, cut));
      cur = "";
      word = word.slice(cut);
    }
    const next = cur ? `${cur} ${word}` : word;
    if (textWidth(next) <= maxW || !cur) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]}…`;
  while (textWidth(last) > maxW && last.length > 2) last = `${last.slice(0, -2)}…`;
  kept[maxLines - 1] = last;
  return kept;
}

const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const grow = (r: Rect, d: number): Rect => ({
  x: r.x - d,
  y: r.y - d,
  w: r.w + 2 * d,
  h: r.h + 2 * d,
});

/** Axis-aligned bounds of a w x h block centred at (cx, cy), rotated by `rot` degrees. */
function spin(cx: number, cy: number, w: number, h: number, rot: number): Rect {
  const a = (Math.abs(rot) * Math.PI) / 180;
  const bw = w * Math.cos(a) + h * Math.sin(a);
  const bh = w * Math.sin(a) + h * Math.cos(a);
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

function block(text: string, maxW: number, maxLines: number) {
  const lines = wrap(text, Math.max(20, maxW - 2 * PAD), maxLines);
  const w = Math.max(...lines.map(textWidth)) + 2 * PAD;
  return { lines, w, h: lines.length * LINE + 2 * PAD - 2 };
}

/** Point of rectangle `r` nearest to (x, y). */
const near = (r: Rect, x: number, y: number): [number, number] => [
  Math.min(r.x + r.w, Math.max(r.x, x)),
  Math.min(r.y + r.h, Math.max(r.y, y)),
];

function leader(label: Rect, box: Rect): number[] | null {
  const [bx, by] = near(box, label.x + label.w / 2, label.y + label.h / 2);
  const [lx, ly] = near(label, bx, by);
  return Math.hypot(bx - lx, by - ly) > 3 ? [lx, ly, bx, by] : null;
}

/** Places every label; returns them with the height of the strip needed under the picture. */
export function placeLabels(
  jobs: LabelJob[],
  img: { w: number; h: number },
): { labels: WireLabel[]; strip: number } {
  const taken: Rect[] = [];
  const labels: WireLabel[] = [];
  const inImg = (r: Rect) =>
    r.x >= 1 && r.y >= 1 && r.x + r.w <= img.w - 1 && r.y + r.h <= img.h - 1;
  const free = (r: Rect) => !taken.some((t) => hit(grow(r, 1), t));
  let strip = 0;
  for (const j of jobs) {
    if (!j.text) continue;
    const f = j.frame;
    const inside = block(j.text, Math.min(f.w, img.w), 3);
    const put = (l: WireLabel, bounds: Rect) => {
      labels.push(l);
      taken.push(bounds);
    };
    // 1. Inside, clear of the shapes drawn above it; offsets in the box's own (rotated) frame.
    // Text may overhang a thin box by a few pixels (a one-line subline).
    const whole = j.text.split(" ").every((w) => textWidth(w) <= Math.min(f.w, img.w) - 2 * PAD);
    const fits = whole && inside.w <= f.w && inside.h <= f.h + 4;
    const dx = (f.w - inside.w) / 2 - 2;
    const dy = (f.h - inside.h) / 2 - 2;
    const spots: [number, number][] = [
      [0, 0],
      [-dx, -dy],
      [0, -dy],
      [-dx, dy],
      [dx, -dy],
      [dx, dy],
      [0, dy],
    ];
    const a = (f.rot * Math.PI) / 180;
    const at = (u: number, v: number, chip: boolean, shapes: Rect[]) => {
      const cx = f.cx + u * Math.cos(a) - v * Math.sin(a);
      const cy = f.cy + u * Math.sin(a) + v * Math.cos(a);
      const r = spin(cx, cy, inside.w, inside.h, f.rot);
      if (!inImg(r) || !free(r) || shapes.some((s) => hit(r, s))) return false;
      const l = {
        lines: inside.lines,
        x: cx - inside.w / 2,
        y: cy - inside.h / 2,
        w: inside.w,
        h: inside.h,
      };
      put({ ...l, rot: f.rot, chip, lead: null }, r);
      return true;
    };
    if (fits && spots.some(([u, v]) => at(u, v, false, j.above))) continue;
    if (j.optional) continue;
    // 2. Next to the box, with a leader line.
    const out = block(j.text, 140, 3);
    const b = j.bounds;
    const cy = b.y + b.h / 2 - out.h / 2;
    const cands: [number, number][] = [
      [b.x, b.y + b.h + 4],
      [b.x, b.y - out.h - 4],
      [b.x + b.w + 4, cy],
      [b.x - out.w - 4, cy],
      [b.x + b.w - out.w, b.y + b.h + 4],
      [b.x + b.w - out.w, b.y - out.h - 4],
    ];
    const big = b.w * b.h > 0.5 * img.w * img.h;
    const side = cands
      .map(([x, y]) => ({ x: Math.min(img.w - out.w - 2, Math.max(2, x)), y, w: out.w, h: out.h }))
      .find((r) => inImg(r) && free(r) && (big || !hit(r, b)));
    if (side) {
      put(
        {
          lines: out.lines,
          x: side.x,
          y: side.y,
          w: out.w,
          h: out.h,
          rot: 0,
          chip: true,
          lead: leader(side, b),
        },
        side,
      );
      continue;
    }
    // 3. Inside on a white backing, over whatever is drawn above it.
    if (fits && spots.some(([u, v]) => at(u, v, true, []))) continue;
    // 4. The strip under the picture.
    const s = block(j.text, img.w - 8, 2);
    const r = { x: 4, y: img.h + 5 + strip, w: s.w, h: s.h };
    strip += s.h + 3;
    const [bx, by] = near(b, r.x + 10, img.h);
    put({ lines: s.lines, ...r, rot: 0, chip: true, lead: [r.x + 10, r.y, bx, by] }, r);
  }
  return { labels, strip: strip ? strip + 6 : 0 };
}
