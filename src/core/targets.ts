import type { Config, Market } from "../config/schema.ts";
import type { ChartResult } from "../play/client.ts";

export type Group = "ours" | "named" | "chart";

export interface DeckTarget {
  appId: string;
  name: string;
  group: Group;
  tier: "direct" | "same_audience" | "reference" | "chart" | "ours";
  gl: string;
  hl: string;
  /** Chart rank per country code, when the app appears in a configured chart. */
  chartRanks: Record<string, number>;
}

export function deckKey(t: { appId: string; gl: string; hl: string }): string {
  return `${t.appId}|${t.gl}|${t.hl}`;
}

/**
 * The project's main country (Settings page, default United States): the one market the Pilot
 * and the Full check run in, the baseline every "what changed" comparison is made against, and
 * the anchor of the suggestions. The config rules make the baseline and core.market the same.
 */
export function mainMarket(config: Config): Market {
  const m = config.markets.find((x) => x.gl === config.core.market);
  if (!m) throw new Error("The main country is not one of the project's countries.");
  return m;
}

/** @deprecated Use mainMarket (kept while other branches still call it). */
export const baselineMarket = mainMarket;
/** @deprecated Use mainMarket (kept while other branches still call it). */
export const coreMarket = mainMarket;

/**
 * Every deck (app x market) Setup downloads: our deck, the named competitors and the chart
 * games of each configured country (in that country plus the baseline locale).
 * Order: ours, named competitors in config order, then chart games by first appearance.
 */
export function buildTargets(config: Config, charts: readonly ChartResult[]): DeckTarget[] {
  const baseline = mainMarket(config);
  const out = new Map<string, DeckTarget>();
  const add = (t: DeckTarget) => {
    const k = deckKey(t);
    if (!out.has(k)) out.set(k, t);
  };
  const marketsFor = (scope: "all" | "baseline") => (scope === "all" ? config.markets : [baseline]);

  for (const m of marketsFor(config.download.ourMarkets)) {
    add({
      appId: config.ourApp.id,
      name: config.ourApp.name,
      group: "ours",
      tier: "ours",
      gl: m.gl,
      hl: m.hl,
      chartRanks: {},
    });
  }
  for (const c of config.competitors) {
    for (const m of marketsFor(config.download.namedCompetitorMarkets)) {
      add({
        appId: c.id,
        name: c.name,
        group: "named",
        tier: c.tier,
        gl: m.gl,
        hl: m.hl,
        chartRanks: {},
      });
    }
  }

  const named = new Map(config.competitors.map((c) => [c.id, c]));
  const ranks = new Map<string, Record<string, number>>();
  for (const chart of charts) {
    if (chart.status !== "ok") continue;
    const market = config.markets.find((m) => m.gl === chart.gl);
    if (!market) continue;
    for (const e of chart.entries) {
      const r = ranks.get(e.appId) ?? {};
      r[chart.gl] = e.rank;
      ranks.set(e.appId, r);
      const locales = [market];
      if (config.charts.includeBaselineLocale) locales.push(baseline);
      const c = named.get(e.appId);
      for (const m of locales) {
        const where = { gl: m.gl, hl: m.hl, chartRanks: {} };
        if (e.appId === config.ourApp.id) {
          add({ appId: e.appId, name: config.ourApp.name, group: "ours", tier: "ours", ...where });
        } else if (c) {
          add({ appId: c.id, name: c.name, group: "named", tier: c.tier, ...where });
        } else {
          add({ appId: e.appId, name: e.title, group: "chart", tier: "chart", ...where });
        }
      }
    }
  }
  for (const t of out.values()) t.chartRanks = { ...(ranks.get(t.appId) ?? {}) };
  return [...out.values()];
}
