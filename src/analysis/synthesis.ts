import type { z } from "zod";
import { type Store, storeFacts } from "../appstore/store-prompts.ts";
import type { Taxonomy } from "../config/load.ts";
import type { EngineResult } from "../engine/engine.ts";
import { engineFacts } from "../engine/facts.ts";
import { claimProblems, recTexts, skeletonProblems } from "../engine/validate.ts";
import type { KbRecord } from "../kb/step.ts";
import { patternsKb, recommendKb, reviewKb, type SynthesisKb, withKbMarks } from "../kb/step-io.ts";
import { type KbOpts, kbPart } from "../kb/synthesis-kb.ts";
import { type AbTestsInput, writeAbTests } from "./ab-tests.ts";
import type { AbTestsOutput } from "./ab-tests-schema.ts";
import { type CallContext, cachedAnswer, validatedCall } from "./call.ts";
import { CATEGORIES, HOW_WE_SORT, LAYER_TAGS, TAGS } from "./categories.ts";
import type { OursVsPatterns } from "./ours-vs.ts";
import type { FitSummary } from "./pattern-fit.ts";
import type { DeckEntry, Patterns } from "./patterns.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";
import { brief } from "./synthesis-brief.ts";
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
  /** The A/B tests writer (Opus, text only) and its prompt; none = the tests are written by code. */
  ab?: { writer: Provider; prompt: RenderedPrompt } | null;
}

export { brief } from "./synthesis-brief.ts";

type AbFacts = Omit<AbTestsInput, "ours" | "brief" | "recommendations">;

export interface SynthesisResult {
  interpretation: Interpretation | null;
  recommendations: Recommendations | null;
  /** The first draft, when a review asked for changes and it was revised. */
  draft: Recommendations | null;
  review: Review | null;
  /** The AI's A/B tests as written (checked again when the report is built). */
  abTests: AbTestsOutput | null;
  problems: string[];
  /** What each step cited from the knowledge base (all null when its Settings switch is off). */
  kb: SynthesisKb;
}
/**
 * Pattern interpretation, recommendations, cross-family review and (on major findings) one
 * revision, then the A/B tests to run next. Each call is cached by its full input, so the same
 * data never pays twice.
 */
export async function synthesise(
  deps: SynthesisDeps,
  taxonomy: Taxonomy,
  input: Parameters<typeof writeAndReview>[2] & { ab?: AbFacts },
  ctx: CallContext,
  report: (phase: string, message: string) => void,
): Promise<SynthesisResult> {
  const out = await writeAndReview(deps, taxonomy, input, ctx, report);
  if (!deps.ab || !input.ab?.evidence.length) return withKbMarks(out, ctx.kb);
  report("ab-tests", "Writing the A/B tests…");
  const ab = await writeAbTests(
    deps.ab.writer,
    deps.ab.prompt,
    { ...input.ab, ours: input.ours, brief, recommendations: out.recommendations },
    ctx,
  );
  out.abTests = ab.value;
  out.kb.abTests = ab.record;
  if (!ab.value) out.problems.push(`A/B tests: ${ab.problems.join("; ")}`);
  return withKbMarks(out, ctx.kb);
}

