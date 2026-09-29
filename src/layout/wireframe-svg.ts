import type { LayoutMeasure } from "./measure/index.ts";
import { isMeasured } from "./measure/index.ts";
import type { Layout, LayoutElement } from "./schema.ts";
import { type LayoutRole, ROLE_LABEL } from "./vocab.ts";

/** Fixed colour per role: in-game roles cool and light, marketing roles warm and strong. */
const COLOUR: Record<LayoutRole, string> = {
  hud: "#7aa6c2",
  "nav-bar": "#5b8db0",
  "main-scene": "#a9c7b5",
  character: "#6fb38a",
  panel: "#8fa3d6",
  dialog: "#b39ddb",
  "game-text": "#90a4ae",
  other: "#b0bec5",
  band: "#f2a541",
  headline: "#e4572e",
  subline: "#f08a5d",
  logo: "#c2185b",
  badge: "#ffca3a",
  "cut-out": "#d1495b",
  frame: "#8d6e63",
  callout: "#ff7043",
  backdrop: "#bcaaa4",
};

/** One box of the wireframe, reduced to checked primitives (numbers finite and clamped). */
export interface WireShape {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation around the box centre, degrees; 0 when level. */
  rot: number;
  /** One of the fixed role colours (#rrggbb). */
  colour: string;
  fillOpacity: number;
  dashed: boolean;
  /** Short label drawn inside the box, or "" when the box is too small. Plain text. */
  label: string;
  /** Tooltip text. Plain text. */
  title: string;
}

/**
 * The combined wireframe of one image as data: what the page draws with DOM calls (never parsed
 * as markup). Coordinates are in the 100-wide viewBox; `viewH` follows the image's ratio.
 */
export interface Wireframe {
  width: number;
  height: number;
  viewH: number;
  shapes: WireShape[];
  focal: { x: number; y: number };
}

/** A finite number rounded to 2 decimals and clamped; anything else (NaN, a string) gives `lo`. */
const num = (v: unknown, lo: number, hi: number): number => {
  const x = typeof v === "number" && Number.isFinite(v) ? v : lo;
  return Math.round(Math.min(hi, Math.max(lo, x)) * 100) / 100;
};
/** Text from saved data, forced to a short plain string. */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const roleOf = (r: unknown): LayoutRole =>
  typeof r === "string" && Object.hasOwn(COLOUR, r) ? (r as LayoutRole) : "other";

function shape(e: LayoutElement, sy: number, marketing: boolean, estimated: boolean): WireShape {
  const role = roleOf(e.role);
  const box = e.box ?? { x: 0, y: 0, w: 0, h: 0 };
  const x = num(box.x, -100, 200);
  const y = num(num(box.y, -100, 200) * sy, -1000, 2000);
  const w = num(box.w, 0, 200);
  const h = num(num(box.h, 0, 200) * sy, 0, 2000);
  const id = str(e.id, 8);
  const textEn = str(e.textEn, 200);
  const head = `${id} ${ROLE_LABEL[role]}`;
  return {
    x,
    y,
    w,
    h,
    rot: num(e.tiltDeg, -90, 90),
    colour: COLOUR[role],
    fillOpacity: marketing ? 0.55 : 0.3,
    dashed: estimated,
    label: w > 14 && h > 3 ? head : "",
    title: `${head}${textEn ? `: ${textEn}` : ""}${estimated ? " (estimated)" : ""}`,
  };
}

/**
 * The combined wireframe of one image, drawn by code from its saved layout (plan 5.1): the
 * in-game layer below, the marketing layer on top, in draw order. Values the measuring tool did
 * not confirm are dashed and labelled "estimated". Width and height are the image's own ratio.
 * Saved layouts are read back unchecked, so every value is re-checked here.
 */
export function wireframe(
  layout: Layout,
  size: { width: number; height: number },
  measure: LayoutMeasure | null = null,
  px = 150,
): Wireframe {
  const ratio = size.height / size.width;
  const sy = Number.isFinite(ratio) && ratio > 0 ? Math.min(10, Math.max(0.1, ratio)) : 16 / 9;
  const list = (xs: unknown): LayoutElement[] =>
    Array.isArray(xs) ? xs.filter((e): e is LayoutElement => !!e && typeof e === "object") : [];
  const byZ = <T extends LayoutElement>(xs: T[]) =>
    [...xs].sort((a, b) => num(a.z, -1e6, 1e6) - num(b.z, -1e6, 1e6));
  const est = (e: LayoutElement) =>
    !!measure && (e.role === "band" || e.tiltDeg !== 0) && !isMeasured(measure, e.id);
  const focal: unknown = layout?.composition?.focal;
  const f = focal && typeof focal === "object" ? (focal as { x?: unknown; y?: unknown }) : {};
  const width = num(px, 16, 2000);
  return {
    width,
    height: Math.round(width * sy),
    viewH: num(100 * sy, 1, 1000),
    shapes: [
      ...byZ(list(layout?.inGame)).map((e) => shape(e, sy, false, false)),
      ...byZ(list(layout?.marketing)).map((e) => shape(e, sy, true, est(e))),
    ],
    focal: { x: num(f.x ?? 50, 0, 100), y: num(num(f.y ?? 50, 0, 100) * sy, 0, 1000) },
  };
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const r2 = (v: number) => Math.round(v * 100) / 100;

/** SVG markup of a wireframe made by wireframe() above (its values already checked); text escaped. */
function wireframeSvgOf(wf: Wireframe): string {
  const parts = wf.shapes.map((s) => {
    const rot = s.rot
      ? ` transform="rotate(${s.rot} ${r2(s.x + s.w / 2)} ${r2(s.y + s.h / 2)})"`
      : "";
    const dash = s.dashed ? ' stroke-dasharray="1.2 0.8"' : "";
    const text = s.label
      ? `<text x="${r2(s.x + 1)}" y="${r2(s.y + Math.min(s.h - 0.6, 3.2))}" font-size="2.6" fill="#1b1b1b">${esc(s.label)}</text>`
      : "";
    return `<g${rot}><title>${esc(s.title)}</title><rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${s.colour}" fill-opacity="${s.fillOpacity}" stroke="${s.colour}" stroke-width="0.4"${dash}/>${text}</g>`;
  });
  const focal = `<circle cx="${wf.focal.x}" cy="${wf.focal.y}" r="1.6" fill="none" stroke="#111" stroke-width="0.5"><title>Focal point</title></circle>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="wireframe" viewBox="0 0 100 ${wf.viewH}" width="${wf.width}" height="${wf.height}" role="img" aria-label="Layout wireframe"><rect width="100" height="${wf.viewH}" fill="#f4f4f4" stroke="#999" stroke-width="0.3"/>${parts.join("")}${focal}</svg>`;
}

export function wireframeSvg(
  layout: Layout,
  size: { width: number; height: number },
  measure: LayoutMeasure | null = null,
  px = 150,
): string {
  return wireframeSvgOf(wireframe(layout, size, measure, px));
}
