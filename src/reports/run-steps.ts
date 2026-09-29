import { languageName } from "../analysis/play-experiments.ts";
import type { Provider } from "../analysis/providers.ts";
import { STOPPED_STEP } from "../analysis/run-status.ts";
import type { LoadedConfig } from "../config/load.ts";
import { reportModels } from "./country-ai.ts";
import { countryName } from "./names.ts";
import type { ScopePlan } from "./scope-plan.ts";

/**
 * The steps of a report's AI batch after the images, in the order the run makes them (see
 * assembleCountryReport): the words used per language, the advice per country and its second
 * opinion, the main country's patterns and recommendations, the A/B tests, then the report.
 * A fix after a check is added when it happens. Keys are what the steps are started with.
 */
export const stepKey = {
  words: (hl: string) => `words:${hl}`,
  advice: (gl: string) => `advice:${gl}`,
  adviceCheck: (gl: string) => `advice-check:${gl}`,
  adviceFix: (gl: string) => `advice-fix:${gl}`,
  main: (phase: string) => `main:${phase}`,
  ab: "ab",
  build: "build",
};

export const adviceFixLabel = (label: string) =>
  `Fixing the advice for ${countryName(label)} after the check`;

export const mainLabel = (phase: string, label: string): string => {
  const c = countryName(label);
  if (phase === "patterns") return `Patterns across the competitors in ${c}`;
  if (phase === "recommend") return `Recommendations for ${c}`;
  if (phase === "recommend-review") return `Check of the recommendations for ${c} (second opinion)`;
  if (phase === "recommend-revise") return `Fixing the recommendations for ${c} after the check`;
  return `${phase} (${c})`;
};

export function plannedSteps(
  loaded: LoadedConfig,
  plan: ScopePlan,
): { key: string; label: string }[] {
  // "Google Play vs App Store": its written parts are made by code.
  if (plan.type === "stores") return [{ key: stepKey.build, label: "Building the report" }];
  const m = reportModels(loaded);
  const isMain = (x: { gl: string; hl: string }) => x.gl === plan.main.gl && x.hl === plan.main.hl;
  const out: { key: string; label: string }[] = [];
  for (const hl of [...new Set(plan.markets.map((x) => x.hl))])
    out.push({ key: stepKey.words(hl), label: `Words used in ${languageName(hl)}` });
  for (const x of plan.markets) {
    if (isMain(x)) continue;
    const c = countryName(x.label);
    out.push({ key: stepKey.advice(x.gl), label: `Advice for ${c}` });
    if (m.adviceReview)
      out.push({
        key: stepKey.adviceCheck(x.gl),
        label: `Check of the advice for ${c} (second opinion by the other AI)`,
      });
  }
  const main = plan.markets.find(isMain);
  if (main) {
    const phases = ["patterns", "recommend", ...(m.recReview ? ["recommend-review"] : [])];
    for (const p of phases) out.push({ key: stepKey.main(p), label: mainLabel(p, main.label) });
  }
  out.push({ key: stepKey.ab, label: "A/B tests" });
  out.push({ key: stepKey.build, label: "Building the report" });
  return out;
}

/** Providers that start no new call once Stop is pressed (the text steps end one by one). */
export function stopGuard(
  make: (ref: string) => Provider,
  shouldStop: () => boolean,
): (ref: string) => Provider {
  return (ref) => {
    const p = make(ref);
    return {
      ...p,
      call: (c) =>
        shouldStop()
          ? Promise.resolve({ ok: false, output: null, costUsd: 0, error: STOPPED_STEP })
          : p.call(c),
    };
  };
}
