import { categoryOfType, reportLabeler } from "../analysis/categories.ts";
import { plainLabel } from "../analysis/labels.ts";
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
    tags?: { logoPerPosition?: { position: number; n: number; of: number }[] };
  };
}

type Position = NonNullable<NonNullable<SavedData["patterns"]>["perPosition"]>[number];
const label = (k: string) => reportLabeler(plainLabel)(k).toLowerCase();

/**
 * A position's screen types merged into the report categories: reports saved before the
 * categories (2026-09-29) split title, feature, key and loading art, which are one category now.
 */
function byCategory(p: Position): Position["types"] {
  const m = new Map<string, number>();
  for (const t of p.types) m.set(categoryOfType(t.key), (m.get(categoryOfType(t.key)) ?? 0) + t.n);
  return [...m.entries()]
    .map(([key, n]) => ({ key, n, share: p.n ? n / p.n : 0 }))
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
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
  const split = (share: number) => share >= opts.splitLow && share <= opts.splitHigh;
  const positions = (d?.patterns?.perPosition ?? []).map((p) => ({ ...p, types: byCategory(p) }));
  const weakType = positions.filter((p) => p.n < opts.weakN || split(p.types[0]?.share ?? 0));
  // The game logo split in the first 3 images (with vs without) is weak evidence too.
  const weakLogo = (d?.patterns?.tags?.logoPerPosition ?? []).filter(
    (l) => l.position <= 3 && l.of >= opts.weakN && split(Math.max(l.n, l.of - l.n) / l.of),
  );
  const weak = [...weakType.map((p) => p.position), ...weakLogo.map((l) => l.position)];
  if (!weak.length) return [];
  const settlers = config.competitors
    .filter((c) => {
      if (pickIds.includes(c.id)) return false;
      const deck = readDeck(paths.decks, { appId: c.id, gl: main.gl, hl: main.hl });
      const n = deck?.status === "ok" ? analysedSlots(config, deck).length : 0;
      return n >= Math.min(...weak);
    })
    .slice(0, 3);
  if (!settlers.length) return [];
  const p = weakType[0];
  const l = weakLogo[0];
  const [a, b] = p?.types ?? [];
  const why = p
    ? a && b && a.share <= opts.splitHigh
      ? `Image ${p.position} is split between ${label(a.key)} (${a.n} games) and ${label(b.key)} (${b.n} games)`
      : `Image ${p.position} rests on ${p.n} ${p.n === 1 ? "game" : "games"}`
    : l
      ? `Image ${l.position} is split on the game logo (${l.n} of ${l.of} competitors show it)`
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
      why: `${why}: analysing ${list(settlers.map((c) => c.name))} would settle it.`,
      what: `${mainName}: ${list(settlers.map((c) => c.name))} added to your pick`,
      value: [...new Set(weak)].reduce(
        (n, x) => n + POINTS.weakPattern + (x <= 3 ? POINTS.weakPatternFirstThree : 0),
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
