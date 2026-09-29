import type { ImageAnalysis } from "../analysis/schema.ts";
import type { Layout, LayoutBox } from "./schema.ts";
import { ROLE_LABEL, TEXT_ROLES } from "./vocab.ts";

type Region = Pick<LayoutBox, "x" | "y" | "w" | "h">;

/** A point inside a box, with 5 points of slack (boxes and regions are drawn by hand). */
export const near = (b: Region, x: number, y: number) =>
  x >= b.x - 5 && x <= b.x + b.w + 5 && y >= b.y - 5 && y <= b.y + b.h + 5;

const role = (r: keyof typeof ROLE_LABEL) => ROLE_LABEL[r].toLowerCase();
const an = (w: string) => `${/^[aeiou]/.test(w) ? "an" : "a"} ${w}`;
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);

/**
 * Where the layout and the main analysis do not quite agree, in plain words for the image page
 * and the (i) popover. None of these makes a layout unusable, so none rejects or retries it
 * (only the hard checks in checks.ts do): the layout is saved and these are shown with it.
 */
export function layoutNotes(l: Layout, core: ImageAnalysis): string[] {
  const out: string[] = [];
  const n = (s: string) => out.push(`Note: ${s}`);
  const caps = core.screenshot.captures.length;
  const inIds = l.inGame.map((e) => e.id);
  const all = [...inIds, ...l.marketing.map((e) => e.id)];
  for (const e of l.inGame) {
    if (caps > 1 && e.capture === null)
      n(`screenshot box ${e.id} is not tied to one of the ${caps} screenshot areas.`);
    if (e.covers.length)
      n(`screenshot box ${e.id} is listed as covering other boxes; only marketing boxes should.`);
  }
  for (const e of l.marketing) {
    // Marketing may cover in-game and other marketing boxes (a badge over a character).
    for (const c of e.covers)
      if (!all.includes(c)) n(`${e.id} is listed as covering "${c}", which is not drawn.`);
    if (e.textRef !== null && !TEXT_ROLES.has(e.role))
      n(`${e.id} (${role(e.role)}) is linked to a marketing text; only text boxes usually are.`);
    if (e.text !== null && e.role !== "logo" && e.role !== "badge")
      n(`${e.id} (${role(e.role)}) repeats its text instead of linking the analysis' text.`);
  }
  // Each character, creature, item or logo the analysis lists on the marketing layer.
  for (const el of core.marketingLayer.elements) {
    const want = ["character", "creature", "item"].includes(el.kind)
      ? "cut-out"
      : el.kind === "logo"
        ? "logo"
        : null;
    const r = el.region;
    if (!want || !(r.w > 0 && r.h > 0)) continue;
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const fits = (x: string) => x === want || (el.kind === "item" && x === "badge");
    const there = l.marketing.filter((e) => near(e.box, cx, cy));
    if (there.some((e) => fits(e.role))) continue;
    const what = el.kind === "logo" ? "the logo" : `the ${short(el.what)}`;
    // A band, backdrop or frame holds everything near it: only a box of its own counts.
    const other = there.find((e) => !["band", "backdrop", "frame"].includes(e.role));
    const as = el.kind === "item" ? "a cut-out or badge" : an(role(want));
    n(
      other
        ? `${what} is drawn as ${an(role(other.role))} (${other.id}), not as ${as}.`
        : `${what} isn't drawn as its own box.`,
    );
  }
  if (caps <= 8)
    for (let i = 0; i < caps; i++)
      if (!l.inGame.some((e) => e.capture === i))
        n(`screenshot area ${i + 1} of ${caps} has no box.`);
  core.marketingLayer.texts.forEach((t, i) => {
    if (t.role !== "headline") return;
    const cx = t.region.x + t.region.w / 2;
    const cy = t.region.y + t.region.h / 2;
    const held = l.marketing.some(
      (e) => e.textRef === i || (TEXT_ROLES.has(e.role) && near(e.box, cx, cy)),
    );
    if (!held) n(`the headline "${short(t.text, 40)}" has no box.`);
  });
  const present = core.marketingLayer.present;
  if (!present && l.marketing.length)
    n(
      `the analysis found no marketing layer, but ${l.marketing.length} marketing boxes are drawn.`,
    );
  if (present && !l.marketing.length)
    n("the analysis found a marketing layer, but no marketing box is drawn.");
  const c = l.composition;
  if (all.length && !all.includes(c.focal.id))
    n(`the focal point names "${c.focal.id}", which is not drawn.`);
  const lost = c.readingOrder.filter((id) => !all.includes(id));
  if (lost.length) n(`the reading order names ${lost.join(", ")}, which is not drawn.`);
  if ((c.focusMatch.verdict === "no marketing layer") !== !l.marketing.length)
    n(`the focus verdict ("${c.focusMatch.verdict}") does not match the marketing boxes drawn.`);
  if (!l.marketing.length && (c.marketingCovers.trim() || c.reinforcement.trim()))
    n("the focus texts describe a marketing layer, but no marketing box is drawn.");
  return out;
}
