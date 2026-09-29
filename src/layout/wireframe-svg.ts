import type { LayoutMeasure } from "./measure/index.ts";
import { isMeasured } from "./measure/index.ts";
import type { Layout, LayoutElement } from "./schema.ts";
import type { LayoutRole } from "./vocab.ts";
import { FILL, type Item, item, list, num, roleOf, WORDS_ONLY } from "./wireframe-items.ts";
import { type LabelJob, placeLabels, type Rect, type WireLabel } from "./wireframe-place.ts";
import { detailsOf, labelOf, layerSummary, type Reading, WIRE_WORD } from "./wireframe-words.ts";

const LAYER = {
  screenshot: { title: "Screenshot layer", stroke: "#2f5d45", bg: "#eef4f0" },
  marketing: { title: "Marketing layer", stroke: "#7a3e0c", bg: "#fbf7f1" },
};
const TEXT_FIRST: ReadonlySet<LayoutRole> = new Set([
  "headline",
  "subline",
  "callout",
  "badge",
  "logo",
]);
/** Characters and cut-outs are one simple rounded block each: size and lean, no silhouette. */
const ROUND: ReadonlySet<LayoutRole> = new Set(["character", "cut-out"]);

/** One drawn shape, reduced to checked primitives: a rotated (rounded) box or a polygon. */
export interface WireShape {
  /** Polygon points x,y,x,y... (a measured band), or empty for a box. */
  pts: number[];
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  rx: number;
  fill: string;
  stroke: string;
  /** Frames are drawn as an outline only. */
  outline: boolean;
  dashed: boolean;
  title: string;
}

export interface WirePanel {
  title: string;
  /** Picture size in px; the panel is `h + strip` tall. */
  w: number;
  h: number;
  strip: number;
  bg: string;
  stroke: string;
  shapes: WireShape[];
  labels: WireLabel[];
  legend: { fill: string; outline: boolean; text: string }[];
  /** One plain sentence built from the boxes. */
  summary: string;
  /** What the boxes leave out, in words (the analysis' description, minor props). */
  details: string;
  /** The words of each box that has more to say than its label. */
  parts: { label: string; about: string }[];
  focal: { x: number; y: number } | null;
}

/** Both layers of one image as data the page draws with DOM calls (never parsed as markup). */
export interface Wireframe {
  panels: WirePanel[];
  /** Plain-words key to the outlines, or "". */
  note: string;
}

const area = (r: Rect) => r.w * r.h;

function panel(
  kind: "screenshot" | "marketing",
  items: Item[],
  img: { w: number; h: number },
  words: { summary: string; details: string },
): WirePanel {
  const L = LAYER[kind];
  // Biggest first, so a small box is never hidden under a big one; text always on top.
  const top = (it: Item) => (TEXT_FIRST.has(it.role) ? 1 : 0);
  const order = [...items].sort(
    (a, b) =>
      top(a) - top(b) ||
      area(b.bounds) - area(a.bounds) ||
      num(a.e.z, -1e6, 1e6) - num(b.e.z, -1e6, 1e6),
  );
  const shapes: WireShape[] = order.map((it) => {
    const f = it.frame;
    return {
      pts: it.pts,
      x: num(f.cx - f.w / 2, -2000, 4000),
      y: num(f.cy - f.h / 2, -2000, 4000),
      w: num(f.w, 0, 4000),
      h: num(f.h, 0, 4000),
      rot: num(f.rot, -45, 45),
      rx: ROUND.has(it.role) ? num(Math.min(f.w, f.h) * 0.3, 0, 200) : 2,
      fill: FILL[it.role],
      stroke: L.stroke,
      outline: it.role === "frame",
      dashed: it.dashed,
      title: `${labelOf(it.e, it.role, it.tilt, it.who)}${it.dashed ? " (tilt estimated)" : ""}${it.about ? ` - ${it.about}` : ""}`,
    };
  });
  const jobs: LabelJob[] = order.map((it, i) => ({
    // A repeat (same role, same name) gets a label only where it fits inside.
    optional:
      !TEXT_FIRST.has(it.role) &&
      order.slice(0, i).some((o) => o.role === it.role && o.who === it.who),
    text: labelOf(it.e, it.role, it.tilt, it.who),
    frame: it.frame,
    bounds: it.bounds,
    above: order
      .slice(i + 1)
      .map((o) => o.bounds)
      .filter((r) => r.w > 0 && r.h > 0),
  }));
  const rank = (i: number) => {
    const it = order[i];
    return !it ? 0 : TEXT_FIRST.has(it.role) ? -1e9 : area(it.bounds);
  };
  const byNeed = jobs
    .map((j, i) => ({ j, i }))
    .sort((a, b) => rank(a.i) - rank(b.i))
    .map((x) => x.j);
  const { labels, strip } = placeLabels(byNeed, img);
  const lines = new Set<string>();
  const parts = order
    .filter((it) => it.about)
    .map((it) => ({ label: labelOf(it.e, it.role, it.tilt, it.who), about: it.about }))
    .filter((x) => !lines.has(`${x.label}|${x.about}`) && lines.add(`${x.label}|${x.about}`))
    .slice(0, 12);
  const seen = new Set<LayoutRole>();
  const legend = order
    .filter((it) => !seen.has(it.role) && seen.add(it.role))
    .map((it) => ({ fill: FILL[it.role], outline: it.role === "frame", text: WIRE_WORD[it.role] }));
  return {
    title: L.title,
    w: img.w,
    h: num(img.h, 1, 4000),
    strip,
    bg: L.bg,
    stroke: L.stroke,
    shapes,
    labels,
    legend,
    ...words,
    parts,
    focal: null,
  };
}

