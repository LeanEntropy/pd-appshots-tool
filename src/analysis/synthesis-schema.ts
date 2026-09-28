import { z } from "zod";
import type { Taxonomy } from "../config/load.ts";
import { artWording } from "./art-wording.ts";
import { PROPORTION } from "./patterns.ts";

/** Pattern interpretation (Opus): words only; every number comes from the computed patterns. */
export const interpretationSchema = z.strictObject({
  summary: z.string().describe("5-8 sentences: what the competitors' decks have in common"),
  keyPatterns: z.array(
    z.strictObject({
      pattern: z.string(),
      evidence: z.string().describe("the numbers from the computed patterns that show it"),
      strength: z.enum(["strong", "moderate", "weak"]),
    }),
  ),
  oursSummary: z
    .string()
    .describe("3-5 sentences: how our deck compares, using the computed verdicts"),
  verdictText: z.string().describe("2-3 sentences stating the computed overall verdict and why"),
  shortAnswer: z
    .string()
    .describe(
      "3-5 sentences for the top of the report: how our store page stands (with the exact computed verdict word) and the single most important change",
    ),
  keyPoints: z
    .array(z.string())
    .describe("one actionable sentence per computed key point, same order and count"),
});
export type Interpretation = z.infer<typeof interpretationSchema>;

const proportions = Object.values(PROPORTION) as [string, ...string[]];

export function recommendationSchema(taxonomy: Taxonomy) {
  const types = taxonomy.screenTypes.map((t) => t.id) as [string, ...string[]];
  return z.strictObject({
    rationale: z.string().describe("why this order, in 3-6 sentences"),
    positions: z.array(
      z.strictObject({
        position: z.number().int(),
        screenType: z.enum(types),
        subtype: z.string(),
        source: z
          .string()
          .describe('"keep our current position N", "recapture our position N", or "new capture"'),
        screenshot: z.strictObject({
          orientation: z.enum(["portrait", "landscape"]),
          whatToCapture: z.string().describe("the exact in-game screen and moment to capture"),
          action: z.string(),
          atmosphere: z.string(),
          mainColours: z.string(),
        }),
        marketingLayer: z.strictObject({
          present: z.boolean(),
          proportion: z.enum(proportions),
          backgroundMask: z.strictObject({
            shape: z.string(),
            colour: z.string().describe("colour name and hex"),
            location: z.string(),
          }),
          texts: z.array(
            z.strictObject({
              role: z.enum(["headline", "subheadline", "label", "badge"]),
              text: z.string().describe("the exact English text to use"),
              colour: z.string(),
              strokeColour: z.string(),
              fontStyle: z.string(),
              size: z.enum(["small", "medium", "large", "huge"]),
              position: z.enum(["top", "upper_middle", "middle", "lower_middle", "bottom"]),
            }),
          ),
          elements: z.array(
            z.strictObject({
              what: z.string(),
              position: z.string(),
              pose: z.string(),
              colour: z.string(),
            }),
          ),
        }),
        why: z.string().describe("which pattern this follows or deliberately breaks, and why"),
      }),
    ),
  });
}
export type Recommendations = z.infer<ReturnType<typeof recommendationSchema>>;

export const reviewSchema = z.strictObject({
  verdict: z.enum(["ok", "changes"]),
  findings: z.array(
    z.strictObject({
      position: z.number().int().describe("the position concerned, or 0 for the whole deck"),
      severity: z.enum(["major", "minor"]),
      issue: z.string(),
      suggestion: z.string(),
    }),
  ),
});
export type Review = z.infer<typeof reviewSchema>;

/** Screen types made as art from existing assets (a recaptured in-game screen is never one). */
const ART_ONLY = new Set(["feature_image", "key_art"]);

/** One recommendation per position, 1..N with no gaps, within the deck length; labels match specs. */
export function recommendationProblems(
  r: Recommendations,
  minLen: number,
  maxLen: number,
  ours: ReadonlyMap<number, string> = new Map(),
): string[] {
  const problems: string[] = [];
  const pos = r.positions.map((p) => p.position);
  const n = pos.length;
  if (n < minLen || n > maxLen)
    problems.push(`recommend between ${minLen} and ${maxLen} positions (got ${n})`);
  const want = Array.from({ length: n }, (_, i) => i + 1).join(",");
  if ([...pos].sort((a, b) => a - b).join(",") !== want)
    problems.push("positions must be 1, 2, 3 ... with no gaps or repeats");
  for (const p of r.positions)
    if (p.marketingLayer.present && !p.marketingLayer.texts.length)
      problems.push(`position ${p.position}: a marketing layer needs at least one text`);
  return [...problems, ...labelProblems(r, ours)];
}

/**
 * Each slot's label must match its spec (by code): a kept screenshot keeps its screen type and
 * must exist, a recaptured in-game screen is not labelled as art-only, and an in-game screen type
 * shows a screenshot (a title image counts as the in-game title screen).
 */
export function labelProblems(r: Recommendations, ours: ReadonlyMap<number, string>): string[] {
  const problems: string[] = [];
  for (const p of r.positions) {
    const at = `position ${p.position} is labelled ${p.screenType}`;
    const keep = /keep our current position (\d+)/i.exec(p.source);
    const recap = /recapture our position (\d+)/i.exec(p.source);
    const n = Number((keep ?? recap)?.[1]);
    const was = ours.get(n);
    if ((keep || recap) && ours.size && !ours.has(n))
      problems.push(`position ${p.position}: our deck has no position ${n} to keep or recapture`);
    if (keep && was && was !== p.screenType)
      problems.push(
        `${at}, but it keeps our position ${keep[1]}, which is ${was}: use that screen type or change the source`,
      );
    if (recap && ART_ONLY.has(p.screenType))
      problems.push(
        `${at}, but its source recaptures an in-game screen (our position ${recap[1]}${was ? `, ${was}` : ""}): label it with that screen's type, or make it art built from existing assets`,
      );
    if (
      !ART_ONLY.has(p.screenType) &&
      artWording(p.marketingLayer.proportion) === PROPORTION.art &&
      p.screenType !== "title_image" &&
      p.screenType !== "loading_screen"
    )
      problems.push(
        `${at}, an in-game screen, but its layout is ${PROPORTION.art}: use a layout that shows that screen`,
      );
  }
  return problems;
}
