import { z } from "zod";

/**
 * Image attributes the engine compares beyond the category (plan 5.1, decision D6): board
 * density, a visible game interface (HUD), people or hands, and a device in the scene. New
 * analyses write them at the end of their notes (full-analysis.v12 / lean v13, wording only:
 * the answer shape is unchanged, so saved analyses stay valid). Older analyses lack them until
 * the approval-gated backfill (attributes-backfill.ts) reads them; then they are "not measured".
 */
export const BOARD_DENSITY = ["sparse", "medium", "full"] as const;
export const PEOPLE = ["none", "hands", "person"] as const;

export interface ImageAttributes {
  boardDensity: (typeof BOARD_DENSITY)[number] | null;
  hudVisible: boolean | null;
  people: (typeof PEOPLE)[number] | null;
  deviceInScene: boolean | null;
  /** Whether the headline says what the screenshot shows (from the saved layout). */
  focusMatch?: "match" | "partial" | "mismatch" | null;
  /** Where the values come from. */
  from: string[];
}

export const NOT_MEASURED: ImageAttributes = {
  boardDensity: null,
  hudVisible: null,
  people: null,
  deviceInScene: null,
  from: [],
};

/** The answer of the backfill call (its own small step; saved per image). */
export const attributesAnswerSchema = z.strictObject({
  boardDensity: z
    .enum(["sparse", "medium", "full", "n/a"])
    .describe("how much of the play area the game board or tiles fill; n/a without a board"),
  hudVisible: z.boolean().describe("the game's own interface (buttons, bars, counters) is visible"),
  people: z.enum(PEOPLE).describe("real or drawn people in a real-life scene, or only hands"),
  deviceInScene: z.boolean().describe("a phone or tablet is shown inside a scene"),
});
export type AttributesAnswer = z.infer<typeof attributesAnswerSchema>;

export function fromAnswer(a: AttributesAnswer): ImageAttributes {
  return {
    boardDensity: a.boardDensity === "n/a" ? null : a.boardDensity,
    hudVisible: a.hudVisible,
    people: a.people,
    deviceInScene: a.deviceInScene,
    from: ["backfill"],
  };
}

const LINE = /attributes:\s*([^\n]+)/i;

/**
 * The attributes a v12 analysis writes at the end of its notes, e.g. "Attributes: board density
 * full; HUD no; people none; device in scene no". Anything unreadable stays not measured.
 */
export function attributesFromNotes(notes: string): ImageAttributes | null {
  const m = LINE.exec(notes);
  if (!m?.[1]) return null;
  const part = (re: RegExp) => re.exec(m[1] as string)?.[1]?.toLowerCase() ?? null;
  const density = part(/board density\s*[:=]?\s*(sparse|medium|full|n\/a)/i);
  const hud = part(/hud\s*[:=]?\s*(yes|no)/i);
  const people = part(/people\s*[:=]?\s*(none|hands|person)/i);
  const device = part(/device in scene\s*[:=]?\s*(yes|no)/i);
  if (!density && !hud && !people && !device) return null;
  return {
    boardDensity:
      density && density !== "n/a" ? (density as ImageAttributes["boardDensity"]) : null,
    hudVisible: hud ? hud === "yes" : null,
    people: (people as ImageAttributes["people"]) ?? null,
    deviceInScene: device ? device === "yes" : null,
    from: ["analysis"],
  };
}

/** The first known value of each field, in the order given (analysis, backfill, layout). */
export function mergeAttributes(
  ...xs: (Partial<ImageAttributes> | null | undefined)[]
): ImageAttributes {
  const out: ImageAttributes = { ...NOT_MEASURED, from: [] };
  for (const x of xs) {
    if (!x) continue;
    let used = false;
    for (const k of [
      "boardDensity",
      "hudVisible",
      "people",
      "deviceInScene",
      "focusMatch",
    ] as const)
      if (out[k] == null && x[k] != null) {
        (out as unknown as Record<string, unknown>)[k] = x[k];
        used = true;
      }
    if (used) out.from.push(...(x.from ?? []));
  }
  return out;
}
