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

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const n = (v: number) => Math.round(v * 100) / 100;

function shape(e: LayoutElement, sy: number, marketing: boolean, estimated: boolean): string {
  const x = e.box.x;
  const y = e.box.y * sy;
  const w = e.box.w;
  const h = e.box.h * sy;
  const c = COLOUR[e.role];
  const rot = e.tiltDeg
    ? ` transform="rotate(${n(e.tiltDeg)} ${n(x + w / 2)} ${n(y + h / 2)})"`
    : "";
  const dash = estimated ? ' stroke-dasharray="1.2 0.8"' : "";
  const fill = marketing ? 0.55 : 0.3;
  const label = `${e.id} ${ROLE_LABEL[e.role]}${e.textEn ? `: ${e.textEn}` : ""}${estimated ? " (estimated)" : ""}`;
  const text =
    w > 14 && h > 3
      ? `<text x="${n(x + 1)}" y="${n(y + Math.min(h - 0.6, 3.2))}" font-size="2.6" fill="#1b1b1b">${esc(`${e.id} ${ROLE_LABEL[e.role]}`)}</text>`
      : "";
  return `<g${rot}><title>${esc(label)}</title><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" fill="${c}" fill-opacity="${fill}" stroke="${c}" stroke-width="0.4"${dash}/>${text}</g>`;
}

/**
 * The combined wireframe of one image, drawn by code from its saved layout (plan 5.1): the
 * in-game layer below, the marketing layer on top, in draw order. Values the measuring tool did
 * not confirm are dashed and labelled "estimated". Width and height are the image's own ratio.
 */
export function wireframeSvg(
  layout: Layout,
  size: { width: number; height: number },
  measure: LayoutMeasure | null = null,
  px = 150,
): string {
  const sy = size.height / size.width;
  const byZ = <T extends LayoutElement>(xs: readonly T[]) => [...xs].sort((a, b) => a.z - b.z);
  const est = (e: LayoutElement, marketing: boolean) =>
    marketing && !!measure && (e.role === "band" || e.tiltDeg !== 0) && !isMeasured(measure, e.id);
  const parts = [
    ...byZ(layout.inGame).map((e) => shape(e, sy, false, false)),
    ...byZ(layout.marketing).map((e) => shape(e, sy, true, est(e, true))),
  ];
  const f = layout.composition.focal;
  const focal = `<circle cx="${n(f.x)}" cy="${n(f.y * sy)}" r="1.6" fill="none" stroke="#111" stroke-width="0.5"><title>Focal point</title></circle>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="wireframe" viewBox="0 0 100 ${n(100 * sy)}" width="${px}" height="${Math.round(px * sy)}" role="img" aria-label="Layout wireframe"><rect width="100" height="${n(100 * sy)}" fill="#f4f4f4" stroke="#999" stroke-width="0.3"/>${parts.join("")}${focal}</svg>`;
}
