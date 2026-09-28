import type { ProjectContext, Storage } from "../storage/index.ts";
import { marketName } from "./main-market.ts";
import { defKey, listDefs, readDef, readVersionInputs, runFolders, saveDef } from "./store.ts";
import {
  dateFromRunId,
  type MarketRef,
  type ReportDef,
  ReportDefSchema,
  TYPE_NAMES,
  type VersionEntry,
} from "./types.ts";

type Stage = "pilot" | "core";
const STAGES: Stage[] = ["pilot", "core"];

/** The files that make a run folder a readable report version (pilot.md: the oldest format). */
const REPORT_FILES = ["report.md", "report-data.json", "pilot.md"];

/** The def a Pilot or Full check of the main country lives in: r-pilot / r-core (plan 7). */
export function presetId(defs: readonly ReportDef[], stage: Stage, main: MarketRef): string {
  const own = defs.find(
    (d) =>
      d.type === stage && d.scope.markets[0]?.gl === main.gl && d.scope.markets[0]?.hl === main.hl,
  );
  if (own) return own.id;
  const base = `r-${stage}`;
  return defs.some((d) => d.id === base) ? `${base}-${main.gl}-${main.hl.toLowerCase()}` : base;
}

/**
 * Migration and upkeep of the Pilot and Full check reports (plan-reports 7), code only, no AI,
 * idempotent. Ensures the main country's two preset defs exist and lists every run folder
 * reports/<timestamp>-pilot/ and -core/ as a version of its report; all but the newest are
 * archived (D3). It only ever writes files under reports/defs/: no run folder, latest-*.json,
 * pending/ or state/ file is moved or rewritten. Returns the ids of the defs it wrote.
 */
export function syncPresetReports(
  s: Storage,
  c: ProjectContext,
  main: MarketRef,
  now = new Date(),
): string[] {
  const written: string[] = [];
  const folders = runFolders(s, c);
  for (const stage of STAGES) {
    let defs = listDefs(s, c);
    const id = presetId(defs, stage, main);
    // Created complete in one write-once step, so an interrupted run can simply run again.
    if (!readDef(s, c, id)) {
      const def: ReportDef = {
        id,
        // "Pilot report"; one made after a main-country change also names its country.
        name: `${TYPE_NAMES[stage]} report${id === `r-${stage}` ? "" : ` (${marketName(main)})`}`,
        type: stage,
        scope: { type: stage, markets: [main], competitors: [], includeCharts: [] },
        createdAt: now.toISOString(),
        archived: false,
        versions: [],
      };
      if (s.putJsonOnce(defKey(c, id), ReportDefSchema.parse(def))) written.push(id);
      defs = listDefs(s, c);
    }
    const fallback = `r-${stage}`;
    const presets = new Map(defs.filter((d) => d.type === stage).map((d) => [d.id, d]));
    // The generation date of each version: its version.json, else its run id (older runs).
    const dates = new Map<string, string>();
    const add = new Map<string, VersionEntry[]>();
    for (const [folder, files] of folders) {
      if (!folder.endsWith(`-${stage}`) || !REPORT_FILES.some((f) => files.has(f))) continue;
      const inputs = files.has("version.json") ? readVersionInputs(s, c, folder) : null;
      const generatedAt = inputs?.generatedAt ?? dateFromRunId(folder) ?? now.toISOString();
      dates.set(folder, generatedAt);
      const owner = inputs && presets.has(inputs.reportId) ? inputs.reportId : fallback;
      const def = presets.get(owner);
      if (!def || def.versions.some((v) => v.id === folder)) continue;
      add.set(owner, [...(add.get(owner) ?? []), { id: folder, generatedAt, archived: false }]);
    }
    // Every preset def converges to its canonical state (dates, order, all but the newest
    // archived), and is written only when that differs from what is saved.
    for (const def of presets.values()) {
      const versions = [...def.versions, ...(add.get(def.id) ?? [])]
        .map((v) => ({ ...v, generatedAt: dates.get(v.id) ?? v.generatedAt }))
        .sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
      const newest = versions.at(-1)?.id;
      const next = { ...def, versions: versions.map((v) => ({ ...v, archived: v.id !== newest })) };
      if (JSON.stringify(next.versions) === JSON.stringify(def.versions)) continue;
      saveDef(s, c, next);
      if (!written.includes(def.id)) written.push(def.id);
    }
  }
  return written;
}
