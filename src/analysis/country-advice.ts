import type { MarketRef } from "../reports/types.ts";
import { type CallContext, validatedCall } from "./call.ts";
import {
  type AdviceRules,
  adviceProblems,
  type CountryAdvice,
  countryAdviceSchema,
} from "./country-advice-schema.ts";
import { languageName } from "./play-experiments.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";
import { type Review, reviewSchema } from "./synthesis-schema.ts";

/** One fact the advice may rest on, computed by code, with its id (C1, C2 ...). */
export interface AdviceFact {
  id: string;
  kind: "pattern" | "habit" | "words" | "base";
  statement: string;
}

/** Everything the country-advice call reads: all computed by code from the report's data. */
export interface CountryAdviceInput {
  country: MarketRef;
  main: MarketRef;
  facts: AdviceFact[];
  /** The main country's recommended deck (Full check, else Pilot), one line per position. */
  base: { from: string; lines: string[] };
  /** Our current deck in this country, one line per image (both layers). */
  ours: string[];
  /** The competitors' decks in this country, one line per image. */
  competitors: string[];
  /** Local texts against the main country's: game #position: main "..." -> local "..." (back). */
  texts: string[];
  /** The words-used table of this country, one line per concept. */
  words: string[];
  rules: AdviceRules;
}

export interface AdviceResult {
  advice: CountryAdvice | null;
  /** The first draft, when the review asked for changes and it was revised. */
  draft: CountryAdvice | null;
  review: Review | null;
  problems: string[];
}

export interface AdviceDeps {
  writer: Provider;
  reviewer: Provider | null;
  prompt: RenderedPrompt;
  reviewPrompt: RenderedPrompt;
  /** Told when the second opinion, then a fix after it, starts (the run panel's steps). */
  phase?: (step: "review" | "revise") => void;
}

const block = (title: string, lines: readonly string[]) =>
  `${title}\n${lines.length ? lines.join("\n") : "(none)"}`;

export function adviceTask(x: CountryAdviceInput): string {
  const lang = languageName(x.country.hl);
  return [
    "Write the country advice.",
    `Store page: Google Play, ${x.country.label} (country code ${x.country.gl}, language ${lang}). The main country is ${x.main.label}: its recommended deck below is the base, and you say what changes for ${x.country.label}.`,
    `Recommend ${x.rules.length.min} to ${x.rules.length.max} images. The main country's recommended deck has ${x.rules.baseLength} (fromMainPosition refers to it).`,
    block(
      "Facts computed by code (cite their ids in actions.evidence; never write the ids in other text):",
      x.facts.map((f) => `${f.id}: ${f.statement}`),
    ),
    block(`The main country's recommended deck (from the ${x.base.from}):`, x.base.lines),
    block(`Our current screenshots in ${x.country.label}, in store order:`, x.ours),
    block(`Competitors' screenshots in ${x.country.label}, in store order:`, x.competitors),
    block(
      `Competitors' texts in ${x.country.label} against the same picture in ${x.main.label} (from the text-layer comparison):`,
      x.texts,
    ),
    block(`Words used in ${x.country.label} (counted by code over every text):`, x.words),
  ].join("\n\n");
}

/**
 * The country advice call (Opus, text only, CMO voice), checked by code (repaired up to twice
 * by the call itself), then reviewed by the other model family when that second opinion is on
 * (decision D6), with one revision on major findings. Every call is cached by its full input.
 */
export async function writeCountryAdvice(
  d: AdviceDeps,
  x: CountryAdviceInput,
  ctx: CallContext,
): Promise<AdviceResult> {
  const out: AdviceResult = { advice: null, draft: null, review: null, problems: [] };
  const task = adviceTask(x);
  const check = (v: CountryAdvice) => adviceProblems(v, x.rules);
  const first = await validatedCall(
    "country-advice",
    d.writer,
    d.prompt,
    task,
    [],
    countryAdviceSchema,
    check,
    ctx,
  );
  if (!first.value) {
    out.problems.push(`country advice for ${x.country.label}: ${first.problems.join("; ")}`);
    return out;
  }
  out.advice = first.value;
  if (!d.reviewer) return out;
  d.phase?.("review");
  const rev = await validatedCall(
    "country-advice-review",
    d.reviewer,
    d.reviewPrompt,
    `Review these country recommendations for ${x.country.label}.\n\n${task}\n\nThe advice (JSON):\n${JSON.stringify(first.value)}`,
    [],
    reviewSchema,
    () => [],
    ctx,
  );
  out.review = rev.value;
  if (!rev.value) {
    out.problems.push(`second opinion on ${x.country.label}: ${rev.problems.join("; ")}`);
    return out;
  }
  const major = rev.value.findings.filter((f) => f.severity === "major");
  if (!major.length) return out;
  const findings = major
    .map((f) => `- position ${f.position || "all"}: ${f.issue} Suggestion: ${f.suggestion}`)
    .join("\n");
  d.phase?.("revise");
  const revised = await validatedCall(
    "country-advice-revise",
    d.writer,
    d.prompt,
    `Write the country advice again. A reviewer found these major problems; fix them where they are right, keep the rest.\n${findings}\n\nYour first version (JSON):\n${JSON.stringify(first.value)}\n\n${task}`,
    [],
    countryAdviceSchema,
    check,
    ctx,
  );
  if (revised.value) {
    out.draft = first.value;
    out.advice = revised.value;
  } else out.problems.push(`revision for ${x.country.label}: ${revised.problems.join("; ")}`);
  return out;
}
