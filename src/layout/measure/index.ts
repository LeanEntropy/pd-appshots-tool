import type { Layout, LayoutBox, MarketingElement } from "../schema.ts";
import { type LayoutRole, RECT_ROLES } from "../vocab.ts";
import { type EdgeMeasure, measureBands, quadColour } from "./band.ts";
import { headlineText } from "./glyph.ts";
import { inside, loadPixels, type Pixels, type Quad, quadOf } from "./pixels.ts";
import { insets, type Side, snapBox } from "./rect.ts";

/** Version of the measuring tool; part of the measurement file's name. */
export const LAYOUT_MEASURE_VERSION = "layout-measure.v1";

/** What the pixels confirmed for one element; absent values stay the model's ("estimated"). */
export interface ElementMeasure {
  id: string;
  role: LayoutRole;
  box: LayoutBox | null;
  tiltDeg: number | null;
  top: EdgeMeasure | null;
  bottom: EdgeMeasure | null;
  colour: string | null;
  snapped: Side[];
}

export interface LayoutMeasure {
  version: typeof LAYOUT_MEASURE_VERSION;
  imageId: string;
  layoutKey: string;
  width: number;
  height: number;
  elements: ElementMeasure[];
  /** Uniform-colour margins around the image, percent (a framed or inset capture). */
  insets: Record<Side, number>;
  /** Marketing coverage: refined bands plus the other marketing boxes; an upper bound. */
  coverageUpTo: number;
  /** Not used for recommendations or patterns until validated (plan section 3). */
  experimental: { headlineGlyphPercent: number | null; headlineContrast: number | null };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Share of the image covered by the marketing rectangles (a 1/4-scale raster), percent. A frame
 * or backdrop counts only outside the captured screen (`holes`: the in-game boxes of captures).
 */
function coverage(p: Pixels, quads: { q: Quad; ring: boolean }[], holes: Quad[]): number {
  if (!quads.length) return 0;
  let hit = 0;
  let n = 0;
  for (let y = 2; y < p.h; y += 4)
    for (let x = 2; x < p.w; x += 4) {
      n++;
      const hole = () => holes.some((h) => inside(h, x, y));
      if (quads.some(({ q, ring }) => inside(q, x, y) && !(ring && hole()))) hit++;
    }
  return r1((hit / n) * 100);
}

const RING_ROLES: ReadonlySet<LayoutRole> = new Set(["frame", "backdrop"]);

/**
 * Measures a layout on the image's pixels (code only, well under a second). Seeded by the
 * model's boxes: it refines band edges and tilt, snaps level rectangular elements to strong
 * edges, and never invents elements.
 */
export async function measureLayout(
  bytes: Buffer,
  layout: Layout,
  ids: { imageId: string; layoutKey: string },
): Promise<LayoutMeasure> {
  const p = await loadPixels(bytes);
  const elements: ElementMeasure[] = [];
  const quads: { q: Quad; ring: boolean }[] = [];
  const bands = measureBands(
    p,
    layout.marketing.filter((e) => e.role === "band"),
  );
  for (const e of [...layout.inGame, ...layout.marketing]) {
    const m: ElementMeasure = {
      id: e.id,
      role: e.role,
      box: null,
      tiltDeg: null,
      top: null,
      bottom: null,
      colour: null,
      snapped: [],
    };
    const marketing = layout.marketing.includes(e as MarketingElement);
    if (e.role === "band") {
      const b = bands.get(e.id) ?? {
        box: null,
        tiltDeg: null,
        top: null,
        bottom: null,
        colour: null,
      };
      Object.assign(m, {
        box: b.box,
        tiltDeg: b.tiltDeg,
        top: b.top,
        bottom: b.bottom,
        colour: b.colour,
      });
    } else if (RECT_ROLES.has(e.role) && Math.abs(e.tiltDeg) < 1) {
      const s = snapBox(p, e.box);
      if (s) Object.assign(m, { box: s.box, tiltDeg: 0, snapped: s.snapped });
    }
    if (marketing) {
      const q = quadOf(p, m.box ?? e.box, m.tiltDeg ?? e.tiltDeg);
      quads.push({ q, ring: RING_ROLES.has(e.role) });
      if (e.role !== "band" && RECT_ROLES.has(e.role)) m.colour = quadColour(p, q);
    }
    elements.push(m);
  }
  const head = layout.marketing.find((e) => e.role === "headline");
  const text = head ? headlineText(p, head) : null;
  return {
    version: LAYOUT_MEASURE_VERSION,
    ...ids,
    width: p.w,
    height: p.h,
    elements,
    insets: insets(p),
    coverageUpTo: coverage(
      p,
      quads,
      layout.inGame.filter((e) => e.capture !== null).map((e) => quadOf(p, e.box, e.tiltDeg)),
    ),
    experimental: {
      headlineGlyphPercent: text?.glyphPercent ?? null,
      headlineContrast: text?.contrast ?? null,
    },
  };
}

/** The layout with the measured boxes and tilts in place of the model's where measured. */
export function applyMeasure(layout: Layout, m: LayoutMeasure): Layout {
  const pick = <T extends { id: string; box: LayoutBox; tiltDeg: number }>(e: T): T => {
    const x = m.elements.find((k) => k.id === e.id);
    return x?.box ? { ...e, box: x.box, tiltDeg: x.tiltDeg ?? e.tiltDeg } : e;
  };
  return {
    ...layout,
    inGame: layout.inGame.map(pick),
    marketing: layout.marketing.map(pick),
    composition: { ...layout.composition, overlaySharePercent: m.coverageUpTo },
  };
}

/** Which of an element's values were measured (the rest are the model's estimates). */
export const isMeasured = (m: LayoutMeasure | null, id: string): boolean =>
  !!m?.elements.find((e) => e.id === id)?.box;
