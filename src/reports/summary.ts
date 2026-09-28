import type { Labeler } from "../analysis/labels.ts";
import type { FitSummary } from "../analysis/pattern-fit.ts";
import type { Interpretation, Recommendations } from "../analysis/synthesis-schema.ts";

/**
 * The summary at the top of every report (plan-reports 3C): the short answer, the key
 * recommendations and the dates. The verdict is computed by code; the AI's short answer is used
 * only when it is current and keeps that verdict word, otherwise code writes it.
 */
export interface SummaryPart {
  shortAnswer: string;
  /** True when the short answer is the AI's wording (current, with the computed verdict). */
  worded: boolean;
  /** The top changes, one line each, with the position (full spec in Recommendations). */
  keyRecommendations: { position: number; text: string }[];
  /** The recommendations came from older data. */
  recommendationsStale: boolean;
  country: string;
  dates: {
    generated: string | null;
    storeFrom: string | null;
    storeTo: string | null;
    analyses: string | null;
  };
}

export interface SummaryInput {
  fit: FitSummary | null;
  interpretation: Interpretation | null;
  recommendations: Recommendations | null;
  aiCurrent: boolean;
  competitors: number;
  market: string;
  label: Labeler;
  generatedAt: string | null;
  orderDates: (string | null)[];
  analysedAt: (string | null)[];
}

const KEEP = /^keep our current position/i;

export function summaryPart(x: SummaryInput): SummaryPart {
  const f = x.fit;
  const ai = x.aiCurrent ? x.interpretation : null;
  // Reports saved before the short answer existed have none.
  const short = (ai as { shortAnswer?: string } | null)?.shortAnswer ?? "";
  const worded = !!f && !!short && short.toLowerCase().includes(f.verdict);
  const code = f
    ? [
        `Our store page is ${f.verdict} compared with ${x.competitors} ${x.competitors === 1 ? "competitor" : "competitors"} in ${x.market}${f.score !== null ? `: it fits ${Math.round(f.score * 100)}% of their weighted patterns` : ""}.`,
        f.keyPoints[0]
          ? `The most important change: ${f.keyPoints[0]}`
          : "It already follows every competitor pattern found.",
      ].join(" ")
    : "Not enough competitor data yet for a verdict: at least 2 competitors need analysed screenshots.";
  const recs = x.recommendations
    ? [...x.recommendations.positions].sort((a, b) => a.position - b.position)
    : [];
  const changes = recs.filter((p) => !KEEP.test(p.source));
  const keyRecommendations = changes.slice(0, 5).map((p) => {
    const headline = p.marketingLayer.present ? p.marketingLayer.texts[0]?.text : "";
    return {
      position: p.position,
      text: `${x.label(p.screenType)}${p.subtype ? ` / ${x.label(p.subtype)}` : ""}${headline ? `, headline "${headline}"` : ""} (${p.source})`,
    };
  });
  const dates = (xs: (string | null)[]) => xs.filter((d): d is string => !!d).sort();
  const store = dates(x.orderDates);
  const analysed = dates(x.analysedAt);
  return {
    shortAnswer: worded ? short : code,
    worded,
    keyRecommendations,
    recommendationsStale: !!x.recommendations && !x.aiCurrent,
    country: x.market,
    dates: {
      generated: x.generatedAt,
      storeFrom: store[0] ?? null,
      storeTo: store.at(-1) ?? null,
      analyses: analysed.at(-1)?.slice(0, 10) ?? null,
    },
  };
}
