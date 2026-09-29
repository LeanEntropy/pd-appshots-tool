import { join } from "node:path";
import type { CallContext } from "../analysis/call.ts";
import {
  type PromptName,
  type RenderedPrompt,
  type ReportPromptName,
  renderPrompt,
  renderReportPrompt,
} from "../analysis/prompts.ts";
import { type Provider, providerFor } from "../analysis/providers.ts";
import type { StepTracker } from "../analysis/run-status.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { answerKey } from "../library/layout.ts";
import { secondOpinionOn, settingsOf } from "../settings/access.ts";
import { workspaceStorage } from "../storage/index.ts";

/**
 * The text-only AI of a country report (country advice and its second opinion, words used, the
 * A/B tests, and the main country's recommendations when it is in the report). "paid": real
 * providers within the approved limit (the report's AI batch). "cached": providers that never
 * call a model, so a free build reuses every answer already paid for and marks the rest missing.
 */
export interface ReportAi {
  mode: "paid" | "cached";
  ctx: CallContext;
  writers: {
    advice: Provider;
    adviceReview: Provider | null;
    concept: Provider;
    ab: Provider;
    rec: Provider;
    recReview: Provider | null;
  };
  prompts: {
    advice: RenderedPrompt;
    adviceReview: RenderedPrompt;
    concept: RenderedPrompt;
    ab: RenderedPrompt;
    patterns: RenderedPrompt;
    recommend: RenderedPrompt;
    recommendReview: RenderedPrompt;
  };
  report: (phase: string, message: string) => void;
  /** The paid run's step list (the run panel): each text step starts and ends here. */
  steps?: StepTracker;
}

/** The model references of the report's text steps (Settings page). */
export function reportModels(loaded: LoadedConfig) {
  const { config } = loaded;
  const steps = settingsOf(config).steps;
  return {
    advice: steps.countryAdvice.model,
    adviceReview: secondOpinionOn(config, "countryAdvice") ? steps.countryAdvice.reviewer : null,
    concept: steps.conceptMap.model,
    ab: steps.abTests.model,
    rec: config.models.recommend,
    recReview: secondOpinionOn(config, "recommendations")
      ? config.models.recommendationReview
      : null,
  };
}

/** A provider that never calls a model: validatedCall then finds only answers already saved. */
export function cacheOnly(ref: string): Provider {
  const [kind, model] = ref.split(":") as [string, string];
  return {
    family: kind === "codex" ? "openai" : "anthropic",
    model,
    async call() {
      return { ok: false, output: null, costUsd: 0, error: "not written yet" };
    },
  };
}

export function reportPrompts(loaded: LoadedConfig): ReportAi["prompts"] {
  const paths = projectPaths(loaded);
  const tx = loadTaxonomy(loaded).taxonomy;
  const r = (n: ReportPromptName) => renderReportPrompt(loaded.root, paths.objects, n, tx);
  const p = (n: PromptName) => renderPrompt(loaded.root, paths.objects, n, tx);
  return {
    advice: r("countryAdvice"),
    adviceReview: r("countryAdviceReview"),
    concept: r("conceptMap"),
    ab: p("abTests"),
    patterns: p("patterns"),
    recommend: p("recommend"),
    recommendReview: p("recommendReview"),
  };
}

export function callContext(
  loaded: LoadedConfig,
  budget: { remainingUsd: () => number; onCost: (u: number) => void },
): CallContext {
  const paths = projectPaths(loaded);
  const { taxonomy, hash } = loadTaxonomy(loaded);
  return {
    storage: workspaceStorage(paths.workspace),
    answerKey: (step, key) => answerKey(paths, step, key),
    taxonomy,
    taxonomyHash: hash,
    maxBudgetUsd: 3,
    remainingUsd: budget.remainingUsd,
    timeoutMs: 900_000,
    onCost: budget.onCost,
  };
}

/** The free build's AI: every saved answer, and no model call. */
export function cachedAi(loaded: LoadedConfig): ReportAi {
  const m = reportModels(loaded);
  return {
    mode: "cached",
    ctx: callContext(loaded, { remainingUsd: () => Number.POSITIVE_INFINITY, onCost: () => {} }),
    writers: {
      advice: cacheOnly(m.advice),
      adviceReview: m.adviceReview ? cacheOnly(m.adviceReview) : null,
      concept: cacheOnly(m.concept),
      ab: cacheOnly(m.ab),
      rec: cacheOnly(m.rec),
      recReview: m.recReview ? cacheOnly(m.recReview) : null,
    },
    prompts: reportPrompts(loaded),
    report: () => {},
  };
}

/** The paid run's AI: real providers, within what is left of the approved limit. */
export function paidAi(
  loaded: LoadedConfig,
  ctx: CallContext,
  report: ReportAi["report"],
  make: (ref: string) => Provider = (ref) =>
    providerFor(ref, join(projectPaths(loaded).objects, "schemas")),
): ReportAi {
  const m = reportModels(loaded);
  return {
    mode: "paid",
    ctx,
    writers: {
      advice: make(m.advice),
      adviceReview: m.adviceReview ? make(m.adviceReview) : null,
      concept: make(m.concept),
      ab: make(m.ab),
      rec: make(m.rec),
      recReview: m.recReview ? make(m.recReview) : null,
    },
    prompts: reportPrompts(loaded),
    report,
  };
}
