import type { ImageAnalysis } from "../analysis/schema.ts";
import { layoutNotes } from "./notes.ts";
import { type Layout, type LayoutBox, layoutSchema } from "./schema.ts";
import { MAX_NOTE } from "./vocab.ts";

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

/**
 * The hard checks: problems that make a layout unusable or unsafe to draw (ids that clash or
 * pass the cap, empty or out-of-range values, references to captures or texts that do not
 * exist, fields over their length cap, a required note missing). Only these reject an answer
 * and ask for a repair; where the layout merely disagrees with the main analysis it is saved
 * with notes (notes.ts). Worded for the repair prompt; failure.ts words them for the user.
 */
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
  for (const id of inIds)
    if (!/^S([1-9]|1[0-6])$/.test(id)) p(`in-game id "${id}" must be S1 to S16`);
  for (const id of mkIds)
    if (!/^M([1-9]|10)$/.test(id)) p(`marketing id "${id}" must be M1 to M10`);
  for (const e of [...l.inGame, ...l.marketing]) {
    if (!(e.box.w > 0 && e.box.h > 0)) p(`${e.id} has an empty box (or one outside the image)`);
    if (!(e.tiltDeg >= -45 && e.tiltDeg <= 45)) p(`${e.id} tilt must be between -45 and 45`);
    if (e.z < 0) p(`${e.id} draw order must be 0 or more`);
    if (e.role === "other" && !e.note.trim()) p(`${e.id} has role "other" and needs a note`);
    if (e.note.length > MAX_NOTE) p(`${e.id} note must be at most ${MAX_NOTE} characters`);
  }
  for (const e of l.inGame)
    if (e.capture !== null && (e.capture < 0 || e.capture >= caps))
      p(
        caps
          ? `${e.id} capture ${e.capture} does not exist (${caps} captures)`
          : `${e.id}: the image has no captures, so capture must be null`,
      );
  for (const e of l.marketing)
    if (e.textRef !== null && (e.textRef < 0 || e.textRef >= texts))
      p(`${e.id} textRef ${e.textRef} does not exist (${texts} marketing texts)`);
  const c = l.composition;
  const pct = (n: number) => n >= 0 && n <= 100;
  if (!pct(c.focal.x) || !pct(c.focal.y)) p("the focal point must be inside the image (0-100)");
  if (!pct(c.overlaySharePercent)) p("overlaySharePercent must be 0-100");
  if (c.focus.words.length > 80) p("focus.words must be at most 80 characters");
  if (c.marketingCovers.length > 120) p("marketingCovers must be at most 120 characters");
  if (c.reinforcement.length > 120) p("reinforcement must be at most 120 characters");
  if (c.focusMatch.reason.length > 120) p("focusMatch.reason must be at most 120 characters");
  return out;
}

export interface LayoutReading {
  layout: Layout | null;
  /** Hard problems: any one rejects the layout. */
  problems: string[];
  /** Soft notes, shown with a saved layout. */
  notes: string[];
}

/** Parses, tidies and checks one image's layout answer against its core reading. */
export function readLayout(raw: unknown, core: ImageAnalysis): LayoutReading {
  if (raw === undefined || raw === null)
    return { layout: null, problems: [`${core.imageRef} layout: missing`], notes: [] };
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success)
    return {
      layout: null,
      problems: parsed.error.issues
        .slice(0, 8)
        .map((i) => `${core.imageRef} layout.${i.path.join(".")}: ${i.message}`),
      notes: [],
    };
  const layout = tidyLayout(parsed.data, core);
  const problems = layoutProblems(layout, core);
  if (problems.length) return { layout: null, problems, notes: [] };
  return { layout, problems: [], notes: layoutNotes(layout, core) };
}
