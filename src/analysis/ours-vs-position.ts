import { colourFamily } from "./colours.ts";
import { showsLogo } from "./image-tags.ts";
import type { Labeler } from "./labels.ts";
import { layerStructure } from "./layer-structure.ts";
import { type Count, type DeckEntry, type Patterns, proportion, typeKey } from "./patterns.ts";

export type Verdict = "following" | "slightly different" | "very different" | "not enough data";

export interface PositionVerdict {
  position: number;
  imageId: string;
  ours: {
    type: string;
    layer: boolean;
    proportion: string;
    maskColour: string | null;
    /** Pixel orientation, ratio and layer structure (absent in reports saved before 2026-10-30). */
    canvas?: string;
    ratio?: string;
    layerStructure?: string;
  };
  verdict: Verdict;
  reasons: string[];
  /** The engine's directive here (engine/position-note.ts), first in the reasons too. */
  directive?: {
    kind: "copy" | "drop" | "change" | "review";
    /** The engine directive ids behind it (absent before 2026-10-31). */
    ids?: string[];
    text: string;
    details: string[];
    orientation: string;
    /** False: the whole image is the marketing layer (built as art). */
    screenshotLayer: boolean;
  };
}

/** The word shown for a position: the directive when there is one, else the verdict. */
export const positionWord = (v: Pick<PositionVerdict, "verdict" | "directive">) =>
  v.directive ? DIRECTIVE_WORD[v.directive.kind] : v.verdict;

export const DIRECTIVE_WORD = {
  copy: "Copy the pattern",
  drop: "Drop",
  change: "Change",
  review: "Needs review",
} as const;

/** At least this many competitor screenshots at a position before judging it. */
export const MIN_AT_POSITION = 2;

/** The value most competitors share at a position: more than half of the `n` images there. */
const most = (xs: readonly Count[] | undefined, n: number): Count | null => {
  const top = xs?.[0];
  return top && top.n * 2 > n && top.n !== xs?.[1]?.n ? top : null;
};

/**
 * Our image at one position against the competitors' images there, by code. Every concrete
 * difference is listed (category, orientation, size, layer structure, logo, focus); "following"
 * only when none of the main ones differs.
 */
export function positionVerdict(e: DeckEntry, p: Patterns, label: Labeler): PositionVerdict {
  const a = e.final;
  const type = typeKey(a);
  const mask = a.marketingLayer.backgroundMasks[0];
  const layers = layerStructure(a);
  const ours = {
    type,
    layer: a.marketingLayer.present,
    proportion: proportion(a),
    maskColour: mask ? colourFamily(mask.colourName, mask.colourHex) : null,
    canvas: e.canvas,
    ...(e.ratio ? { ratio: e.ratio } : {}),
    layerStructure: layers,
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
  const n = at.n;
  const of = (c: Count) => `${c.n} of ${n} competitors`;
  const lower = (k: string) => label(k).toLowerCase();
  const reasons: string[] = [];
  const mine = at.types.find((t) => t.key === type);
  // Same type only when ours is the most common one here (the old 25% minority rule is gone:
  // 2 of 8 is "different (minority)", plan-recommendation-engine 7).
  const sameType = at.top.key === type && at.top.n !== at.types[1]?.n;
  let major = 0;
  let minor = 0;
  if (sameType) {
    reasons.push(
      `${label(type)}: ${mine?.n ?? 0} of ${n} competitors at image ${e.position}${at.top.key === type ? "" : ` (most common: ${label(at.top.key)}, ${at.top.n} of ${n})`}`,
    );
  } else {
    reasons.push(
      `category: ${of(at.top)} show ${label(at.top.key)} at image ${e.position}; ours is ${label(type)}`,
    );
  }
  const canvas = most(at.canvases, n);
  const ratio = most(at.ratios, n);
  const size = most(at.sizes, n);
  const theirDims = [size?.key, ratio?.key].filter(Boolean).join(", ");
  const ourDims = [e.size, e.ratio].filter(Boolean).join(", ");
  // Any listed difference (size, logo, focus) means "not following", even alone.
  let listed = 0;
  if (canvas && canvas.key !== e.canvas) {
    major++;
    reasons.push(
      `orientation: ${of(canvas)} use a ${canvas.key} image${theirDims ? ` (${theirDims})` : ""} here; ours is ${e.canvas}${ourDims ? ` (${ourDims})` : ""}`,
    );
  } else if (ratio && e.ratio && ratio.key !== e.ratio) {
    listed++;
    reasons.push(`aspect: ${of(ratio)} use ${theirDims} here; ours is ${ourDims}`);
  } else if (size && e.size && size.key !== e.size) {
    // Same shape, other resolution: shown, but the store scales it, so it is not a difference.
    reasons.push(`size: ${of(size)} upload ${size.key} here; ours is ${e.size} (same shape)`);
  }
  const layer = most(at.layers, n);
  if (layer && layer.key !== layers) {
    major++;
    reasons.push(`layer structure: ${of(layer)} are ${lower(layer.key)}; ours is ${lower(layers)}`);
  }
  const logos = p.tags?.logoPerPosition.find((x) => x.position === e.position);
  const ourLogo = showsLogo(a, e.name);
  if (logos && logos.of === n && logos.n * 2 !== n && logos.n * 2 > n !== ourLogo) {
    listed++;
    const k = ourLogo ? n - logos.n : logos.n;
    reasons.push(
      `logo: ${k} of ${n} competitors ${ourLogo ? "do not show" : "show"} the game logo here; ours ${ourLogo ? "does" : "does not"}`,
    );
  }
  const focus = most(at.focuses, n);
  if (focus && e.focus && focus.key !== e.focus) {
    listed++;
    reasons.push(`focus: ${of(focus)} highlight ${focus.key}; ours highlights ${e.focus}`);
  }
  let verdict: Verdict;
  if (!sameType) {
    const near = p.perPosition
      .filter((x) => Math.abs(x.position - e.position) === 1)
      .some((x) => x.types.some((t) => t.key === type));
    const overall = p.screenTypes.find((t) => t.key === type);
    const common = !!overall && overall.images / Math.max(1, p.images) >= 0.1;
    reasons.push(
      `${label(type)} ${near ? "appears at a neighbouring position" : common ? "appears elsewhere in their decks" : "is rare or unused in their decks"}`,
    );
    verdict = (near || common) && !major ? "slightly different" : "very different";
  } else {
    if (ours.layer !== at.layerShare >= 0.5) {
      minor++;
      reasons.push(
        `marketing layer ${ours.layer ? "present" : "absent"}; ${Math.round(at.layerShare * n)} of ${n} competitors have one at this image`,
      );
    }
    const topProp = at.proportions[0];
    if (topProp && topProp.key !== ours.proportion) {
      minor++;
      reasons.push(`layout "${ours.proportion}"; competitors here mostly use "${topProp.key}"`);
    }
    verdict =
      major >= 2
        ? "very different"
        : major || listed || minor >= 2
          ? "slightly different"
          : "following";
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
  return { position: e.position, imageId: e.imageId, ours, verdict, reasons };
}
