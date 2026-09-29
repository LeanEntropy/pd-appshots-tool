import type { batchEntries } from "../analysis/entries.ts";
import { labeler } from "../analysis/labels.ts";
import { compareOurs } from "../analysis/ours-vs.ts";
import { patternFit } from "../analysis/pattern-fit.ts";
import { findPatterns } from "../analysis/patterns.ts";
import { PROMPT_VERSIONS } from "../analysis/prompts.ts";
import { buildReportData, type ReportData } from "../analysis/report-data.ts";
import { synthesise } from "../analysis/synthesis.ts";
import { type LoadedConfig, loadTaxonomy } from "../config/load.ts";
import type { PlayContext } from "./ab-section.ts";
import type { CountrySlice } from "./build.ts";
import type { ReportAi } from "./country-ai.ts";
import { mainLabel, stepKey } from "./run-steps.ts";

/**
 * The main country inside a One country or Compare countries report (for example the main
 * country with more competitors): its own pattern wording, recommendations and their check,
 * written like the Full check's (plan-reports 3) from this report's competitors. Its A/B tests
 * are the report's own (one call over every country).
 */
export async function mainSynthesis(
  loaded: LoadedConfig,
  s: CountrySlice,
  e: ReturnType<typeof batchEntries> | undefined,
  ai: ReportAi,
  play: PlayContext,
  generatedAt: string,
): Promise<{ data: ReportData | null; problems: string[] }> {
  if (!e || e.competitors.length < 2 || e.missing.length) {
    ai.steps?.skipWaiting("not enough analysed competitors in this country", stepKey.main(""));
    return { data: null, problems: [] };
  }
  const { taxonomy } = loadTaxonomy(loaded);
  const label = labeler(taxonomy);
  const patterns = findPatterns(e.competitors, e.decks);
  const oursVs = compareOurs(e.ours, patterns, e.ourDeckLength, label);
  const fit = patternFit(e.competitors, e.ours, patterns, e.ourDeckLength, label);
  ai.report("recommend", `Writing the recommendations for ${s.market.label}…`);
  const r = await synthesise(
    {
      writer: ai.writers.rec,
      reviewer: ai.writers.recReview,
      prompts: {
        patterns: ai.prompts.patterns,
        recommend: ai.prompts.recommend,
        review: ai.prompts.recommendReview,
      },
      // The report writes its A/B tests once, over every country (the main one included).
      ab: null,
    },
    taxonomy,
    {
      patterns,
      oursVs,
      fit,
      ours: e.ours,
      competitors: e.competitors,
      ourDeckLength: e.ourDeckLength,
    },
    ai.ctx,
    (phase, message) => {
      ai.report(phase, message);
      ai.steps?.start(stepKey.main(phase), mainLabel(phase, s.market.label));
    },
  );
  // The patterns' own problem belongs to that step (the recommendations still run after it).
  const own = (p: string) => p.startsWith("pattern summary");
  ai.steps?.endRunning(r.problems.filter((p) => !own(p)).join("; ") || null);
  ai.steps?.end(stepKey.main("patterns"), r.problems.filter(own).join("; ") || null);
  ai.steps?.skipWaiting("not needed", stepKey.main(""));
  if (!r.recommendations && !r.interpretation) return { data: null, problems: r.problems };
  const data = buildReportData({
    ...s.inputs,
    play,
    generatedAt,
    latestAi: {
      runId: generatedAt,
      dataHash: s.inputs.dataHash,
      interpretation: r.interpretation,
      recommendations: r.recommendations,
      review: r.review,
      revised: !!r.draft,
      abTests: r.abTests,
      promptVersions: PROMPT_VERSIONS,
    },
  });
  return { data, problems: r.problems };
}
