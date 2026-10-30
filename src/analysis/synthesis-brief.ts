import { categoryOf, categoryOfType, isArtCategory, reportLabeler } from "./categories.ts";
import { artMessage, showsLogo } from "./image-tags.ts";
import { plainLabel } from "./labels.ts";
import { layerStructure } from "./layer-structure.ts";
import { type DeckEntry, proportion } from "./patterns.ts";

const L = reportLabeler(plainLabel);

/**
 * One line per screenshot, both layers, for text-only prompts. Screen types are the report's
 * plain category names (never taxonomy codes), with the logo and art-message tags.
 */
export function brief(e: DeckEntry): string {
  const s = e.final.screenshot;
  const m = e.final.marketingLayer;
  const colours = (cs: { name: string; hex: string }[]) =>
    cs.map((c) => `${c.name} ${c.hex}`).join(", ");
  const layer = m.present
    ? [
        `layer ${m.coveragePercent}% (${proportion(e.final)})`,
        ...m.backgroundMasks.map(
          (b) => `mask ${b.shape} ${b.colourName} ${b.colourHex} at ${b.location}`,
        ),
        ...m.texts.map(
          (t) =>
            `text "${t.text}" (${t.role}, ${t.colour}, outline ${t.strokeColour}, ${t.fontStyle}, ${t.size}, ${t.position})`,
        ),
        ...m.elements.map(
          (x) => `element ${x.what} (${x.kind}) at ${x.position}, pose ${x.pose}, ${x.colours}`,
        ),
      ].join("; ")
    : "no marketing layer";
  const cat = categoryOf(e.final);
  const sub = s.subtype && !isArtCategory(cat) ? ` / ${L(s.subtype)}` : "";
  const tags = [
    `game logo: ${showsLogo(e.final, e.name) ? "yes" : "no"}, ${L(layerStructure(e.final))}`,
    ...(isArtCategory(cat) ? [`line: ${L(artMessage(e.final, e.name))}`] : []),
  ].join(", ");
  const caps = isArtCategory(cat)
    ? "one full picture"
    : s.captures
        .map(
          (c) =>
            `${c.orientation} ${L(categoryOfType(c.screenType))}${c.subtype ? ` / ${L(c.subtype)}` : ""} ${c.framing} ${c.areaPercent}%`,
        )
        .join(" + ") || "none";
  return `${e.name} #${e.position}: ${L(cat)}${sub} (${tags}), ${e.canvas}${e.ratio ? ` ${e.ratio}` : ""} image, captures: ${caps}, ${s.description} Action: ${s.action} Mood: ${s.atmosphere}. Colours: ${colours(s.mainColours)}. ${layer}`;
}
