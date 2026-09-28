import { buildAnalysisPlan } from "../analysis/plan.ts";
import type { LoadedConfig } from "../config/load.ts";
import { settingsOf } from "../settings/access.ts";
import { theCountry } from "./names.ts";
import { presetOutcome } from "./ready.ts";
import type { ReportType } from "./types.ts";

export interface Eligibility {
  /** A Ready Pilot (or Full check) version with its recommendations exists (decision D1). */
  pilotReady: boolean;
  coreReady: boolean;
  /** Per type: open, or the reason it is greyed out. */
  types: Record<ReportType, { open: boolean; reason: string }>;
  /** "Highly recommended: run the Full check first", with its numbers; null when not needed. */
  warning: string | null;
  /** The check reports of this project rest on now. */
  base: "pilot" | "core" | null;
}

const money = (n: number) => `$${n < 10 ? n.toFixed(2).replace(/\.00$/, "") : Math.round(n)}`;

/**
 * The one eligibility rule (plan-reports 1.1, D1), used by the builder, the API, the suggestions
 * and the tests: only the Pilot is required. Once it has a Ready version with its recommendations,
 * every type is open; a Full check of the main country is highly recommended, not required.
 */
export function eligibility(loaded: LoadedConfig): Eligibility {
  const core = presetOutcome(loaded, "core").ready;
  const pilot = core || presetOutcome(loaded, "pilot").ready;
  const after = { open: pilot, reason: pilot ? "" : "Available after the Pilot." };
  let warning: string | null = null;
  if (pilot && !core) {
    const main = theCountry(settingsOf(loaded.config).mainMarket.label);
    try {
      const plan = buildAnalysisPlan(loaded, "core");
      const pilotN = buildAnalysisPlan(loaded, "pilot").games.length - 1;
      const n = plan.games.length - 1;
      const [lo, hi] = plan.estimate.usd;
      const cost = plan.counts.newImages ? `, about ${money(lo)} to ${money(hi)}` : ", free";
      warning = `Highly recommended: run the Full check of ${main} first (${n} competitors${cost}). Country advice built on the Pilot alone rests on ${pilotN} ${pilotN === 1 ? "competitor" : "competitors"}.`;
    } catch {
      warning = `Highly recommended: run the Full check of ${main} first. Reports built on the Pilot alone rest on few competitors.`;
    }
  }
  return {
    pilotReady: pilot,
    coreReady: core,
    types: { pilot: { open: true, reason: "" }, core: after, country: after, compare: after },
    warning,
    base: core ? "core" : pilot ? "pilot" : null,
  };
}

/** Why a builder scope cannot be planned or built yet (a draft may be saved incomplete). */
export function scopeIncomplete(scope: {
  type: ReportType;
  markets: readonly unknown[];
}): string | null {
  if (scope.type === "country" && scope.markets.length !== 1)
    return "Pick the country of this report.";
  if (scope.type === "compare" && scope.markets.length < 2)
    return "Tick at least two countries to compare.";
  return null;
}

/** Why a report of this type cannot be made now, or null (the API's check). */
export function eligibilityProblem(e: Eligibility, type: ReportType): string | null {
  const t = e.types[type];
  return t.open ? null : t.reason;
}
