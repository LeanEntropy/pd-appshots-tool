import type { Taxonomy } from "../config/load.ts";
import { type CallContext, validatedCall } from "./call.ts";
import type { OursVsPatterns } from "./ours-vs.ts";
import { type DeckEntry, type Patterns, proportion } from "./patterns.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";
import {
  type Interpretation,
  interpretationSchema,
  type Recommendations,
  type Review,
  recommendationProblems,
  recommendationSchema,
  reviewSchema,
} from "./synthesis-schema.ts";

export interface SynthesisDeps {
  writer: Provider;
  reviewer: Provider | null;
  prompts: { patterns: RenderedPrompt; recommend: RenderedPrompt; review: RenderedPrompt };
}

export interface SynthesisResult {
  interpretation: Interpretation | null;
  recommendations: Recommendations | null;
  /** The first draft, when a review asked for changes and it was revised. */
  draft: Recommendations | null;
  review: Review | null;
  problems: string[];
}

/** One line per screenshot, both layers, for text-only prompts. */
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
  return `${e.name} #${e.position}: ${s.screenType}${s.subtype ? `/${s.subtype}` : ""}, ${e.canvas} image, capture ${s.orientation} ${s.captureAreaPercent}%, ${s.description} Action: ${s.action} Mood: ${s.atmosphere}. Colours: ${colours(s.mainColours)}. ${layer}`;
}

/**
 * Pattern interpretation, recommendations, cross-family review and (on major findings) one
 * revision. Each call is cached by its full input, so the same data never pays twice.
 */
export async function synthesise(
  deps: SynthesisDeps,
  taxonomy: Taxonomy,
  input: {
    patterns: Patterns;
    oursVs: OursVsPatterns;
    ours: readonly DeckEntry[];
    competitors: readonly DeckEntry[];
    ourDeckLength: number;
  },
  ctx: CallContext,
  report: (phase: string, message: string) => void,
): Promise<SynthesisResult> {
  const out: SynthesisResult = {
    interpretation: null,
    recommendations: null,
    draft: null,
    review: null,
    problems: [],
  };
  const facts = [
    `Computed patterns (JSON):\n${JSON.stringify(input.patterns)}`,
    `Our deck vs the patterns, computed (JSON):\n${JSON.stringify(input.oursVs)}`,
  ].join("\n\n");
  report("patterns", "Finding patterns…");
  const interp = await validatedCall(
    "patterns",
    deps.writer,
    deps.prompts.patterns,
    `Interpret these computed patterns.\n\n${facts}`,
    [],
    interpretationSchema,
    () => [],
    ctx,
  );
  out.interpretation = interp.value;
  if (!interp.value) out.problems.push(`pattern summary: ${interp.problems.join("; ")}`);

  const minLen = Math.max(1, Math.min(input.ourDeckLength, input.patterns.deckLength.min || 1));
  const maxLen = Math.max(input.ourDeckLength, input.patterns.deckLength.max, minLen);
  const context = [
    facts,
    `Interpretation:\n${JSON.stringify(out.interpretation)}`,
    `Our current screenshots, in store order:\n${input.ours.map(brief).join("\n")}`,
    `Competitors' screenshots, in store order:\n${input.competitors.map(brief).join("\n")}`,
    `Recommend between ${minLen} and ${maxLen} positions (our current deck has ${input.ourDeckLength}).`,
  ].join("\n\n");
  const schema = recommendationSchema(taxonomy);
  const check = (v: Recommendations) => recommendationProblems(v, minLen, maxLen);
  report("recommend", "Writing recommendations…");
  const rec = await validatedCall(
    "recommend",
    deps.writer,
    deps.prompts.recommend,
    `Write the recommendations.\n\n${context}`,
    [],
    schema,
    check,
    ctx,
  );
  out.recommendations = rec.value;
  if (!rec.value) {
    out.problems.push(`recommendations: ${rec.problems.join("; ")}`);
    return out;
  }
  if (!deps.reviewer) return out;
  report("recommend-review", "Checking recommendations…");
  const facts2 = `${facts}\n\nOur current screenshots:\n${input.ours.map(brief).join("\n")}`;
  const rev = await validatedCall(
    "recommend-review",
    deps.reviewer,
    deps.prompts.review,
    `Review these recommendations.\n\n${facts2}\n\nRecommendations (JSON):\n${JSON.stringify(rec.value)}`,
    [],
    reviewSchema,
    () => [],
    ctx,
  );
  out.review = rev.value;
  if (!rev.value) {
    out.problems.push(`recommendation review: ${rev.problems.join("; ")}`);
    return out;
  }
  const major = rev.value.findings.filter((f) => f.severity === "major");
  if (!major.length) return out;
  report("recommend-revise", "Revising recommendations after the review…");
  const findings = major
    .map((f) => `- position ${f.position || "all"}: ${f.issue} Suggestion: ${f.suggestion}`)
    .join("\n");
  const revised = await validatedCall(
    "recommend-revise",
    deps.writer,
    deps.prompts.recommend,
    `Revise your recommendations. A reviewer found these major problems; fix them where they are right, keep the rest.\n${findings}\n\nYour first version (JSON):\n${JSON.stringify(rec.value)}\n\n${context}`,
    [],
    schema,
    check,
    ctx,
  );
  if (revised.value) {
    out.draft = rec.value;
    out.recommendations = revised.value;
  } else out.problems.push(`revision: ${revised.problems.join("; ")}`);
  return out;
}
