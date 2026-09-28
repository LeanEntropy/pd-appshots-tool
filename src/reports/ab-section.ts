import {
  type AbTestsOutput,
  type AiTest,
  orderProblems,
  type TestRules,
  testLeverage,
  testProblems,
  type Variant,
  variantTargets,
} from "../analysis/ab-tests-schema.ts";
import type { Labeler } from "../analysis/labels.ts";
import type { FitSummary } from "../analysis/pattern-fit.ts";
import type { DeckEntry } from "../analysis/patterns.ts";
import {
  allowedMetrics,
  isLowTraffic,
  type MarketRef,
  type PlaySetup,
  type TestVariable,
} from "../analysis/play-experiments.ts";
import type { TrafficLevel } from "../settings/schema.ts";
import { abCandidates, codeTestPositions, type Evidence } from "./ab-candidates.ts";
import { card, cleanVariant, codeCard, noIds, plainReason } from "./ab-cards.ts";

export { noIds } from "./ab-cards.ts";

/** Where the tests run: the report's countries, the project's, traffic per country. */
export interface PlayContext {
  reportMarkets: MarketRef[];
  projectMarkets: MarketRef[];
  traffic: Record<string, TrafficLevel>;
  preRegistration: boolean;
}

export interface AbTestCard {
  priority: number;
  /** "ai": written by the AI and checked by code; "code": a gap worth testing, by code. */
  source: "ai" | "code";
  title: string;
  hypothesis: string;
  evidence: {
    id: string;
    statement: string;
    n: number;
    of: number;
    unit: string;
    games: string[];
  }[];
  variable: TestVariable;
  variableName: string;
  positions: number[];
  countries: string[];
  variant: Variant | null;
  /** The code-written variant, in words (code tests only). */
  variantText: string;
  secondVariant: Variant | null;
  control: { position: number; screen: string; headline: string; orientation: string }[];
  metric: { name: string; meaning: string };
  guardrail: string;
  setup: PlaySetup;
  impact: { size: string; reason: string } | null;
}

export interface AbTestsPart {
  tests: AbTestCard[];
  leftOut: { title: string; reason: string }[];
  gaps: number;
  /** Plain note: why there are fewer than 2 tests, or why the AI wording is not shown. */
  note: string;
}

export interface AbSectionInput {
  fit: FitSummary | null;
  ours: readonly DeckEntry[];
  ourDeckLength: number;
  deckLength: { min: number; max: number } | null;
  label: Labeler;
  market: MarketRef;
  play: PlayContext;
  ai: AbTestsOutput | null;
  aiCurrent: boolean;
}

/** The gaps and the checks for one report (the same for the AI call and the report). */
export function abEvidence(x: Omit<AbSectionInput, "ai" | "aiCurrent" | "label">): {
  evidence: Evidence[];
  rules: TestRules;
} {
  const range = x.deckLength ?? { min: x.ourDeckLength, max: x.ourDeckLength };
  const evidence = abCandidates(x.fit, {
    gl: x.market.gl,
    ourDeckLength: x.ourDeckLength,
    deckLength: range,
  });
  const rules: TestRules = {
    evidence: new Map(evidence.map((e) => [e.id, e])),
    countries: x.play.reportMarkets.map((m) => m.gl),
    ourDeckLength: x.ourDeckLength,
    length: {
      min: Math.max(1, Math.min(x.ourDeckLength, range.min)),
      max: Math.max(x.ourDeckLength, range.max),
    },
    metrics: allowedMetrics(x.play.preRegistration),
    lowTraffic: (gl) => isLowTraffic(x.play.traffic[gl] ?? "unknown"),
    ourOrientation: new Map(x.ours.map((e) => [e.position, e.canvas])),
  };
  return { evidence, rules };
}

/**
 * The A/B tests of a report (plan-reports 3B.2, step 3): the AI's tests that pass every check
 * (the rest listed as left out), in leverage order, at most 5, topped up to 2 with tests written
 * by code from the next gaps. With fewer than 2 gaps it says so instead of inventing a test.
 */
