import { categoryOf, hasDefinition, isArtCategory } from "./categories.ts";
import type { DeckEntry } from "./patterns.ts";
import type { ImageAnalysis } from "./schema.ts";

/** Screen kinds of the copy and drop directives (directives.ts). */

/** Our image's screen kind: the category, and for a game screen its subtype. */
export function kindOf(a: ImageAnalysis): { category: string; subtype: string } {
  const category = categoryOf(a);
  if (isArtCategory(category)) return { category, subtype: "" };
  const s = a.screenshot;
  if (s.screenType === category) return { category, subtype: s.subtype };
  const c = [...s.captures]
    .sort((x, y) => y.areaPercent - x.areaPercent)
    .find((x) => x.screenType === category);
  return { category, subtype: c?.subtype ?? "" };
}

/** Outcome screens of a round: shown after play, not play itself. */
const OUTCOME = new Set(["victory", "defeat"]);

/** A Gameplay screen showing play itself (our core loop: never dropped). */
export const coreLoop = (e: DeckEntry) => {
  const k = kindOf(e.final);
  return k.category === "gameplay" && !OUTCOME.has(k.subtype);
};

/** A category without a definition never drives a finding (categories.ts). */
export const defined = (a: ImageAnalysis) => (hasDefinition(categoryOf(a)) ? categoryOf(a) : null);

/** A competitor image shows that kind (as its main screen or as one of its captures). */
export function uses(a: ImageAnalysis, k: { category: string; subtype: string }): boolean {
  if (categoryOf(a) !== k.category) return false;
  if (!k.subtype) return true;
  const s = a.screenshot;
  return s.subtype === k.subtype || s.captures.some((c) => c.subtype === k.subtype);
}