/** What the analysis read about the image, for the words under the panels (optional). */
export interface WireReading {
  screenshot?: Reading;
  marketing?: Reading;
}

/**
 * The two wireframes of one image, drawn by code from its saved layout: the screenshot layer
 * (the game screen) and the marketing layer (what was put on top), each in its own panel of the
 * image's ratio with plain labels and a few words. Only what defines the composition is a box;
 * minor props and in-game text go into the words. Saved layouts are read back unchecked, so every
 * value is re-checked here. Tilted shapes the pixels did not confirm are dashed.
 */
export function wireframe(
  layout: Layout,
  size: { width: number; height: number },
  measure: LayoutMeasure | null = null,
  px?: number,
  reading: WireReading = {},
): Wireframe {
  const ratio = size.height / size.width;
  const r = Number.isFinite(ratio) && ratio > 0 ? Math.min(3, Math.max(0.3, ratio)) : 16 / 9;
  const w = num(px ?? (r >= 1.3 ? 230 : r >= 0.8 ? 270 : 330), 60, 800);
  const img = { w, h: Math.round(w * r) };
  const est = (e: LayoutElement) =>
    !!measure && (e.role === "band" || num(e.tiltDeg, -45, 45) !== 0) && !isMeasured(measure, e.id);
  const drawn = (e: LayoutElement) => !WORDS_ONLY.has(roleOf(e.role));
  const inAll = list(layout?.inGame);
  const mkAll = list(layout?.marketing);
  const inGame = inAll.filter(drawn).map((e) => item(e, img, measure, false, reading.screenshot));
  const marketing = mkAll
    .filter(drawn)
    .map((e) => item(e, img, measure, est(e), reading.marketing));
  const comp: unknown = layout?.composition;
  const c =
    comp && typeof comp === "object"
      ? (comp as { overlaySharePercent?: unknown; focal?: unknown })
      : {};
  const cover = { percent: num(c.overlaySharePercent, 0, 100), measured: !!measure };
  const left = (xs: LayoutElement[]) => xs.filter((e) => !drawn(e));
  const panels = [
    panel("screenshot", inGame, img, {
      summary: layerSummary("screenshot", inGame, null),
      details: detailsOf("screenshot", left(inAll), reading.screenshot),
    }),
    panel("marketing", marketing, img, {
      summary: layerSummary("marketing", marketing, mkAll.length ? cover : null),
      details: detailsOf("marketing", left(mkAll), reading.marketing),
    }),
  ];
  const f =
    c.focal && typeof c.focal === "object"
      ? (c.focal as { x?: unknown; y?: unknown; id?: unknown })
      : null;
  let ring = false;
  const at =
    f && (marketing.find((it) => it.e.id === f.id) ?? inGame.find((it) => it.e.id === f.id));
  if (f && at) {
    const p = panels[inGame.includes(at) ? 0 : 1];
    const x = num((num(f.x, 0, 100) / 100) * img.w, 0, 4000);
    const y = num((num(f.y, 0, 100) / 100) * img.h, 0, 4000);
    // The ring is left out where it would sit on a label; the summary still says it.
    const clear = !p?.labels.some(
      (l) => x > l.x - 7 && x < l.x + l.w + 7 && y > l.y - 7 && y < l.y + l.h + 7,
    );
    if (p && clear) {
      p.focal = { x, y };
      ring = true;
    }
    const name = at.role === "hud" ? "HUD" : (labelOf(at.e, at.role, 0).split(":")[0] ?? "");
    if (p)
      p.summary += ` The eye lands first on the ${name === "HUD" ? name : name.toLowerCase()}.`;
  }
  const dashed = panels.some((p) => p.shapes.some((s) => s.dashed));
  const note = [
    dashed
      ? "Dashed outline: the tilt is the model's estimate; the pixels did not confirm it. Solid: measured or level."
      : "",
    ring ? "Ring: where the eye lands first." : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { panels, note };
}
