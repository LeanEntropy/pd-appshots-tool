import { z } from "zod";
import { isEventLine } from "./image-tags.ts";

/**
 * Country advice (plan-reports 3, point 6): per country other than the main one, the deck to
 * use there, written by Opus as a store-page CMO from the main country's recommendations, that
 * country's patterns, the competitors' localisation habits, their local texts and the words they
 * use. Every object strict, every field required (Claude and OpenAI structured output).
 */
export const COUNTRY_ADVICE_SCHEMA = "country-advice-schema.v1";

const Impact = z.enum(["small", "medium", "large"]);

export const countryAdviceSchema = z.strictObject({
  shortAnswer: z
    .string()
    .describe("2 to 4 sentences: the bottom line for this country, most important change first"),
  actions: z
    .array(
      z.strictObject({
        action: z.string().describe("one concrete change, e.g. translate the headline of image 1"),
        why: z.string().describe("the evidence in words, with its counts"),
        evidence: z.array(z.string()).describe("the fact ids this rests on (C1, C2 ...)"),
        positions: z.array(z.number().int()).describe("the positions it changes; empty = all"),
        impact: Impact,
      }),
    )
    .describe("2 to 5 changes for this country, most important first"),
  deck: z
    .array(
      z.strictObject({
        position: z.number().int(),
        fromMainPosition: z
          .number()
          .int()
          .describe(
            "the position in the main country's recommended deck this image follows; 0 = new",
          ),
        change: z
          .enum(["same", "translate", "reword", "recapture", "new-picture", "moved"])
          .describe("recapture: capture the screen again as the main deck says, with local text"),
        screen: z.string().describe("the in-game screen to capture (usually as in the main deck)"),
        headline: z.string().describe("the exact headline in the local language, or empty"),
        backTranslation: z.string().describe("a literal English back-translation, or empty"),
        subline: z.string().describe("a second line in the local language, or empty"),
        band: z
          .string()
          .describe("band shape, plain colour name (hex in brackets) and place; or none"),
        logo: z.strictObject({ show: z.boolean(), why: z.string() }),
        wordingNotes: z.string().describe("genre words and tone for this line, or empty"),
        why: z.string(),
      }),
    )
    .describe("the whole deck for this country in store order, 1..N"),
  terms: z
    .array(
      z.strictObject({
        concept: z.string().describe("the idea in English, e.g. battle"),
        use: z.string().describe("the local word to use, exactly"),
        // Answers saved before this field read as "" (their cache keys do not change).
        meaning: z
          .preprocess((v) => v ?? "", z.string())
          .describe(
            'the word\'s literal English meaning, then its reading in Latin letters when the script is not Latin, e.g. "adventure (bouken)"',
          ),
        avoid: z.string().describe("a local word to avoid, or empty"),
        why: z.string(),
      }),
    )
    .describe("the words to use in this country, from the words-used table"),
  keepFromMain: z.string().describe("what stays exactly as on the main country's page"),
});
export type CountryAdvice = z.infer<typeof countryAdviceSchema>;

export interface AdviceRules {
  /** The fact ids given to the model. */
  facts: ReadonlySet<string>;
  /** Allowed deck length (the competitors' range here, widened to include ours). */
  length: { min: number; max: number };
  /** Length of the main country's recommended deck (0 when none). */
  baseLength: number;
}

/** Plain problems of an answer (the model repairs them once; code never invents a fix). */
export function adviceProblems(a: CountryAdvice, r: AdviceRules): string[] {
  const out: string[] = [];
  const n = a.deck.length;
  const pos = a.deck.map((d) => d.position).sort((x, y) => x - y);
  if (pos.join(",") !== Array.from({ length: n }, (_, i) => i + 1).join(","))
    out.push("the deck's positions must be 1, 2, 3 ... with no gaps or repeats");
  if (n < r.length.min || n > r.length.max)
    out.push(`the deck must have ${r.length.min} to ${r.length.max} images (it has ${n})`);
  // With no computed gap at all there is nothing to act on: no action is invented.
  const least = r.facts.size ? 1 : 0;
  if (a.actions.length < least || a.actions.length > 5) out.push(`give ${least} to 5 actions`);
  for (const [i, x] of a.actions.entries()) {
    if (!x.evidence.length) out.push(`action ${i + 1} cites no fact`);
    for (const id of x.evidence)
      if (!r.facts.has(id)) out.push(`action ${i + 1} cites ${id}, which is not a given fact`);
    for (const p of x.positions)
      if (p < 1 || p > n) out.push(`action ${i + 1} names position ${p}, outside the deck`);
  }
  for (const d of a.deck) {
    if (d.fromMainPosition < 0 || d.fromMainPosition > r.baseLength)
      out.push(`position ${d.position}: fromMainPosition must be 0 to ${r.baseLength}`);
    if (d.headline && isEventLine(d.headline))
      out.push(
        `position ${d.position}: "${d.headline}" is an event or offer line; use a lasting one`,
      );
    if (d.headline && !d.backTranslation.trim())
      out.push(`position ${d.position}: give the back-translation of the headline`);
  }
  if (!a.shortAnswer.trim()) out.push("write the short answer");
  return out;
}

/** The fact ids an action cites, removed from any text the user reads ("(C3)" or "C1, C2"). */
export const noFactIds = (s: string) =>
  s
    .replace(/\s*\((?:facts? )?C\d+(?:\s*(?:,|and)\s*C\d+)*\)/g, "")
    .replace(/\b(?:facts? )?C\d+(?:(?:\s*,\s*|\s+and\s+)C\d+)*\b/g, "this evidence");
