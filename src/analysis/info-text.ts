import type { ImageFacts } from "./image-facts.ts";
import { humanise } from "./labels.ts";
import type { AnalysisRecord } from "./records.ts";
import type { ImageAnalysis } from "./schema.ts";

/** Screen types that are art rather than an in-game screen: "no capture" is expected there. */
export const ART_TYPES = new Set(["title_image", "feature_image", "key_art"]);

/** "Portrait, 1242 × 2208 (9:16)": always from the pixels. */
export function imageLine(f: ImageFacts | null | undefined): string | null {
  if (!f) return null;
  return `${humanise(f.orientation)}, ${f.width} × ${f.height} (${f.ratio})`;
}

const FRAMING: Record<string, string> = {
  full_bleed: "fills the image",
  device_frame: "in a phone frame",
  rounded_card: "on a rounded card",
  plain_box: "in a box",
  tilted: "tilted",
  cutout: "cut out",
  other: "",
};

export const COMPOSITION: Record<string, string> = {
  single_full_capture: "One in-game screenshot filling the image",
  capture_in_marketing_art: "An in-game screenshot inside marketing art",
  multiple_captures: "Several in-game screenshots in one image",
  pure_art: "Art only, no in-game screenshot",
};

/**
 * Each in-game capture in plain words: type, its orientation only when it differs from the
 * image's, framing and share. Empty for pure art (nothing worth saying); ["none"] when a screen
 * that should show gameplay has no capture.
 */
export function captureLines(
  a: ImageAnalysis,
  f: ImageFacts | null | undefined,
  label: (code: string) => string = humanise,
): string[] {
  const s = a.screenshot;
  if (!s.captures.length)
    return s.composition === "pure_art" || ART_TYPES.has(s.screenType) ? [] : ["none"];
  return s.captures.map((c) => {
    const parts = [
      c.subtype ? `${label(c.screenType)} / ${label(c.subtype)}` : label(c.screenType),
    ];
    if (f && c.orientation !== f.orientation)
      parts.push(`${c.orientation} (the image is ${f.orientation})`);
    const framing = FRAMING[c.framing] ?? "";
    if (framing) parts.push(framing);
    parts.push(`${Math.round(c.areaPercent)}% of the image`);
    return parts.join(", ");
  });
}

export const TOOL_BUG = /--json-schema is not valid JSON/;

/** Plain message for a record without a usable analysis; the technical error goes to details. */
export function pendingMessage(r: AnalysisRecord): string {
  const cause = r.problems.some((p) => TOOL_BUG.test(p)) ? " (a tool bug, since fixed)" : "";
  if (r.status === "failed")
    return `Not analysed yet. An earlier attempt failed${cause}. It will be analysed in the next run.`;
  if (r.status === "unreviewed")
    return "Not finished yet: the second opinion could not be read. It will be analysed again in the next run.";
  if (r.status === "disputed")
    return "Not finished yet: the two readings disagreed and were not settled. It will be analysed again in the next run.";
  return "Analysed with an older version of the tool. It will be analysed again in the next run.";
}
