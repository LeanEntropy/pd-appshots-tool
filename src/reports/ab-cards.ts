import type { TestRules, Variant } from "../analysis/ab-tests-schema.ts";
import {
  allowedMetrics,
  GUARDRAIL,
  PLAY_METRICS,
  playSetup,
  VARIABLE_NAMES,
} from "../analysis/play-experiments.ts";
import { rowTags } from "../analysis/report-sorting.ts";
import { codeTestPositions, codeTestText, type Evidence } from "./ab-candidates.ts";
import type { AbSectionInput, AbTestCard, PlayContext } from "./ab-section.ts";

/** The cards of the A/B tests (ab-section.ts): control, Play setup, plain wording. */ export function control(
  x: AbSectionInput,
): AbTestCard["control"] {
  return [...x.ours]
    .sort((a, b) => a.position - b.position)
    .map((e) => {
      return {
        position: e.position,
        screen: rowTags(e.final, e.name, x.label).screen,
        headline: e.final.headline,
        orientation: e.canvas,
      };
    });
}

export function card(
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

export const cleanVariant = (v: Variant): Variant => ({
  summary: noIds(v.summary),
  slots: v.slots.map((s) => ({
    ...s,
    composition: noIds(s.composition),
    screen: noIds(s.screen),
    band: noIds(s.band),
    headline: noIds(s.headline),
    extras: noIds(s.extras),
  })),
});

/** The checks' problems in plain words for the page: gap ids and country codes named. */
export function plainReason(problems: string[], rules: TestRules, play: PlayContext): string {
  const country = (gl: string) =>
    play.projectMarkets.find((m) => m.gl === gl)?.label ?? gl.toUpperCase();
  return problems
    .map((p) =>
      p
        .replace(/cite at least one gap id/g, "it cites no gap")
        .replace(/gap E\d+ does not exist/g, "it cites a gap that does not exist")
        .replace(/gap (E\d+)/g, (_, id: string) => {
          const e = rules.evidence.get(id);
          return e ? `the gap "${e.statement.split(" (")[0]}"` : "a gap";
        })
        .replace(/country ([a-z]{2})\b/g, (_, gl: string) => country(gl)),
    )
    .join("; ");
}

export function codeCard(x: AbSectionInput, e: Evidence): AbTestCard {
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
