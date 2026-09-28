import type { batchEntries } from "../analysis/entries.ts";
import type { FitSummary } from "../analysis/pattern-fit.ts";
import type { Patterns } from "../analysis/patterns.ts";
import type { AiPart, ReportInputs } from "../analysis/report-data.ts";
import { type AbTestsPart, abTestsPart } from "./ab-section.ts";
import { type SummaryPart, summaryPart } from "./summary.ts";
export const OLDER_STYLE =
  "Written in the older style: the insights and recommendations below come from before the store-page expert voice and the A/B tests.";
const TEXT_STEPS = ["patterns", "recommend", "recommendReview", "abTests"];

/** The AI parts were written with other text-prompt versions than today's. */
export function olderStyle(
  was: Record<string, string> | null | undefined,
  now: Record<string, string>,
) {
  return !!was && TEXT_STEPS.some((k) => was[k] !== now[k]);
}

/** The summary (3C) and the A/B tests (3B) of the report, by code (AI wording when current). */
export function bottomLine(
  x: ReportInputs,
  entries: ReturnType<typeof batchEntries>,
  fit: FitSummary | null,
  patterns: Patterns | null,
  ai: AiPart | null,
): { summary: SummaryPart; abTests: AbTestsPart } {
  const m = x.plan.market;
  const play = x.play ?? {
    reportMarkets: [m],
    projectMarkets: [m],
    traffic: {},
    preRegistration: false,
  };
  const current = !!ai?.current;
  return {
    summary: summaryPart({
      fit,
      interpretation: ai?.interpretation ?? null,
      recommendations: ai?.recommendations ?? null,
      aiCurrent: current,
      competitors: entries.decks.length,
      market: m.label,
      label: x.label,
      generatedAt: x.generatedAt ?? null,
      orderDates: [...x.orderDates.values()],
      analysedAt: [...entries.ours, ...entries.competitors].map(
        (e) => x.records.get(e.imageId)?.updatedAt ?? null,
      ),
    }),
    abTests: abTestsPart({
      fit,
      ours: entries.ours,
      ourDeckLength: entries.ourDeckLength,
      deckLength: patterns?.deckLength ?? null,
      label: x.label,
      market: m,
      play,
      ai: ai?.abTests ?? null,
      aiCurrent: current,
    }),
  };
}
