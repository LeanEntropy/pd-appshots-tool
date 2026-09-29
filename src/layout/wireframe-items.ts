import type { LayoutMeasure } from "./measure/index.ts";
import type { LayoutElement } from "./schema.ts";
import type { LayoutRole } from "./vocab.ts";
import type { Frame, Rect } from "./wireframe-place.ts";
import { aboutOf, type Reading, whoOf } from "./wireframe-words.ts";

/** Calm fills: greens for the screen underneath, warm tones for the marketing on top. */
export const FILL: Record<LayoutRole, string> = {
  "main-scene": "#d5e6da",
  hud: "#9fcbb3",
  "nav-bar": "#86bb9f",
  panel: "#b9d8c6",
  dialog: "#a9cbd9",
  character: "#6cae8a",
  "game-text": "#e3eee6",
  other: "#dde6e0",
  band: "#f5b567",
  headline: "#fff3dc",
  subline: "#fff8ea",
  logo: "#f0a0a0",
  badge: "#ffd766",
  "cut-out": "#e89150",
  frame: "#b98a60",
  callout: "#f7b7a3",
  backdrop: "#f3e2cc",
};

/**
 * Roles never drawn as a box: minor props, effects and in-game text belong in the layer's
 * words, not in the wireframe (user rule 2026-09-29: only what defines the composition).
 */
export const WORDS_ONLY: ReadonlySet<LayoutRole> = new Set(["other", "game-text"]);

/** A finite number rounded to 2 decimals and clamped; anything else (NaN, a string) gives `lo`. */
export const num = (v: unknown, lo: number, hi: number): number => {
  const x = typeof v === "number" && Number.isFinite(v) ? v : lo;
  return Math.round(Math.min(hi, Math.max(lo, x)) * 100) / 100;
};
export const roleOf = (r: unknown): LayoutRole =>
  typeof r === "string" && Object.hasOwn(FILL, r) ? (r as LayoutRole) : "other";
/** The elements of a saved layer; each gets a numeric box (a missing or broken one is empty). */
export const list = (xs: unknown): LayoutElement[] =>
  Array.isArray(xs)
    ? xs
        .filter((e): e is LayoutElement => !!e && typeof e === "object")
        .map((e) => {
          const b: Partial<Record<"x" | "y" | "w" | "h", unknown>> =
            e.box && typeof e.box === "object" ? e.box : {};
          const box = {
            x: num(b.x, -100, 200),
            y: num(b.y, -100, 200),
            w: num(b.w, 0, 200),
            h: num(b.h, 0, 200),
          };
          return { ...e, box };
        })
    : [];

function corners(f: Frame): number[] {
  const a = (f.rot * Math.PI) / 180;
  const out: number[] = [];
  for (const [u, v] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const du = (u * f.w) / 2;
    const dv = (v * f.h) / 2;
    out.push(
      f.cx + du * Math.cos(a) - dv * Math.sin(a),
      f.cy + du * Math.sin(a) + dv * Math.cos(a),
    );
  }
  return out;
}

function boundsOf(pts: number[], img: { w: number; h: number }): Rect {
  const xs = pts.filter((_, i) => i % 2 === 0);
  const ys = pts.filter((_, i) => i % 2 === 1);
  const x0 = Math.max(0, Math.min(...xs));
  const y0 = Math.max(0, Math.min(...ys));
  const x1 = Math.min(img.w, Math.max(...xs));
  const y1 = Math.min(img.h, Math.max(...ys));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** One layout element in panel pixels, with what the drawing needs. */
export interface Item {
  e: LayoutElement;
  role: LayoutRole;
  tilt: number;
  frame: Frame;
  /** The slanted polygon of a measured band, else empty. */
  pts: number[];
  bounds: Rect;
  dashed: boolean;
  /** Who a character or cut-out is, or "". */
  who: string;
  /** Its words (who, colours, expression, costume, pose), shown beside the wireframe. */
  about: string;
}

export function item(
  e: LayoutElement,
  img: { w: number; h: number },
  m: LayoutMeasure | null,
  est: boolean,
  reading?: Reading,
): Item {
  const role = roleOf(e.role);
  const b = e.box ?? { x: 0, y: 0, w: 0, h: 0 };
  const x = (num(b.x, -100, 200) / 100) * img.w;
  const y = (num(b.y, -100, 200) / 100) * img.h;
  const w = (num(b.w, 0, 200) / 100) * img.w;
  const h = (num(b.h, 0, 200) / 100) * img.h;
  const frame = { cx: x + w / 2, cy: y + h / 2, w, h, rot: num(e.tiltDeg, -45, 45) };
  let pts: number[] = [];
  // A band whose top edge the pixels measured: the true slanted polygon (vertical ends).
  const me = role === "band" ? m?.elements?.find((k) => k.id === e.id) : undefined;
  const top = me?.top;
  if (top && Number.isFinite(top.left) && Number.isFinite(top.right)) {
    const yAt = (edge: { left: number; right: number }, px: number) => {
      const l = num(edge.left, -50, 150);
      return ((l + ((num(edge.right, -50, 150) - l) * px) / img.w) / 100) * img.h;
    };
    const bot = me?.bottom;
    const yb = (px: number) => (bot ? yAt(bot, px) : y + h);
    pts = [x, yAt(top, x), x + w, yAt(top, x + w), x + w, yb(x + w), x, yb(x)].map((v) =>
      num(v, -2000, 4000),
    );
    frame.rot = num(top.angleDeg, -45, 45);
  }
  const bounds = boundsOf(pts.length ? pts : corners(frame), img);
  return {
    e,
    role,
    tilt: frame.rot,
    frame,
    pts,
    bounds,
    dashed: est,
    who: whoOf(e, role, reading),
    about: aboutOf(e, role, reading),
  };
}
