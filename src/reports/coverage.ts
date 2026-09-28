import { type AnalysisRecord, isUsable, readRecords } from "../analysis/records.ts";
import { coreOrder, type LoadedConfig, projectPaths } from "../config/load.ts";
import { analysedSlots, fitFor } from "../core/selection.ts";
import { workspaceStorage } from "../storage/index.ts";
import { readDeck } from "../store/manifest.ts";
import type { ReportSummary } from "./list.ts";
import { chartGames, projectMarkets } from "./scope-plan.ts";
import { listDefs, readVersionInputs, versionFileKey } from "./store.ts";
import type { MarketRef } from "./types.ts";

export type CellState = "not-sold" | "not-downloaded" | "downloaded" | "partly" | "analysed";

export interface CoverageCell {
  gl: string;
  state: CellState;
  analysed: number;
  total: number;
  /** Names of the reports whose newest version uses this game in this country. */
  reports: string[];
}

export interface CoverageRow {
  appId: string;
  name: string;
  kind: "ours" | "competitor" | "chart";
  inPick: boolean;
  cells: CoverageCell[];
}

export interface Coverage {
  countries: MarketRef[];
  rows: CoverageRow[];
}

/** Which game and country each report's newest version used (from its version.json or data). */
function usedBy(loaded: LoadedConfig, reports: readonly ReportSummary[]): Map<string, string[]> {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const defs = new Map(listDefs(s, paths).map((d) => [d.id, d]));
  const out = new Map<string, string[]>();
  const add = (appId: string, gl: string, name: string) => {
    const k = `${appId}|${gl}`;
    const list = out.get(k) ?? [];
    if (!list.includes(name)) out.set(k, [...list, name]);
  };
  for (const r of reports) {
    const v = r.versions[0];
    const def = defs.get(r.id);
    if (!v || !def || r.archived) continue;
    const inputs = readVersionInputs(s, paths, v.id);
    if (inputs) {
      for (const rec of inputs.records)
        if (rec.updatedAt) add(rec.appId, rec.gl ?? inputs.scope.markets[0]?.gl ?? "", r.name);
      continue;
    }
    // Older runs: the games of their saved report data, in the report's own country.
    try {
      const d = s.getJson(versionFileKey(paths, v.id, "report-data.json")) as {
        games?: { appId?: unknown }[];
      };
      const gl = def.scope.markets[0]?.gl ?? "";
      for (const g of d?.games ?? []) if (typeof g.appId === "string") add(g.appId, gl, r.name);
    } catch {
      // No data: nothing to mark.
    }
  }
  return out;
}

/**
 * The coverage map (plan-reports 5A.1), code only: every game (ours, the project's competitors in
 * priority order, then the chart games) by every project country (the main country first). The
 * cell is the analysis coverage; "used in N reports" is a separate list on the cell.
 */
export function coverage(
  loaded: LoadedConfig,
  reports: readonly ReportSummary[],
  records: ReadonlyMap<string, AnalysisRecord> = readRecords(projectPaths(loaded)),
): Coverage {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const countries = projectMarkets(loaded);
  const used = usedBy(loaded, reports);
  const pick = new Set(fitFor(loaded).fit.selected.map((c) => c.appId));
  const names = new Map(config.competitors.map((c) => [c.id, c.name]));
  const order = coreOrder(loaded, paths).filter((id) => names.has(id));
  const rest = config.competitors.map((c) => c.id).filter((id) => !order.includes(id));
  const games = [
    { appId: config.ourApp.id, name: config.ourApp.name, kind: "ours" as const },
    ...[...order, ...rest].map((id) => ({
      appId: id,
      name: names.get(id) ?? id,
      kind: "competitor" as const,
    })),
    ...chartGames(loaded).map((g) => ({ ...g, kind: "chart" as const })),
  ];
  const rows = games.map((g) => ({
    ...g,
    inPick: pick.has(g.appId),
    cells: countries.map((m): CoverageCell => {
      const d = readDeck(paths.decks, { appId: g.appId, gl: m.gl, hl: m.hl });
      const reportsHere = used.get(`${g.appId}|${m.gl}`) ?? [];
      if (d?.status !== "ok")
        return {
          gl: m.gl,
          state: d?.status === "unavailable" ? "not-sold" : "not-downloaded",
          analysed: 0,
          total: 0,
          reports: reportsHere,
        };
      const slots = analysedSlots(config, d);
      const analysed = slots.filter((s) => s.imageId && isUsable(records.get(s.imageId))).length;
      const state: CellState =
        slots.length && analysed === slots.length ? "analysed" : analysed ? "partly" : "downloaded";
      return { gl: m.gl, state, analysed, total: slots.length, reports: reportsHere };
    }),
  }));
  // Chart games without any downloaded deck add nothing to the map.
  return {
    countries,
    rows: rows.filter((r) => r.kind !== "chart" || r.cells.some((c) => c.total > 0)),
  };
}
