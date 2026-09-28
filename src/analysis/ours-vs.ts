import { asCounted } from "./categories.ts";
import { colourFamily } from "./colours.ts";
import { type Labeler, plainLabel } from "./labels.ts";
import { counts, type DeckEntry, type Patterns, proportion, typeKey } from "./patterns.ts";

export type Verdict = "following" | "slightly different" | "very different" | "not enough data";

export interface PositionVerdict {
  position: number;
  imageId: string;
  ours: { type: string; layer: boolean; proportion: string; maskColour: string | null };
  verdict: Verdict;
  reasons: string[];
}

export interface OursVsPatterns {
  positions: PositionVerdict[];
  overall: { verdict: Verdict; reasons: string[] };
}

/** At least this many competitor screenshots at a position before judging it. */
export const MIN_AT_POSITION = 2;

function positionVerdict(e: DeckEntry, p: Patterns, label: Labeler): PositionVerdict {
  const a = e.final;
  const type = typeKey(a);
  const mask = a.marketingLayer.backgroundMasks[0];
  const ours = {
    type,
    layer: a.marketingLayer.present,
    proportion: proportion(a),
    maskColour: mask ? colourFamily(mask.colourName, mask.colourHex) : null,
  };
  const at = p.perPosition.find((x) => x.position === e.position);
  if (!at || at.n < MIN_AT_POSITION || !at.top) {
    return {
      position: e.position,
      imageId: e.imageId,
      ours,
      verdict: "not enough data",
      reasons: [`only ${at?.n ?? 0} competitor screenshots at position ${e.position}`],
    };
  }
  const reasons: string[] = [];
  const mine = at.types.find((t) => t.key === type);
  let verdict: Verdict;
  if (at.top.key === type || (mine && mine.share >= 0.25)) {
    verdict = "following";
    reasons.push(
      `${label(type)}: ${mine?.n ?? 0} of ${at.n} competitors at image ${e.position}${at.top.key === type ? "" : ` (most common: ${label(at.top.key)}, ${at.top.n} of ${at.n})`}`,
    );
  } else {
    const near = p.perPosition
      .filter((x) => Math.abs(x.position - e.position) === 1)
      .some((x) => x.types.some((t) => t.key === type));
    const overall = p.screenTypes.find((t) => t.key === type);
    const common = !!overall && overall.images / Math.max(1, p.images) >= 0.1;
    verdict = near || common ? "slightly different" : "very different";
    reasons.push(
      `competitors mostly show ${label(at.top.key)} here (${at.top.n} of ${at.n}); ${label(type)} ${near ? "appears at a neighbouring position" : common ? "appears elsewhere in their decks" : "is rare or unused in their decks"}`,
    );
  }
  let minor = 0;
  if (ours.layer !== at.layerShare >= 0.5) {
    minor++;
    reasons.push(
      `marketing layer ${ours.layer ? "present" : "absent"}; ${Math.round(at.layerShare * at.n)} of ${at.n} competitors have one at this image`,
    );
  }
  const topProp = at.proportions[0];
  if (topProp && topProp.key !== ours.proportion) {
    minor++;
    reasons.push(`layout "${ours.proportion}"; competitors here mostly use "${topProp.key}"`);
  }
  const typeColours = p.byScreenType.find((t) => t.key === type)?.maskColours ?? [];
  if (
    ours.maskColour &&
    typeColours.length &&
    !typeColours.slice(0, 2).some((c) => c.key === ours.maskColour)
  ) {
    reasons.push(
      `mask colour ${ours.maskColour}; for ${label(type)} competitors mostly use ${typeColours
        .slice(0, 2)
        .map((c) => c.key)
        .join(" or ")}`,
    );
  }
  if (verdict === "following" && minor >= 2) verdict = "slightly different";
  return { position: e.position, imageId: e.imageId, ours, verdict, reasons };
}

/** Our analysed deck against the competitors' patterns, per position and overall (by code). */
export function compareOurs(
  ours: readonly DeckEntry[],
  p: Patterns,
  ourDeckLength: number,
  label: Labeler = plainLabel,
): OursVsPatterns {
  const positions = [...ours]
    .sort((a, b) => a.position - b.position)
    .map((e) => positionVerdict(e, p, label));
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
  return { positions, overall: { verdict, reasons } };
}
