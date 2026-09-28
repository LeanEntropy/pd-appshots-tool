import { isUsable } from "../analysis/records.ts";
import { buildReportData, type ReportInputs } from "../analysis/report-data.ts";
import { reportInputs } from "../analysis/report-inputs.ts";
import { reportMarkdown } from "../analysis/report-md.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import { newRunId } from "../store/manifest.ts";
import { mainMarketRef } from "./main-market.ts";
import { presetId, syncPresetReports } from "./migrate.ts";
import { addVersion, listDefs, versionFileKey, writeVersionInputs } from "./store.ts";
import { isPreset, type ReportDef, type VersionInputs } from "./types.ts";

/** version.json of a Pilot or Full check version, from the same inputs its report was built from. */
export function presetVersionInputs(
  x: ReportInputs,
  o: { reportId: string; stage: "pilot" | "core"; main: VersionInputs["mainMarket"]; now: Date },
): VersionInputs {
  const at = o.now.toISOString();
  return {
    reportId: o.reportId,
    type: o.stage,
    generatedAt: at,
    createdAt: at,
    mainMarket: o.main,
    scope: {
      type: o.stage,
      markets: [x.plan.market],
      competitors: x.plan.games.map((g) => g.appId).filter((id) => id !== x.ourAppId),
      includeCharts: [],
    },
    pick: x.plan.games.map((g) => ({ appId: g.appId, name: g.name, positions: g.positions })),
    orderDates: Object.fromEntries(x.orderDates),
    records: x.plan.games.flatMap((g) =>
      g.positions.map((position) => {
        const it = x.plan.items.find((i) => i.appId === g.appId && i.position === position);
        const r = it ? x.records.get(it.imageId) : undefined;
        return {
          appId: g.appId,
          position,
          imageId: it?.imageId ?? null,
          updatedAt: isUsable(r) ? r.updatedAt : null,
        };
      }),
    ),
    versions: x.plan.versions,
    planHash: x.approved ? x.plan.planHash : null,
    dataHash: x.dataHash,
    aiRunId: x.latestAi?.runId ?? null,
  };
}

/**
 * A finished Pilot or Full check run becomes the newest version of its report, and the previous
 * version is archived. Never fails the run: the Report tab's upkeep lists the folder anyway.
 */
export function recordPresetRun(loaded: LoadedConfig, x: ReportInputs, runId: string): void {
  try {
    const paths = projectPaths(loaded);
    const s = workspaceStorage(paths.workspace);
    const main = mainMarketRef(loaded);
    const stage = x.plan.stage;
    // version.json first: the upkeep then lists the folder with this exact generation date.
    const reportId = presetId(listDefs(s, paths), stage, main);
    const v = presetVersionInputs(x, { reportId, stage, main, now: new Date() });
    writeVersionInputs(s, paths, runId, v);
    syncPresetReports(s, paths, main);
    addVersion(s, paths, reportId, { id: runId, generatedAt: v.generatedAt });
  } catch {
    // Recovered by syncPresetReports on the next list.
  }
}

/** Finds a report by id or by name (case-insensitive), archived ones included. */
export function findReport(defs: readonly ReportDef[], idOrName: string): ReportDef | undefined {
  const q = idOrName.trim().toLowerCase();
  return defs.find((d) => d.id === q) ?? defs.find((d) => d.name.toLowerCase() === q);
}

/**
 * `npm run report -- <report name or id>`: a new version of a Pilot or Full check report from the
 * saved analyses, with no AI call. The previous version is archived. Returns the report.md path.
 */
export function buildPresetVersion(loaded: LoadedConfig, def: ReportDef, now = new Date()): string {
  if (!isPreset(def.type))
    throw new Error(
      "Only the Pilot and the Full check can be rebuilt in this version of the tool.",
    );
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const stage = def.type;
  const x = reportInputs(loaded, stage);
  const data = buildReportData(x);
  const versionId = newRunId(stage, now);
  const main = def.scope.markets[0] ?? mainMarketRef(loaded);
  const mdKey = versionFileKey(paths, versionId, "report.md");
  if (s.exists(mdKey)) throw new Error("A version was just built. Try again in a moment.");
  s.putJsonOnce(versionFileKey(paths, versionId, "report-data.json"), data);
  const head = [
    `# ${def.name}`,
    "",
    `Generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC from the saved analyses, with no AI call. Market: ${data.market}.`,
    "",
  ];
  s.putText(mdKey, `${[...head, ...reportMarkdown(data, x.label)].join("\n")}\n`);
  const v = presetVersionInputs(x, { reportId: def.id, stage, main, now });
  writeVersionInputs(s, paths, versionId, v);
  addVersion(s, paths, def.id, { id: versionId, generatedAt: v.generatedAt });
  return s.localPath(mdKey);
}
