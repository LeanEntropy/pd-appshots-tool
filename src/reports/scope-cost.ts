import { type Estimate, estimate } from "../analysis/estimate.ts";
import type { AnalysisPlan } from "../analysis/plan.ts";
import type { Config } from "../config/schema.ts";
import { kbApprovalLine } from "../kb/cost.ts";
import { secondOpinionOn, settingsOf } from "../settings/access.ts";
import type { ScopeItem } from "./anchors.ts";
import type { MarketRef, ReportScope } from "./types.ts";

/**
 * Provisional cost per text-only call of the country reports' steps (country advice, its second
 * opinion, words used per country, A/B tests), in dollars, low and high. One place, so the
 * numbers shown in the builder, the approval and the suggestions stay the same.
 */
export const TEXT_USD = {
  countryAdvice: [0.13, 0.3],
  countryAdviceReview: [0.03, 0.08],
  conceptMap: [0.05, 0.3],
  abTests: [0.2, 0.5],
} as const satisfies Record<string, readonly [number, number]>;

export interface TextPart {
  label: string;
  model: string;
  calls: number;
  usd: [number, number];
}

export interface DropProposal {
  /** Lowest priority first: the last competitors in the last countries. */
  leaveOut: { appId: string; name: string; gl: string; country: string }[];
  savesUsd: number;
  /** True when leaving these out brings the total within the limit. */
  fits: boolean;
}

export interface CostParts {
  /** The image steps (full analyses, text-layer comparisons, second opinions). */
  images: Estimate;
  /** Text-only AI of the report; `later`: it is written by the next update of the tool. */
  text: { parts: TextPart[]; usd: [number, number]; later: boolean };
  usd: [number, number];
  limitUsd: number;
  overLimit: boolean;
  drop: DropProposal | null;
}

const round = (n: number) => Math.round(n * 100) / 100;
const modelName = (ref: string) => ref.split(":")[1] ?? ref;
const times = (n: number, u: readonly [number, number]): [number, number] => [
  round(n * u[0]),
  round(n * u[1]),
];
const sum = (a: readonly [number, number], b: readonly [number, number]): [number, number] => [
  round(a[0] + b[0]),
  round(a[1] + b[1]),
];

/** Pilot and Full check: today's estimate (images plus the synthesis), within the core cap. */
export function presetCost(config: Config, p: AnalysisPlan): CostParts {
  return {
    images: p.estimate,
    text: { parts: [], usd: [0, 0], later: false },
    usd: p.estimate.usd,
    limitUsd: settingsOf(config).spending.perBatchUsd,
    overLimit: false,
    drop: null,
  };
}

/** One country and Compare countries: image steps plus the text-only report steps, vs the limit. */
export function costOf(
  config: Config,
  markets: readonly MarketRef[],
  main: MarketRef,
  items: readonly ScopeItem[],
): CostParts {
  const images = estimate(config, items, false);
  const steps = settingsOf(config).steps;
  const abroad = markets.filter((m) => !(m.gl === main.gl && m.hl === main.hl));
  const parts: TextPart[] = [];
  if (abroad.length < markets.length)
    parts.push({
      label: `Recommendations for ${main.label} (text only)`,
      model: modelName(config.models.recommend),
      calls: 1,
      usd: [...config.estimates.synthesisUsd] as [number, number],
    });
  if (abroad.length) {
    parts.push({
      label: `Country advice (text only): ${abroad.length} ${abroad.length === 1 ? "country" : "countries"}`,
      model: modelName(steps.countryAdvice.model),
      calls: abroad.length,
      usd: times(abroad.length, TEXT_USD.countryAdvice),
    });
    if (secondOpinionOn(config, "countryAdvice"))
      parts.push({
        label: "Second opinion on the country advice",
        model: modelName(steps.countryAdvice.reviewer),
        calls: abroad.length,
        usd: times(abroad.length, TEXT_USD.countryAdviceReview),
      });
  }
  const languages = new Set(markets.map((m) => m.hl)).size;
  parts.push(
    {
      label: `Words used per country (text only): ${languages} ${languages === 1 ? "language" : "languages"}`,
      model: modelName(steps.conceptMap.model),
      calls: languages,
      usd: times(languages, TEXT_USD.conceptMap),
    },
    {
      label: "A/B tests to run next (text only)",
      model: modelName(steps.abTests.model),
      calls: 1,
      usd: [...TEXT_USD.abTests],
    },
  );
  // The knowledge base's share (Settings switch; off = no line), within its cap per report.
  const kb = kbApprovalLine(config, {
    main: abroad.length < markets.length,
    abroad: abroad.length,
    abTests: true,
  });
  if (kb)
    parts.push({
      label: kb.text,
      model: modelName(config.models.recommend),
      calls: 0,
      usd: kb.usd,
    });
  const textUsd = parts.reduce<[number, number]>((a, p) => sum(a, p.usd), [0, 0]);
  const usd = sum(images.usd, textUsd);
  const limitUsd = settingsOf(config).spending.perReportUsd;
  return {
    images,
    text: { parts, usd: textUsd, later: false },
    usd,
    limitUsd,
    overLimit: usd[1] > limitUsd,
    drop: null,
  };
}

interface Droppable {
  type: ReportScope["type"];
  markets: readonly MarketRef[];
  games: readonly { appId: string; name: string; ours: boolean }[];
  decks: readonly { appId: string; gl: string; country: string; state: string }[];
  items: readonly ScopeItem[];
  usd: [number, number];
  overLimit: boolean;
}

/**
 * Over the limit (plan-reports 2.2): the lowest-priority game and country combinations to leave
 * out (competitor order plus country order; never our game), until the total fits. Only a
 * proposal: it is applied when the user clicks "Leave these out".
 */
export function dropProposal(
  plan: Droppable,
  scope: ReportScope,
  rebuild: (s: ReportScope) => Droppable,
): DropProposal | null {
  const gameRank = new Map(plan.games.map((g, i) => [g.appId, i]));
  const marketRank = new Map(plan.markets.map((m, i) => [m.gl, i]));
  const paid = new Set(
    plan.items.filter((i) => i.tier !== "identical").map((i) => `${i.appId}|${i.gl}`),
  );
  const combos = plan.decks
    .filter((d) => d.state === "ok" && !plan.games.find((g) => g.appId === d.appId)?.ours)
    .filter((d) => paid.has(`${d.appId}|${d.gl}`))
    .map((d) => ({ d, g: gameRank.get(d.appId) ?? 0, m: marketRank.get(d.gl) ?? 0 }))
    .sort((a, b) => b.g + b.m - (a.g + a.m) || b.m - a.m);
  const leave: DropProposal["leaveOut"] = [];
  let last: Droppable = plan;
  for (const { d } of combos) {
    leave.push({
      appId: d.appId,
      name: plan.games.find((g) => g.appId === d.appId)?.name ?? d.appId,
      gl: d.gl,
      country: d.country,
    });
    last = rebuild({
      ...scope,
      leftOut: [...(scope.leftOut ?? []), ...leave.map((x) => ({ appId: x.appId, gl: x.gl }))],
    });
    if (!last.overLimit) break;
  }
  if (!leave.length) return null;
  return { leaveOut: leave, savesUsd: round(plan.usd[1] - last.usd[1]), fits: !last.overLimit };
}
