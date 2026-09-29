import { buildReportData } from "../analysis/report-data.ts";
import { loadCountries } from "../config/countries.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import { countrySlices } from "./build.ts";
import { withLayerRecords } from "./country-inputs.ts";
import type { CountryReport } from "./country-report-types.ts";
import { readDerived } from "./derived-relations.ts";
import type { GroupsPart } from "./group-types.ts";
import { groupsPart } from "./groups-part.ts";
import { mainMarketRef } from "./main-market.ts";
import { playContextOf } from "./play-context.ts";
import { buildScopePlan, planContext } from "./scope-plan.ts";
import { listDefs, readDef, saveDef } from "./store.ts";
import type { ReportDef } from "./types.ts";

/**
 * What the page gets with a comparison or a country report made from one (code only, no AI):
 * the group part (the main country's competitor pages read as they are saved now), the links
 * between a comparison and its country reports, and the saved group edits.
 */
function mainGames(loaded: LoadedConfig, def: ReportDef) {
  const main = mainMarketRef(loaded);
  const ctx = planContext(loaded);
  const plan = buildScopePlan(
    loaded,
    { ...def.scope, type: "country", markets: [main], groups: undefined, leftOut: undefined },
    { proposeDrop: false, ctx },
  );
  const { records } = withLayerRecords(loaded, plan);
  const [slice] = countrySlices(loaded, plan, { ...ctx, records });
  return slice ? { market: main, games: buildReportData(slice.inputs).games } : null;
}

export function groupsFor(
  loaded: LoadedConfig,
  def: ReportDef,
  report: CountryReport,
): GroupsPart | null {
  if (report.type !== "compare") return null;
  let main = null;
  try {
    main = mainGames(loaded, def);
  } catch {
    // Without the main country's pages, only the compared countries are used.
  }
  return groupsPart({
    report,
    main,
    saved: def.scope.groups,
    regions: loadCountries().groupRegions,
    play: playContextOf(loaded.config, def.scope.markets, def.scope.platform === "appstore"),
  });
}

/** The country reports made from a comparison (active, existing), for "Open as its own report". */
export function countryReportsOf(loaded: LoadedConfig, id: string): { gl: string; id: string }[] {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const e = readDerived(s, paths).comparisons.find((c) => c.reportId === id);
  return (e?.children ?? [])
    .filter((c) => c.state === "active" && readDef(s, paths, c.reportId)?.versions.length)
    .map((c) => ({ gl: c.gl, id: c.reportId }));
}

/** The band of a country report made from a comparison: the comparison now, and its siblings. */
export function derivedLink(loaded: LoadedConfig, def: ReportDef) {
  if (!def.derivedFrom) return null;
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const defs = listDefs(s, paths);
  const parent = defs.find((d) => d.id === def.derivedFrom?.reportId);
  return {
    parentId: parent?.id ?? null,
    parentName: parent?.name ?? null,
    siblings: parent ? countryReportsOf(loaded, parent.id).filter((c) => c.id !== def.id) : [],
  };
}

/** Saves the groups of a comparison (names and countries; any version shows them). */
export function saveGroups(
  loaded: LoadedConfig,
  def: ReportDef,
  groups: ReportDef["scope"]["groups"],
) {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const next = { ...def, scope: { ...def.scope, groups: groups?.length ? groups : undefined } };
  saveDef(s, paths, next);
  return next;
}
