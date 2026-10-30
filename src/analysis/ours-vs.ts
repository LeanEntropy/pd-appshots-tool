import { asCounted } from "./categories.ts";
import { colourFamily } from "./colours.ts";
import { coreKept, type Directive, directivesOf } from "./directives.ts";
import { type Labeler, plainLabel } from "./labels.ts";
import { layerStructure } from "./layer-structure.ts";
import { type PositionVerdict, positionVerdict, type Verdict } from "./ours-vs-position.ts";
import { counts, type DeckEntry, type Patterns, proportion, typeKey } from "./patterns.ts";

export { directiveFacts } from "./directive-facts.ts";
export {
  MIN_AT_POSITION,
  type PositionVerdict,
  positionWord,
  type Verdict,
} from "./ours-vs-position.ts";

export interface OursVsPatterns {
  positions: PositionVerdict[];
  overall: { verdict: Verdict; reasons: string[] };
  /** Copy and drop directives (absent in reports saved before 2026-10-30). */
  directives?: Directive[];
}
/** Our analysed deck against the competitors' patterns, per position and overall (by code). */
export function compareOurs(
  ours: readonly DeckEntry[],
  p: Patterns,
  ourDeckLength: number,
  label: Labeler = plainLabel,
  theirs?: readonly DeckEntry[],
): OursVsPatterns {
  const directives = theirs ? directivesOf(theirs, ours, p, label) : [];
  const core = theirs ? coreKept(theirs, ours, label) : new Map<number, string>();
  // A directive leads "How ours compares"; an image to drop is never "following".
  const positions = [...ours]
    .sort((a, b) => a.position - b.position)
    .map((e) => positionVerdict(e, p, label))
    .map((v): PositionVerdict => {
      const d = directives.find((x) => x.position === v.position);
      const kept = core.get(v.position);
      if (!d) return kept ? { ...v, reasons: [...v.reasons, kept] } : v;
      return {
        ...v,
        verdict: d.kind === "drop" ? "very different" : v.verdict,
        reasons: [d.text, `What should be there: ${d.spec.details.join("; ")}`, ...v.reasons],
        directive: {
          kind: d.kind,
          text: d.text,
          details: d.spec.details,
          orientation: d.spec.orientation,
          screenshotLayer: d.spec.screenshotLayer,
        },
      };
    });
  const reasons: string[] = [];
  let very = positions.filter((x) => x.verdict === "very different").length;
  let slight = positions.filter((x) => x.verdict === "slightly different").length;
  if (very || slight)
    reasons.push(
      `${positions.length - very - slight} of ${positions.length} positions follow the pattern, ${slight} slightly different, ${very} very different`,
    );
  const canvas = counts(ours.map((e) => e.canvas))[0];
  const theirCanvas = p.orientation.canvas[0];
  if (canvas && theirCanvas && canvas.key !== theirCanvas.key) {
    very++;
    reasons.push(
      `our images are ${canvas.key}; competitors mostly use ${theirCanvas.key} (${theirCanvas.n} of ${p.images})`,
    );
  }
  const capture = counts(
    ours.flatMap((e) => asCounted(e.final).screenshot.captures.map((c) => c.orientation)),
  )[0];
  const theirCapture = p.orientation.capture[0];
  if (capture && theirCapture && capture.key !== theirCapture.key) {
    slight++;
    reasons.push(
      `our in-game captures are mostly ${label(capture.key)}; competitors' are mostly ${label(theirCapture.key)} (${theirCapture.n} of ${p.orientation.capture.reduce((n, c) => n + c.n, 0)})`,
    );
  }
  const ourComp = counts(ours.map((e) => asCounted(e.final).screenshot.composition))[0];
  const theirComp = p.composition[0];
  if (ourComp && theirComp && ourComp.key !== theirComp.key) {
    slight++;
    reasons.push(
      `our images are mostly "${label(ourComp.key)}"; competitors' are mostly "${label(theirComp.key)}" (${theirComp.n} of ${p.images})`,
    );
  }
  const ourLs = counts(ours.map((e) => layerStructure(e.final)))[0];
  const theirLs = p.layerStructure?.[0];
  if (ourLs && theirLs && ourLs.key !== theirLs.key) {
    slight++;
    reasons.push(
      `our images are mostly "${label(ourLs.key)}"; competitors' are mostly "${label(theirLs.key)}" (${theirLs.n} of ${p.images})`,
    );
  }
  const layerShare = ours.length
    ? ours.filter((e) => e.final.marketingLayer.present).length / ours.length
    : 0;
  const gap = Math.abs(layerShare - p.marketingLayer.share);
  if (gap > 0.15) {
    if (gap > 0.3) very++;
    else slight++;
    reasons.push(
      `${ours.filter((e) => e.final.marketingLayer.present).length} of our ${ours.length} images have a marketing layer vs ${Math.round(p.marketingLayer.share * p.images)} of ${p.images} competitor images`,
    );
  }
  const ourProp = counts(ours.map((e) => proportion(e.final)))[0];
  const theirProp = p.proportion[0];
  if (ourProp && theirProp && ourProp.key !== theirProp.key) {
    slight++;
    reasons.push(`our usual layout is "${ourProp.key}"; competitors mostly use "${theirProp.key}"`);
  }
  const lenGap = Math.abs(ourDeckLength - p.deckLength.median);
  if (lenGap >= 2) {
    if (lenGap >= 3) very++;
    else slight++;
    reasons.push(
      `our deck has ${ourDeckLength} screenshots; the competitors' median is ${p.deckLength.median}`,
    );
  }
  const used = new Set(ours.map((e) => typeKey(e.final)));
  for (const t of p.screenTypes.filter((x) => x.gameShare >= 0.5 && !used.has(x.key))) {
    slight++;
    reasons.push(
      `${label(t.key)} is used by ${t.games} of ${p.games.length} competitors but not by us`,
    );
  }
  const ourLayer = counts(
    ours.flatMap((e) =>
      e.final.marketingLayer.mainColours.slice(0, 1).map((c) => colourFamily(c.name, c.hex)),
    ),
  )[0];
  const theirLayer = p.colours.layer.slice(0, 3).map((c) => c.key);
  if (ourLayer && theirLayer.length && !theirLayer.includes(ourLayer.key))
    reasons.push(
      `our marketing layer is mostly ${ourLayer.key}; competitors' are mostly ${theirLayer.join(", ")}`,
    );
  const verdict: Verdict =
    very >= 2 ? "very different" : very || slight >= 2 ? "slightly different" : "following";
  if (!reasons.length) reasons.push("our deck matches the competitors' main patterns");
  return { positions, overall: { verdict, reasons }, ...(theirs ? { directives } : {}) };
}
