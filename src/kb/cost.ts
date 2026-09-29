import type { Config } from "../config/schema.ts";
import { secondOpinionOn } from "../settings/access.ts";
import { budgetOf, type KbStep, type Preset } from "./steps.ts";

/**
 * What the knowledge base adds to a report, priced from token counts (plan section 11, decision
 * D6: a cap per report, $0.50 by default, shown in the approval). Prices per million tokens;
 * Claude prices checked 2026-09-25 (Anthropic's model table). OpenAI prices are an assumption
 * until checked: set on the high side on purpose, so the estimate never understates.
 */
export const PRICES_CHECKED = "2026-09-25";
const USD_PER_MTOK: Record<string, { input: number; output: number; assumed?: boolean }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "gpt-5.6-sol": { input: 10, output: 40, assumed: true },
  "gpt-5.6-terra": { input: 10, output: 40, assumed: true },
  "gpt-5.5": { input: 10, output: 40, assumed: true },
};
const UNKNOWN = { input: 10, output: 50, assumed: true };

export function priceOf(modelRef: string) {
  return USD_PER_MTOK[modelRef.split(":")[1] ?? modelRef] ?? UNKNOWN;
}

/** The kb answer (handles, a few conflicts) adds about this much output per call. */
const OUTPUT_TOKENS_PER_CALL = 150;

export interface KbCall {
  label: string;
  model: string;
  step: KbStep;
  /** Calls that always run, and the ones that run only on a repair or a revision. */
  calls: [number, number];
}

export interface KbCost {
  tokens: [number, number];
  usd: [number, number];
  capUsd: number;
  overCap: boolean;
  preset: Preset;
  calls: KbCall[];
  assumedPrices: boolean;
}

/**
 * The call graph of a report's knowledge-bearing calls. `main`: the main country's synthesis runs
 * (Pilot, Full check, or a report that includes the main country); `abroad`: countries with their
 * own advice; `abTests`: the report writes its A/B tests.
 */
export function kbCallGraph(
  c: Config,
  x: { main: boolean; abroad: number; abTests: boolean },
): KbCall[] {
  const out: KbCall[] = [];
  if (x.main) {
    out.push(
      { label: "Pattern wording", model: c.models.recommend, step: "patterns", calls: [1, 1] },
      {
        label: "Recommendations (and a revision)",
        model: c.models.recommend,
        step: "recommend",
        calls: [1, 2],
      },
    );
    if (secondOpinionOn(c, "recommendations"))
      out.push({
        label: "Recommendation check",
        model: c.models.recommendationReview,
        step: "recommend",
        calls: [1, 1],
      });
  }
  if (x.abTests)
    out.push({
      label: "A/B tests (and a retry)",
      model: c.options.models.abTests,
      step: "abTests",
      calls: [1, 2],
    });
  if (x.abroad) {
    out.push({
      label: "Country advice (and a revision)",
      model: c.options.models.countryAdvice,
      step: "countryAdvice",
      calls: [x.abroad, 2 * x.abroad],
    });
    if (secondOpinionOn(c, "countryAdvice"))
      out.push({
        label: "Country advice check",
        model: c.models.recommendationReview,
        step: "countryAdvice",
        calls: [x.abroad, x.abroad],
      });
  }
  return out;
}

export function kbCost(
  c: Config,
  x: { main: boolean; abroad: number; abTests: boolean },
  preset?: Preset,
): KbCost {
  const k = c.options.knowledge;
  const p = preset ?? k.preset;
  const calls = kbCallGraph(c, x);
  const tokens: [number, number] = [0, 0];
  const usd: [number, number] = [0, 0];
  let assumedPrices = false;
  for (const call of calls) {
    const t = budgetOf(call.step, p).budget;
    const price = priceOf(call.model);
    assumedPrices ||= !!price.assumed;
    for (const i of [0, 1] as const) {
      tokens[i] += t * call.calls[i];
      usd[i] += ((t * price.input + OUTPUT_TOKENS_PER_CALL * price.output) * call.calls[i]) / 1e6;
    }
  }
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    tokens,
    usd: [round(usd[0]), round(usd[1])],
    capUsd: k.maxUsdPerReport,
    overCap: usd[1] > k.maxUsdPerReport,
    preset: p,
    calls,
    assumedPrices,
  };
}

/** Knowledge tokens a report may add before its cap is reached (priced at the writer's input). */
export function capTokens(c: Config): number {
  const price = priceOf(c.models.recommend);
  return Math.floor((c.options.knowledge.maxUsdPerReport * 1e6) / Math.max(price.input, 0.01));
}

/** One line for the approval screens, or null when the switch is off. */
export function kbApprovalLine(
  c: Config,
  x: { main: boolean; abroad: number; abTests: boolean },
): { text: string; usd: [number, number] } | null {
  if (!c.options.knowledge.enabled) return null;
  const k = kbCost(c, x);
  const range = `$${k.usd[0].toFixed(2)} to $${k.usd[1].toFixed(2)}`;
  const cap = `cap $${k.capUsd.toFixed(2)} per report`;
  const text = k.overCap
    ? `Knowledge base material: about ${range}, above its ${cap}: the steps past the cap run without it. Lower the knowledge per step in Settings to fit.`
    : `Knowledge base material: about ${range} (${k.tokens[0].toLocaleString("en-US")} to ${k.tokens[1].toLocaleString("en-US")} extra input tokens; ${cap}).`;
  return { text, usd: [k.usd[0], Math.min(k.usd[1], k.capUsd)] };
}
