import { isUsable } from "../analysis/records.ts";
import type { LoadedConfig } from "../config/load.ts";
import { withLayerRecords } from "./country-inputs.ts";
import { mainMarketRef } from "./main-market.ts";
import { presetId } from "./migrate.ts";
import { countryName } from "./names.ts";
import { buildScopePlan, type PlanContext } from "./scope-plan.ts";
import type { ReportDef, VersionInputs } from "./types.ts";

type Dependency = NonNullable<VersionInputs["dependencyScope"]>;

/**
 * "Newer data" for a One country report made from a comparison (plan-cross-country 2.2), on its
 * dependency scope only: this country's analysed images and store dates, and the main country's
 * check the advice rests on. A change in another compared country never marks it. Plain words,
 * with separate reasons; null when nothing it rests on changed.
 */
export function derivedReasons(
  dep: Dependency,
  now: {
    records: { appId: string; position: number; imageId: string | null; updatedAt: string | null }[];
    orderDates: Record<string, string | null>;
    baseVersionId: string | null;
  },
  names: { country: string; main: string; game: (appId: string) => string },
): string[] {
  const reasons: string[] = [];
  const saved = new Map(dep.records.map((r) => [`${r.appId}|${r.position}`, r]));
  const changed = now.records.filter((r) => {
    const o = saved.get(`${r.appId}|${r.position}`);
    return r.updatedAt !== null && (!o || o.imageId !== r.imageId || o.updatedAt !== r.updatedAt);
  }).length;
  const moved = Object.entries(now.orderDates)
    .filter(([k, d]) => d && k in dep.orderDates && dep.orderDates[k] !== d)
    .map(([k]) => names.game(k.split("@")[0] ?? k));
  const here: string[] = [];
  if (moved.length) here.push(`new store pages of ${moved.join(", ")}`);
  if (changed) here.push(`${changed} new or updated ${changed === 1 ? "analysis" : "analyses"}`);
  if (here.length) reasons.push(`${names.country}'s pages changed (${here.join("; ")})`);
  if (dep.baseVersionId && now.baseVersionId && dep.baseVersionId !== now.baseVersionId)
    reasons.push(`the ${names.main} baseline changed (a newer check was made there)`);
  return reasons;
}

export function derivedNewer(
  loaded: LoadedConfig,
  def: ReportDef,
  inputs: VersionInputs,
  defs: readonly ReportDef[],
  ctx: PlanContext,
): string | null {
  const dep = inputs.dependencyScope;
  if (!dep) return null;
  const main = mainMarketRef(loaded);
  if (inputs.mainMarket.gl !== main.gl || inputs.mainMarket.hl !== main.hl)
    return "The main country changed.";
  try {
    const plan = buildScopePlan(loaded, def.scope, { proposeDrop: false, ctx });
    const { records } = withLayerRecords(loaded, plan);
    const gl = inputs.displayScope?.gl ?? def.scope.markets[0]?.gl ?? "";
    const now = plan.items
      .filter((i) => !i.anchorAdded && i.gl === gl)
      .map((i) => {
        const r = records.get(i.imageId);
        return {
          appId: i.appId,
          position: i.position,
          imageId: i.imageId,
          updatedAt: isUsable(r) ? r.updatedAt : null,
        };
      });
    const orderDates = Object.fromEntries(
      plan.decks.filter((d) => d.gl === gl).map((d) => [`${d.appId}@${d.gl}`, d.orderDate]),
    );
    const base = defs.find((d) => d.id === presetId(defs, inputs.base ?? "core", main));
    const reasons = derivedReasons(
      dep,
      { records: now, orderDates, baseVersionId: base?.versions.at(-1)?.id ?? null },
      {
        country: countryName(inputs.displayScope?.label ?? def.scope.markets[0]?.label ?? ""),
        main: countryName(main.label),
        game: (id) => plan.games.find((g) => g.appId === id)?.name ?? id,
      },
    );
    if (!reasons.length) return null;
    const text = reasons.join("; ");
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
  } catch {
    return null;
  }
}
