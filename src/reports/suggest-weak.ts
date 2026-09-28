import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { analysedSlots } from "../core/selection.ts";
import { settingsOf } from "../settings/access.ts";
import { workspaceStorage } from "../storage/index.ts";
import { readDeck } from "../store/manifest.ts";
import type { Eligibility } from "./eligibility.ts";
import type { ReportSummary } from "./list.ts";
import { buildScopePlan, type PlanContext } from "./scope-plan.ts";
import { versionFileKey } from "./store.ts";
import { list, POINTS, type Signal } from "./suggest-points.ts";
import type { ReportScope } from "./types.ts";

const planCost = (loaded: LoadedConfig, scope: ReportScope, ctx: PlanContext) => {
  const p = buildScopePlan(loaded, scope, { proposeDrop: false, ctx });
  return p.counts.newImages || p.usd[1] > 0 ? { images: p.counts.newImages, usd: p.usd } : null;
};

interface SavedData {
  patterns?: {
    perPosition?: {
      position: number;
      n: number;
      types: { key: string; n: number; share: number }[];
    }[];
  };
  labels?: Record<string, string>;
}

/**
 * Weak or split positions of the latest Full check (the Pilot while there is none): a position
 * with few games, or a split vote, and the unanalysed competitors whose decks would settle it.
 */
export function weakPatterns(
  loaded: LoadedConfig,
  reports: readonly ReportSummary[],
  e: Eligibility,
  older: boolean,
  pickIds: readonly string[],
  mainName: string,
  ctx: PlanContext,
): Signal[] {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const opts = settingsOf(config).suggestions;
  const main = settingsOf(config).mainMarket;
  const rep = reports.find(
    (r) => r.type === (e.coreReady ? "core" : "pilot") && r.markets[0] === main.gl,
  );
  const v = rep?.versions.find((x) => x.format === "data");
  if (!rep || !v) return [];
  let d: SavedData | null;
  try {
    d = workspaceStorage(paths.workspace).getJson(
      versionFileKey(paths, v.id, "report-data.json"),
    ) as SavedData | null;
  } catch {
    return [];
  }
  const weak = (d?.patterns?.perPosition ?? []).filter((p) => {
    const top = p.types[0]?.share ?? 0;
    return p.n < opts.weakN || (top >= opts.splitLow && top <= opts.splitHigh);
  });
  if (!weak.length) return [];
  const settlers = config.competitors
    .filter((c) => {
      if (pickIds.includes(c.id)) return false;
      const deck = readDeck(paths.decks, { appId: c.id, gl: main.gl, hl: main.hl });
      const n = deck?.status === "ok" ? analysedSlots(config, deck).length : 0;
      return n >= (weak[0]?.position ?? 1);
    })
    .slice(0, 3);
  if (!settlers.length) return [];
  const label = (k: string) => (d?.labels?.[k] ?? k.replace(/_/g, " ")).toLowerCase();
  const p = weak[0] as (typeof weak)[number];
  const [a, b] = p.types;
  const detail =
    a && b && a.share <= opts.splitHigh
      ? `is split between ${label(a.key)} and ${label(b.key)} (${a.n} vs ${b.n} games)`
      : `rests on ${p.n} ${p.n === 1 ? "game" : "games"}`;
  const nth = ["1st", "2nd", "3rd"][p.position - 1] ?? `${p.position}th`;
  const more =
    weak.length > 1
      ? ` (and ${weak.length - 1} more ${weak.length === 2 ? "position" : "positions"})`
      : "";
  const scope: ReportScope = {
    type: "country",
    markets: [{ gl: main.gl, hl: main.hl, label: main.label }],
    competitors: [...pickIds, ...settlers.map((c) => c.id)],
    includeCharts: [],
  };
  return [
    {
      key: `weak:${settlers.map((c) => c.id).join(",")}`,
      category: "weak",
      title: "Settle the weak patterns",
      why: `The ${nth} image ${detail}${more}: analysing ${list(settlers.map((c) => c.name))} would settle it.`,
      what: `${mainName}: ${list(settlers.map((c) => c.name))} added to your pick`,
      value: weak.reduce(
        (n, x) => n + POINTS.weakPattern + (x.position <= 3 ? POINTS.weakPatternFirstThree : 0),
        0,
      ),
      cost: planCost(loaded, scope, ctx),
      action: { label: "Set up this report", scope },
      second: null,
      older,
      countryIndex: 0,
      competitorIndex: 0,
    },
  ];
}
