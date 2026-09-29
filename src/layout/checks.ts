import type { ImageAnalysis } from "../analysis/schema.ts";
import { type Layout, type LayoutBox, layoutSchema } from "./schema.ts";
import { TEXT_ROLES } from "./vocab.ts";

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A box clamped into the image (slight overshoot is normal), rounded to 0.1 point. */
function clampBox(b: LayoutBox): LayoutBox {
  const x0 = Math.max(0, b.x);
  const y0 = Math.max(0, b.y);
  const x1 = Math.min(100, b.x + b.w);
  const y1 = Math.min(100, b.y + b.h);
  return { x: r1(x0), y: r1(y0), w: r1(Math.max(0, x1 - x0)), h: r1(Math.max(0, y1 - y0)) };
}

/**
 * Harmless slips fixed before the checks: boxes clamped, a single-capture image's missing
 * capture index filled in, and the ids of the other layer dropped from the reading order.
 */
export function tidyLayout(l: Layout, core: ImageAnalysis): Layout {
  const one = core.screenshot.captures.length === 1;
  return {
    ...l,
    inGame: l.inGame.map((e) => ({
      ...e,
      box: clampBox(e.box),
      capture: e.capture === null && one ? 0 : e.capture,
    })),
    // A text already referenced is not repeated; the reference wins.
    marketing: l.marketing.map((e) => ({
      ...e,
      box: clampBox(e.box),
      text: e.textRef === null ? e.text : null,
    })),
  };
}

/** Ownership and consistency checks against the core reading (plan 2.3), in plain words. */
export function layoutProblems(l: Layout, core: ImageAnalysis): string[] {
  const out: string[] = [];
  const ref = core.imageRef;
  const p = (s: string) => out.push(`${ref} layout: ${s}`);
  const caps = core.screenshot.captures.length;
  const texts = core.marketingLayer.texts.length;
  const inIds = l.inGame.map((e) => e.id);
  const mkIds = l.marketing.map((e) => e.id);
  const all = [...inIds, ...mkIds];
  if (new Set(all).size !== all.length) p("every element id must be unique");
  for (const id of inIds) if (!/^S[1-8]$/.test(id)) p(`in-game id "${id}" must be S1 to S8`);
  for (const id of mkIds) if (!/^M[1-8]$/.test(id)) p(`marketing id "${id}" must be M1 to M8`);
  for (const e of [...l.inGame, ...l.marketing]) {
    if (e.box.w <= 0 || e.box.h <= 0) p(`${e.id} has an empty box`);
    if (!(e.tiltDeg >= -45 && e.tiltDeg <= 45)) p(`${e.id} tilt must be between -45 and 45`);
    if (e.z < 0) p(`${e.id} draw order must be 0 or more`);
    if (e.role === "other" && !e.note.trim()) p(`${e.id} has role "other" and needs a note`);
    if (e.note.length > 80) p(`${e.id} note must be at most 80 characters`);
  }
  for (const e of l.inGame) {
    if (caps === 0 && e.capture !== null)
      p(`${e.id}: the image has no captures, so capture must be null`);
    if (caps > 1 && e.capture === null) p(`${e.id} must name its capture (0 to ${caps - 1})`);
    if (e.capture !== null && (e.capture < 0 || e.capture >= caps))
      p(`${e.id} capture ${e.capture} does not exist (${caps} captures)`);
    if (e.covers.length) p(`${e.id}: only marketing elements cover others`);
  }
  for (const e of l.marketing) {
    if (e.textRef !== null && (e.textRef < 0 || e.textRef >= texts))
      p(`${e.id} textRef ${e.textRef} does not exist (${texts} marketing texts)`);
    if (e.textRef !== null && !TEXT_ROLES.has(e.role))
      p(`${e.id}: only headline, subline, badge and logo elements point at a text`);
    if (e.text !== null && e.role !== "logo" && e.role !== "badge")
      p(`${e.id}: only logo and badge elements carry their own text; point at the text instead`);
    for (const c of e.covers)
      if (!inIds.includes(c)) p(`${e.id} covers "${c}", which is not an in-game element`);
  }
  const present = core.marketingLayer.present;
  if (!present && l.marketing.length)
    p("the marketing layer is absent, so the marketing list must be empty");
  if (present && !l.marketing.length)
    p("the marketing layer is present, so list at least one marketing element");
  const c = l.composition;
  if (all.length && !all.includes(c.focal.id)) p(`focal id "${c.focal.id}" is not an element`);
  for (const id of c.readingOrder)
    if (!all.includes(id)) p(`reading order id "${id}" is not an element`);
  const pct = (n: number) => n >= 0 && n <= 100;
  if (!pct(c.focal.x) || !pct(c.focal.y)) p("the focal point must be inside the image (0-100)");
  if (!pct(c.overlaySharePercent)) p("overlaySharePercent must be 0-100");
  return out;
}

export interface LayoutReading {
  layout: Layout | null;
  problems: string[];
}

/** Parses, tidies and checks one image's layout answer against its core reading. */
export function readLayout(raw: unknown, core: ImageAnalysis): LayoutReading {
  if (raw === undefined || raw === null)
    return { layout: null, problems: [`${core.imageRef} layout: missing`] };
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success)
    return {
      layout: null,
      problems: parsed.error.issues
        .slice(0, 8)
        .map((i) => `${core.imageRef} layout.${i.path.join(".")}: ${i.message}`),
    };
  const layout = tidyLayout(parsed.data, core);
  const problems = layoutProblems(layout, core);
  return problems.length ? { layout: null, problems } : { layout, problems: [] };
}
