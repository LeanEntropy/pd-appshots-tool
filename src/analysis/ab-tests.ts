import type { KbRecord } from "../kb/step.ts";
import { abKb } from "../kb/step-io.ts";
import { kbPart, marksOf, withMarks } from "../kb/synthesis-kb.ts";
import type { Evidence } from "../reports/ab-candidates.ts";
import {
  type AbTestsOutput,
  abTestsSchema,
  orderProblems,
  type TestRules,
  testProblems,
} from "./ab-tests-schema.ts";
import { type CallContext, validatedCall } from "./call.ts";
import { reportLabeler } from "./categories.ts";
import { plainLabel } from "./labels.ts";
import type { DeckEntry } from "./patterns.ts";
import { languageName, PLAY_METRICS, PLAY_SOURCE, VARIABLE_NAMES } from "./play-experiments.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";
import { logoOf, type Recommendations } from "./synthesis-schema.ts";

const L = reportLabeler(plainLabel);

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
            `#${p.position} ${L(p.screenType)}${p.subtype ? ` / ${L(p.subtype)}` : ""} (${p.source}), headline "${p.marketingLayer.texts[0]?.text ?? ""}", game logo: ${logoOf(p)?.show ? "yes" : "no"}: ${p.why}`,
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
  const most = Math.min(5, r.evidence.size);
  const count =
    v.tests.length > most ? [`write at most ${most} tests (got ${v.tests.length})`] : [];
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
): Promise<{ value: AbTestsOutput | null; problems: string[]; record: KbRecord | null }> {
  if (!x.evidence.length) return { value: null, problems: [], record: null };
  const plain = abTestsTask(x);
  // The knowledge base (Settings switch): off = the prompt, schema and check exactly as before.
  const k = kbPart({
    ...abKb(x.evidence),
    run: ctx.kb,
    system: prompt,
    task: { now: plain, before: plain },
    schema: abTestsSchema,
    check: () => [],
    model: provider.model,
  });
  if ("blocked" in k) return { value: null, problems: [k.blocked], record: null };
  const task = k.task.now;
  const first = await validatedCall(
    "ab-tests",
    provider,
    k.system,
    task,
    [],
    k.schema,
    k.check,
    ctx,
  );
  if (!first.value) return { value: null, problems: first.problems, record: null };
  const problems = [...problemList(first.value, x.rules), ...k.enforced(first.value)];
  const retry = problems.length
    ? await validatedCall(
        "ab-tests-repair",
        provider,
        k.system,
        `${task}\n\nYour previous answer (JSON):\n${JSON.stringify(first.value)}\n\nIt had these problems; fix them and answer again with every test:\n- ${problems.join("\n- ")}`,
        [],
        k.schema,
        k.check,
        ctx,
      )
    : null;
  const f = k.finish(retry?.value ?? first.value);
  const kept = keepAllowed(f.value, f.record, k.enforced);
  const marks = ctx.kb ? marksOf(ctx.kb, kept.record) : null;
  return {
    value: withMarks(kept.value, marks),
    problems: kept.value ? problemList(kept.value, x.rules) : [],
    record: kept.record,
  };
}

/** A test that breaks an enforced store rule is dropped by code (its citations renumbered). */
function keepAllowed(
  v: AbTestsOutput | null,
  record: KbRecord | null,
  enforced: (v: AbTestsOutput) => string[],
): { value: AbTestsOutput | null; record: KbRecord | null } {
  if (!v) return { value: null, record };
  const keep = v.tests.map((t) => enforced({ tests: [t] }).length === 0);
  if (keep.every(Boolean)) return { value: v, record };
  const newIndex = new Map<string, string>();
  let n = 0;
  keep.forEach((ok, i) => {
    if (ok) newIndex.set(`test:${i + 1}`, `test:${++n}`);
  });
  const move = <T extends { item: string }>(list: T[]) =>
    list.flatMap((c) =>
      newIndex.has(c.item) ? [{ ...c, item: newIndex.get(c.item) as string }] : [],
    );
  return {
    value: { ...v, tests: v.tests.filter((_, i) => keep[i]) },
    record: record && {
      ...record,
      citations: move(record.citations),
      againstGuidance: move(record.againstGuidance),
      conflicts: move(record.conflicts),
    },
  };
}
