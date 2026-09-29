import type { LoadedConfig } from "../config/load.ts";
import { countrySlices, scopeDataHash } from "./build.ts";
import { withLayerRecords } from "./country-inputs.ts";
import { type Eligibility, scopeIncomplete } from "./eligibility.ts";
import { mainMarketRef } from "./main-market.ts";
import { buildScopePlan, type PlanContext } from "./scope-plan.ts";
import type { ReportDef, VersionInputs } from "./types.ts";

/** "~$16–29" (whole dollars from $10 up, each end on its own), "~$0.58–1.53" below. */
export function shortRange(lo: number, hi: number): string {
  const f = (n: number) => (n >= 10 ? String(Math.round(n)) : n.toFixed(2));
  return f(lo) === f(hi) ? `~$${f(hi)}` : `~$${f(lo)}–${f(hi)}`;
}

/**
 * A draft's status chip, short (the list row is one line): "Draft · 182 images · ~$16–29",
 * "Draft · ready to build, free", or "Draft · " plus what is still missing (code only).
 */
export function draftStatus(loaded: LoadedConfig, def: ReportDef, ctx: PlanContext): string {
  const incomplete = scopeIncomplete(def.scope);
  if (incomplete)
    return `Draft · ${incomplete.charAt(0).toLowerCase()}${incomplete.slice(1).replace(/\.$/, "")}`;
  try {
    const p = buildScopePlan(loaded, def.scope, { proposeDrop: false, ctx });
    if (p.instant) return "Draft · ready to build, free";
    const n = p.counts.newImages;
    const what = n ? `${n} ${n === 1 ? "image" : "images"}` : "written parts only";
    return `Draft · ${what} · ${shortRange(p.usd[0], p.usd[1])}`;
  } catch {
    return "Draft";
  }
}

/**
 * "Newer data" for a report made by the builder (plan-reports 4.2), in plain words, or null: the
 * main country changed, a Full check exists now for a report built on the Pilot only, or the
 * analyses or store pages of its games and countries changed.
 */
export function builderNewer(
  loaded: LoadedConfig,
  def: ReportDef,
  inputs: VersionInputs | null,
  e: Eligibility,
  ctx: PlanContext,
): string | null {
  if (!inputs) return null;
  const main = mainMarketRef(loaded);
  if (inputs.mainMarket.gl !== main.gl || inputs.mainMarket.hl !== main.hl)
    return "The main country changed.";
  const reasons: string[] = [];
  if (inputs.base === "pilot" && e.coreReady) reasons.push("a Full check is now available");
  try {
    const plan = buildScopePlan(loaded, def.scope, { proposeDrop: false, ctx });
    if (
      inputs.dataHash &&
      scopeDataHash(
        plan,
        countrySlices(loaded, plan, { ...ctx, records: withLayerRecords(loaded, plan).records }),
      ) !== inputs.dataHash
    )
      reasons.push("new or updated analyses or store pages since this version was made");
  } catch {
    // Unreadable data: no badge rather than a wrong one.
  }
  if (!reasons.length) return null;
  const text = reasons.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
