import { z } from "zod";
import type { Taxonomy } from "../config/load.ts";
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

/** One recommendation per position, 1..N with no gaps, N within the allowed deck length. */
export function recommendationProblems(
  r: Recommendations,
  minLen: number,
  maxLen: number,
): string[] {
  const problems: string[] = [];
  const pos = r.positions.map((p) => p.position);
  const n = pos.length;
  if (n < minLen || n > maxLen)
    problems.push(`recommend between ${minLen} and ${maxLen} positions (got ${n})`);
  const want = Array.from({ length: n }, (_, i) => i + 1).join(",");
  if ([...pos].sort((a, b) => a - b).join(",") !== want)
    problems.push("positions must be 1, 2, 3 ... with no gaps or repeats");
  for (const p of r.positions) {
    if (p.marketingLayer.present && !p.marketingLayer.texts.length)
      problems.push(`position ${p.position}: a marketing layer needs at least one text`);
  }
  return problems;
}
