import type { Evidence } from "../reports/ab-candidates.ts";
import {
  type AbTestsOutput,
  abTestsSchema,
  orderProblems,
  type TestRules,
  testProblems,
} from "./ab-tests-schema.ts";
import { type CallContext, validatedCall } from "./call.ts";
import type { DeckEntry } from "./patterns.ts";
import { languageName, PLAY_METRICS, PLAY_SOURCE, VARIABLE_NAMES } from "./play-experiments.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";
import type { Recommendations } from "./synthesis-schema.ts";

export interface AbTestsInput {
  evidence: readonly Evidence[];
  rules: TestRules;
  market: { gl: string; hl: string; label: string };
  traffic: string;
  ours: readonly DeckEntry[];
  /** One line per current screenshot (synthesis `brief`). */
  brief: (e: DeckEntry) => string;
  recommendations: Recommendations | null;
}

/** The task text: the gaps (by code), our deck, the recommendations and the rules, as data. */
export function abTestsTask(x: AbTestsInput): string {
  const r = x.rules;
  const most = Math.min(5, x.evidence.length);
  const gaps = x.evidence.map((e) => ({
    id: e.id,
    statement: e.statement,
    n: e.n,
    of: e.of,
    unit: e.unit,
    games: e.games,
    countries: e.countries,
    positions: e.positions.length ? e.positions : "the whole deck",
    ourPositionsThatDiffer: e.ours,
    suggestedVariable: e.variable,
    leverage: e.leverage,
  }));
  const recs = x.recommendations
    ? [...x.recommendations.positions]
        .sort((a, b) => a.position - b.position)
        .map(
          (p) =>
            `#${p.position} ${p.screenType}${p.subtype ? `/${p.subtype}` : ""} (${p.source}), headline "${p.marketingLayer.texts[0]?.text ?? ""}": ${p.why}`,
        )
        .join("\n")
    : "none written yet";
  return [
    "Write the A/B tests to run next.",
    `Store page: Google Play, ${x.market.label} (country code ${x.market.gl}, language ${languageName(x.market.hl)}). Store visitors per month: ${x.traffic}.`,
    `Write ${most < 2 ? `at most ${most}` : `between 2 and ${most}`} tests, in leverage order (highest first). Our deck has ${r.ourDeckLength} screenshots; a variant has ${r.length.min} to ${r.length.max}.`,
    `The one variable a test changes: ${Object.entries(VARIABLE_NAMES)
      .map(([k, v]) => `${k} = ${v}`)
      .join("; ")}.`,
    `Target metric: ${r.metrics.map((m) => `${m} (${PLAY_METRICS[m].name})`).join(" or ")} (Play Console, checked ${PLAY_SOURCE.checked}).`,
    `Gaps between our deck and the competitors, computed by code, most leverage first (JSON):\n${JSON.stringify(gaps)}`,
    `Our current screenshots, in store order (the control):\n${x.ours.map(x.brief).join("\n")}`,
    `The recommended deck (the full changes, for context):\n${recs}`,
  ].join("\n\n");
}

function problemList(v: AbTestsOutput, r: TestRules): string[] {
  const per = v.tests.flatMap((t, i) => testProblems(t, r).map((p) => `test ${i + 1}: ${p}`));
  const count = v.tests.length > 5 ? [`write at most 5 tests (got ${v.tests.length})`] : [];
  return [...count, ...per, ...orderProblems(v.tests, r)];
}

/**
 * The A/B tests call (Opus, text only, CMO voice). The answer is checked test by test; when a
 * test fails, the model gets one retry with the problems listed. What still fails is dropped
 * when the report is built (ab-section.ts), never here, so the saved answer stays as written.
 */
export async function writeAbTests(
  provider: Provider,
  prompt: RenderedPrompt,
  x: AbTestsInput,
  ctx: CallContext,
): Promise<{ value: AbTestsOutput | null; problems: string[] }> {
  if (!x.evidence.length) return { value: null, problems: [] };
  const task = abTestsTask(x);
  const first = await validatedCall(
    "ab-tests",
    provider,
    prompt,
    task,
    [],
    abTestsSchema,
    () => [],
    ctx,
  );
  if (!first.value) return { value: null, problems: first.problems };
  const problems = problemList(first.value, x.rules);
  if (!problems.length) return { value: first.value, problems: [] };
  const retry = await validatedCall(
    "ab-tests-repair",
    provider,
    prompt,
    `${task}\n\nYour previous answer (JSON):\n${JSON.stringify(first.value)}\n\nIt had these problems; fix them and answer again with every test:\n- ${problems.join("\n- ")}`,
    [],
    abTestsSchema,
    () => [],
    ctx,
  );
  const value = retry.value ?? first.value;
  return { value, problems: problemList(value, x.rules) };
}