export function abTestsPart(
  x: AbSectionInput,
  pre: { evidence: Evidence[]; rules: TestRules } = abEvidence(x),
): AbTestsPart {
  const { evidence, rules } = pre;
  const leftOut: AbTestsPart["leftOut"] = [];
  let kept: AiTest[] = [];
  if (x.ai && x.aiCurrent) {
    const seen = new Set<string>();
    const perCountry = new Map<string, number>();
    for (const t of x.ai.tests) {
      const problems = testProblems(t, rules);
      const key = `${t.variable}|${variantTargets(t.variant).join(",")}`;
      if (!problems.length && seen.has(key)) problems.push("the same change as an earlier test");
      const low = t.countries.filter(
        (gl) => rules.lowTraffic(gl) && (perCountry.get(gl) ?? 0) >= 2,
      );
      if (!problems.length && low.length)
        problems.push(`at most 2 tests in a low-traffic country (${low.join(", ")})`);
      if (problems.length) {
        leftOut.push({ title: noIds(t.title), reason: plainReason(problems, rules, x.play) });
        continue;
      }
      seen.add(key);
      for (const gl of t.countries) perCountry.set(gl, (perCountry.get(gl) ?? 0) + 1);
      kept.push(t);
    }
    if (orderProblems(kept, rules).length)
      kept = [...kept].sort((a, b) => testLeverage(b, rules) - testLeverage(a, rules));
    // Never more tests than gaps (evidence before the count), and at most 5.
    const most = Math.min(5, evidence.length);
    for (const t of kept.slice(most))
      leftOut.push({
        title: noIds(t.title),
        reason: most < 5 ? `more tests than gaps found (${most})` : "more than 5 tests",
      });
    kept = kept.slice(0, most);
  }
  const tests = kept.map((t) =>
    card(
      x,
      {
        source: "ai",
        title: noIds(t.title),
        hypothesis: noIds(t.hypothesis),
        variable: t.variable,
        positions: variantTargets(t.variant),
        variant: cleanVariant(t.variant),
        variantText: noIds(t.variant.summary),
        secondVariant: t.secondVariant && cleanVariant(t.secondVariant),
        impact: { ...t.impact, reason: noIds(t.impact.reason) },
      },
      t.evidence.flatMap((c) => rules.evidence.get(c.id) ?? []),
      t.countries,
    ),
  );
  const used = new Set(kept.flatMap((t) => t.evidence.map((c) => c.id)));
  // Low traffic (or not known): at most 2 tests, only on positions 1 to 3 or the order.
  const low = rules.lowTraffic(x.market.gl);
  const want = low ? 2 : x.ai && x.aiCurrent ? 2 : 5;
  const taken = new Set(tests.map((t) => `${t.variable}|${t.positions.join(",")}`));
  for (const e of evidence) {
    if (tests.length >= want) break;
    const at = codeTestPositions(e);
    const key = `${e.variable}|${at.join(",")}`;
    if (used.has(e.id) || taken.has(key)) continue;
    if (low && e.variable !== "order" && at.some((p) => p > 3)) continue;
    taken.add(key);
    tests.push(codeCard(x, e));
  }
  tests.forEach((t, i) => {
    t.priority = i + 1;
  });
  const note =
    evidence.length === 0
      ? "No gaps found: our deck fits every competitor pattern, so there is nothing to test yet."
      : evidence.length === 1
        ? "Only 1 gap found; we do not invent a second test."
        : !x.ai
          ? "These tests are written by code from the gaps with the most leverage; the AI wording arrives with the next approved run."
          : !x.aiCurrent
            ? "The AI-written tests were made from older data, so these tests are written by code from the current gaps."
            : "";
  const lowNote =
    low && evidence.length
      ? `Store visitors per month in ${x.market.label} are ${x.play.traffic[x.market.gl] === "low" ? "low" : "not set (counted as low; set them on the Settings page)"}: at most 2 tests, only on positions 1 to 3 or the order of the set.`
      : "";
  return { tests, leftOut, gaps: evidence.length, note: [note, lowNote].filter(Boolean).join(" ") };
}
