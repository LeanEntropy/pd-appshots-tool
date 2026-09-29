import type { LayoutMeasure } from "./measure/index.ts";
import { isMeasured } from "./measure/index.ts";
import type { Layout, LayoutElement } from "./schema.ts";
import type { LayoutRole } from "./vocab.ts";
import { FILL, type Item, item, list, num, roleOf, WORDS_ONLY } from "./wireframe-items.ts";
import type { WirePanel, WireReading, WireShape } from "./wireframe-svg.ts";
import { detailsOf, layerSummary, WIRE_WORD } from "./wireframe-words.ts";

/**
 * The image page's wireframes (plan-games-library section 9, user decision D5): the same two
 * panels as the (i) popover, from the same shape and placement code, but each shape carries a
 * number chip (1..n in the screenshot layer, M1..Mn in the marketing layer) instead of a text
 * label, and a numbered list goes under each panel. wireframe() and its labels are untouched.
 */
export interface NumberedRow {
  /** "1", "2" or "M1"; repeated identical items share one row ("3, 4, 5"). */
  n: string;
  /** Role in plain words, and who or what it is. */
  name: string;
  /** The words exactly as drawn (texts only), and their English meaning when the layout has it. */
  text: string;
  english: string;
  /** Colours, expression, costume, pose: the element's note and the analysis' element there. */
  about: string;
}

export interface NumberedPanel extends WirePanel {
  chips: { n: string; x: number; y: number }[];
  rows: NumberedRow[];
}

export interface NumberedWireframe {
  panels: NumberedPanel[];
  note: string;
}

const LAYER = {
  screenshot: { title: "Screenshot layer", stroke: "#2f5d45", bg: "#eef4f0", prefix: "" },
  marketing: { title: "Marketing layer", stroke: "#7a3e0c", bg: "#fbf7f1", prefix: "M" },
};
const TEXT_FIRST: ReadonlySet<LayoutRole> = new Set([
  "headline",
  "subline",
  "callout",
  "badge",
  "logo",
]);
const ROUND: ReadonlySet<LayoutRole> = new Set(["character", "cut-out"]);
const plain = (v: unknown, n: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "";

function textOf(e: LayoutElement, texts: readonly { text?: unknown }[]): string {
  const ref = (e as { textRef?: unknown }).textRef;
  const fromRef = typeof ref === "number" && Number.isInteger(ref) ? texts[ref]?.text : undefined;
  return plain(e.text, 200) || plain(fromRef, 200);
}

function shapeOf(it: Item, stroke: string, title: string): WireShape {
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
    stroke,
    outline: it.role === "frame",
    dashed: it.dashed,
    title,
  };
}

function panel(
  kind: "screenshot" | "marketing",
  items: Item[],
  img: { w: number; h: number },
  words: { summary: string; details: string },
  texts: readonly { text?: unknown }[],
): NumberedPanel {
  const L = LAYER[kind];
  // Numbers follow the reading order (top to bottom, then left to right).
  const read = [...items].sort(
    (a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x || a.e.id.localeCompare(b.e.id),
  );
  const nOf = new Map(read.map((it, i) => [it, `${L.prefix}${i + 1}`]));
  const rowOf = (it: Item): Omit<NumberedRow, "n"> => ({
    name: `${WIRE_WORD[it.role]}${it.who ? `: ${it.who}` : ""}`,
    text: TEXT_FIRST.has(it.role) || it.role === "dialog" ? textOf(it.e, texts) : "",
    english: plain(it.e.textEn, 200),
    about: it.about,
  });
  const rows: NumberedRow[] = [];
  const byKey = new Map<string, NumberedRow>();
  for (const it of read) {
    const r = rowOf(it);
    const key = JSON.stringify(r);
    const had = byKey.get(key);
    if (had) had.n += `, ${nOf.get(it)}`;
    else {
      const row = { n: nOf.get(it) ?? "", ...r };
      byKey.set(key, row);
      rows.push(row);
    }
  }
  // Biggest first, so a small box is never hidden under a big one; text always on top.
  const top = (it: Item) => (TEXT_FIRST.has(it.role) ? 1 : 0);
  const area = (it: Item) => it.bounds.w * it.bounds.h;
  const order = [...items].sort(
    (a, b) => top(a) - top(b) || area(b) - area(a) || num(a.e.z, -1e6, 1e6) - num(b.e.z, -1e6, 1e6),
  );
  const taken: { x: number; y: number }[] = [];
  const chips = read.map((it) => {
    const n = nOf.get(it) ?? "";
    const cw = 10 + n.length * 7;
    let x = num(it.bounds.x + 3, 0, Math.max(0, img.w - cw));
    let y = num(it.bounds.y + 3, 0, Math.max(0, img.h - 16));
    // Chips of boxes that start at the same place step down so each number stays readable.
    while (taken.some((t) => Math.abs(t.x - x) < cw && Math.abs(t.y - y) < 16)) {
      if (y + 17 <= img.h - 16) y += 17;
      else if (x + cw + 2 <= img.w - cw) x += cw + 2;
      else break;
    }
    taken.push({ x, y });
    return { n, x, y };
  });
  const seen = new Set<LayoutRole>();
  const legend = order
    .filter((it) => !seen.has(it.role) && seen.add(it.role))
    .map((it) => ({ fill: FILL[it.role], outline: it.role === "frame", text: WIRE_WORD[it.role] }));
  return {
    title: L.title,
    w: img.w,
    h: num(img.h, 1, 4000),
    strip: 0,
    bg: L.bg,
    stroke: L.stroke,
    shapes: order.map((it) => {
      const r = rowOf(it);
      return shapeOf(
        it,
        L.stroke,
        `${nOf.get(it)} ${r.name}${it.dashed ? " (tilt estimated)" : ""}`,
      );
    }),
    labels: [],
    legend,
    ...words,
    parts: [],
    focal: null,
    chips,
    rows,
  };
}

/** Both layers of one picture, numbered, for the image page. */
export function numberedWireframe(
  layout: Layout,
  size: { width: number; height: number },
  measure: LayoutMeasure | null = null,
  reading: WireReading & { texts?: readonly { text?: unknown }[] } = {},
): NumberedWireframe {
  const ratio = size.height / size.width;
  const r = Number.isFinite(ratio) && ratio > 0 ? Math.min(3, Math.max(0.3, ratio)) : 16 / 9;
  // Bigger than the popover's panels: the page has room.
  const w = r >= 1.3 ? 300 : r >= 0.8 ? 340 : 420;
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
  const c = comp && typeof comp === "object" ? (comp as { overlaySharePercent?: unknown }) : {};
  const cover = { percent: num(c.overlaySharePercent, 0, 100), measured: !!measure };
  const left = (xs: LayoutElement[]) => xs.filter((e) => !drawn(e));
  const texts = Array.isArray(reading.texts) ? reading.texts : [];
  const panels = [
    panel(
      "screenshot",
      inGame,
      img,
      {
        summary: layerSummary("screenshot", inGame, null),
        details: detailsOf("screenshot", left(inAll), reading.screenshot),
      },
      [],
    ),
    panel(
      "marketing",
      marketing,
      img,
      {
        summary: layerSummary("marketing", marketing, mkAll.length ? cover : null),
        details: detailsOf("marketing", left(mkAll), reading.marketing),
      },
      texts,
    ),
  ];
  const dashed = panels.some((p) => p.shapes.some((s) => s.dashed));
  return {
    panels,
    note: dashed
      ? "Dashed outline: the tilt is the model's estimate; the pixels did not confirm it. Solid: measured or level."
      : "",
  };
}