async function writeAndReview(
  deps: SynthesisDeps,
  taxonomy: Taxonomy,
  input: {
    patterns: Patterns;
    oursVs: OursVsPatterns;
    fit: FitSummary;
    ours: readonly DeckEntry[];
    competitors: readonly DeckEntry[];
    ourDeckLength: number;
    store?: Store;
    /** The engine's skeleton and directives (hard input; checked after the AI). */
    engine?: EngineResult | null;
  },
  ctx: CallContext,
  report: (phase: string, message: string) => void,
): Promise<SynthesisResult> {
  const out: SynthesisResult = {
    interpretation: null,
    recommendations: null,
    draft: null,
    review: null,
    abTests: null,
    problems: [],
    kb: { interpretation: null, recommendations: null, abTests: null },
  };
  const facts = [
    `How we sort images, and the plain name and definition of every screen category and tag code below (write the plain names, never the codes):\n${HOW_WE_SORT.join(" ")}\n${JSON.stringify(Object.values({ ...CATEGORIES, ...TAGS, ...LAYER_TAGS }))}`,
    `Computed patterns (JSON):\n${JSON.stringify(input.patterns)}`,
    `${engineFacts(input.engine)}Our deck vs the patterns, computed (JSON):\n${JSON.stringify(input.oursVs)}`,
    `Pattern check, computed (JSON): verdict, key points in priority order, and every pattern with whether we fit:\n${JSON.stringify(input.fit, (k, v) => (k === "basis" ? undefined : v))}`,
    ...storeFacts(input.store),
  ].join("\n\n");
  report("patterns", "Finding patterns…");
  const interp = await textStep(
    "patterns",
    deps.writer,
    deps.prompts.patterns,
    {
      now: `${facts}\n\nInterpret these computed patterns.`,
      before: `Interpret these computed patterns.\n\n${facts}`,
    },
    interpretationSchema,
    (v) =>
      v.keyPoints.length === input.fit.keyPoints.length
        ? []
        : [
            `keyPoints must have exactly ${input.fit.keyPoints.length} items, one per computed key point`,
          ],
    ctx,
    patternsKb(input.fit),
  );
  out.interpretation = interp.value;
  out.kb.interpretation = interp.record ?? null;
  if (!interp.value) out.problems.push(`pattern summary: ${interp.problems.join("; ")}`);

  // The engine's skeleton sets the length: never shorter than its target (plan 5.6-6).
  const minLen = Math.max(
    1,
    Math.min(input.ourDeckLength, input.patterns.deckLength.min || 1),
    input.engine?.skeleton.length ?? 0,
  );
  const maxLen = Math.max(
    input.ourDeckLength,
    input.patterns.deckLength.max,
    minLen,
    input.engine?.skeleton.length ?? 0,
  );
  const interpretation = `Interpretation:\n${JSON.stringify(out.interpretation)}`;
  const lines = [
    `Our current screenshots, in store order:\n${input.ours.map(brief).join("\n")}`,
    `Competitors' screenshots, in store order:\n${input.competitors.map(brief).join("\n")}`,
  ];
  const range = `Recommend between ${minLen} and ${maxLen} positions (our current deck has ${input.ourDeckLength}).`;
  // Facts and screenshot lines first (shared by the recommendation and its revision, so the
  // revision reads them from the prompt cache), the step's own material and instruction last.
  const context = [facts, ...lines, interpretation, range].join("\n\n");
  const contextBefore = [facts, interpretation, ...lines, range].join("\n\n");
  const schema = recommendationSchema(taxonomy);
  const oursTypes = new Map(input.ours.map((e) => [e.position, e.final.screenshot.screenType]));
  const ourCanvas = input.ours[0]?.canvas ?? "portrait";
  const check = (v: Recommendations) =>
    recommendationProblems(v, minLen, maxLen, oursTypes, input.store);
  // The skeleton and the counts: one revision when they fail, then shown as problems (5.6).
  const e = input.engine;
  const soft = (v: Recommendations) =>
    e ? [...skeletonProblems(v, e, ourCanvas), ...claimProblems(recTexts(v), e.claims)] : [];
  report("recommend", "Writing recommendations…");
  const rec = await textStep(
    "recommend",
    deps.writer,
    deps.prompts.recommend,
    {
      now: `${context}\n\nWrite the recommendations.`,
      before: `Write the recommendations.\n\n${contextBefore}`,
    },
    schema,
    check,
    ctx,
    recommendKb(input.fit),
  );
  out.recommendations = rec.value;
  out.kb.recommendations = rec.record ?? null;
  if (!rec.value) {
    out.problems.push(`recommendations: ${rec.problems.join("; ")}`);
    return out;
  }
  if (!deps.reviewer) return revise(soft(rec.value).map((p) => `- ${p}`));
  report("recommend-review", "Checking recommendations…");
  const facts2 = `${facts}\n\nOur current screenshots:\n${input.ours.map(brief).join("\n")}`;
  const recJson = `Recommendations (JSON):\n${JSON.stringify(rec.value)}`;
  const rev = await textStep(
    "recommend-review",
    deps.reviewer,
    deps.prompts.review,
    {
      now: `${facts2}\n\n${recJson}\n\nReview these recommendations.`,
      before: `Review these recommendations.\n\n${facts2}\n\n${recJson}`,
    },
    reviewSchema,
    () => [],
    ctx,
    reviewKb(input.fit),
  );
  out.review = rev.value;
  if (!rev.value) out.problems.push(`recommendation review: ${rev.problems.join("; ")}`);
  const major = (rev.value?.findings ?? []).filter((f) => f.severity === "major");
  return revise([
    ...soft(rec.value).map((p) => `- ${p}`),
    ...major.map(
      (f) => `- position ${f.position || "all"}: ${f.issue} Suggestion: ${f.suggestion}`,
    ),
  ]);

  /** One revision for the review's major findings and the engine's checks; what remains is shown. */
  async function revise(items: string[]): Promise<SynthesisResult> {
    const first = rec.value as Recommendations;
    if (items.length) {
      report("recommend-revise", "Revising recommendations after the checks…");
      const ask = `Revise your recommendations. The review and the code checks found these major problems; fix them where they are right, keep the rest. The target deck and the directives are hard input.\n${items.join("\n")}`;
      const was = `Your first version (JSON):\n${JSON.stringify(first)}`;
      const revised = await textStep(
        "recommend-revise",
        deps.writer,
        deps.prompts.recommend,
        {
          now: `${context}\n\n${was}\n\n${ask}`,
          before: `${ask}\n\n${was}\n\n${contextBefore}`,
        },
        schema,
        check,
        ctx,
        recommendKb(input.fit),
      );
      if (revised.value) {
        out.draft = first;
        out.recommendations = revised.value;
        out.kb.recommendations = revised.record ?? null;
      } else out.problems.push(`revision: ${revised.problems.join("; ")}`);
    }
    const left = out.recommendations ? soft(out.recommendations) : [];
    if (left.length) out.problems.push(`recommendations vs the directives: ${left.join("; ")}`);
    return out;
  }
}

