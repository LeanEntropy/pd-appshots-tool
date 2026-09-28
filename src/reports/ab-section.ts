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
  GUARDRAIL,
  isLowTraffic,
  type MarketRef,
  PLAY_METRICS,
  type PlaySetup,
  playSetup,
  type TestVariable,
  VARIABLE_NAMES,
} from "../analysis/play-experiments.ts";
import type { TrafficLevel } from "../settings/schema.ts";
import { abCandidates, codeTestPositions, codeTestText, type Evidence } from "./ab-candidates.ts";

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
export function abEvidence(x: Omit<AbSectionInput, "ai" | "aiCurrent" | "label" | "ours">): {
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
  };
  return { evidence, rules };
}

function control(x: AbSectionInput): AbTestCard["control"] {
  return [...x.ours]
    .sort((a, b) => a.position - b.position)
    .map((e) => {
      const s = e.final.screenshot;
      return {
        position: e.position,
        screen: `${x.label(s.screenType)}${s.subtype ? ` / ${x.label(s.subtype)}` : ""}`,
        headline: e.final.headline,
        orientation: e.canvas,
      };
    });
}

function card(
  x: AbSectionInput,
  base: Pick<
    AbTestCard,
    | "source"
    | "title"
    | "hypothesis"
    | "variable"
    | "positions"
    | "variant"
    | "variantText"
    | "secondVariant"
    | "impact"
  >,
  cited: readonly Evidence[],
  countries: readonly string[],
): AbTestCard {
  const markets = x.play.reportMarkets.filter((m) => countries.includes(m.gl));
  const traffic = (gl: string) => x.play.traffic[gl] ?? "unknown";
  const setup = playSetup(
    markets.length ? markets : [x.market],
    x.play.reportMarkets,
    x.play.projectMarkets,
    traffic,
    !!base.secondVariant,
  );
  const metric = PLAY_METRICS[allowedMetrics(x.play.preRegistration)[0] ?? "installs"];
  return {
    ...base,
    secondVariant: setup.variants === 2 ? base.secondVariant : null,
    priority: 0,
    evidence: cited.map((e) => ({
      id: e.id,
      statement: e.statement,
      n: e.n,
      of: e.of,
      unit: e.unit,
      games: e.games,
    })),
    variableName: VARIABLE_NAMES[base.variable],
    countries: (markets.length ? markets : [x.market]).map((m) => m.label),
    control: control(x),
    metric: { name: metric.name, meaning: metric.meaning },
    guardrail: GUARDRAIL,
    setup,
  };
}

/** Gap ids are internal: removed from any text the user reads, e.g. "(E1)" or "(E2, E3)". */
export const noIds = (s: string) =>
  s
    .replace(/\s*\((?:gaps? )?E\d+(?:\s*(?:,|and)\s*E\d+)*\)/g, "")
    .replace(/\b(?:gaps? )?E\d+(?:(?:\s*,\s*|\s+and\s+)E\d+)*\b/g, (m) =>
      /E\d+\D+E\d+/.test(m) ? "these gaps" : "the gap",
    );

function codeCard(x: AbSectionInput, e: Evidence): AbTestCard {
  const t = codeTestText(e);
  const positions = codeTestPositions(e);
  return card(
    x,
    {
      source: "code",
      ...t,
      variable: e.variable,
      positions,
      variant: null,
      variantText: t.variant,
      secondVariant: null,
      impact: null,
    },
    [e],
    e.countries,
  );
}

/**
 * The A/B tests of a report (plan-reports 3B.2, step 3): the AI's tests that pass every check
 * (the rest listed as left out), in leverage order, at most 5, topped up to 2 with tests written
 * by code from the next gaps. With fewer than 2 gaps it says so instead of inventing a test.
 */
export function abTestsPart(x: AbSectionInput): AbTestsPart {
  const { evidence, rules } = abEvidence(x);
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
        leftOut.push({ title: t.title, reason: problems.join("; ") });
        continue;
      }
      seen.add(key);
      for (const gl of t.countries) perCountry.set(gl, (perCountry.get(gl) ?? 0) + 1);
      kept.push(t);
    }
    if (orderProblems(kept, rules).length)
      kept = [...kept].sort((a, b) => testLeverage(b, rules) - testLeverage(a, rules));
    for (const t of kept.slice(5)) leftOut.push({ title: t.title, reason: "more than 5 tests" });
    kept = kept.slice(0, 5);
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
        variant: { ...t.variant, summary: noIds(t.variant.summary) },
        variantText: noIds(t.variant.summary),
        secondVariant: t.secondVariant && {
          ...t.secondVariant,
          summary: noIds(t.secondVariant.summary),
        },
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