/**
 * A text step with the shared facts first and its own instruction last (prompt-cache friendly,
 * plan-analysis-speed item 3). An answer saved under the older order (instruction first) is
 * still used, so reports built before keep their written parts on a free rebuild.
 */
export async function textStep<T>(
  step: string,
  provider: Provider,
  system: RenderedPrompt,
  task: { now: string; before: string },
  schema: z.ZodType<T>,
  check: (value: T) => string[],
  ctx: CallContext,
  kb?: KbOpts<T>,
): Promise<{ value: T | null; key: string; problems: string[]; record?: KbRecord | null }> {
  // The knowledge base (Settings switch): with it off, every argument passes through unchanged.
  const k = kb
    ? kbPart({ ...kb, run: ctx.kb, system, task, schema, check, model: provider.model })
    : null;
  if (k && "blocked" in k) return { value: null, key: "", problems: [k.blocked] };
  const s = k ?? { system, task, schema, check };
  const q = { step, model: provider.model, system: s.system, images: [], ctx };
  const old = cachedAnswer(q, s.task.before, s.schema, s.check);
  const r = old
    ? { value: old.value, key: old.key, problems: [] }
    : await validatedCall(step, provider, s.system, s.task.now, [], s.schema, s.check, ctx);
  if (!k) return r;
  const f = k.finish(r.value);
  return { ...r, value: f.value, record: f.record };
}
