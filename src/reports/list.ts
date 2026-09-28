import { readLatest } from "../analysis/final-report.ts";
import type { ReportInputs } from "../analysis/report-data.ts";
import { reportInputs } from "../analysis/report-inputs.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { legacyAnalysisJob, readJournal } from "../jobs/journal.ts";
import { workspaceStorage } from "../storage/index.ts";
import { mainMarket } from "./main-market.ts";
import { syncPresetReports } from "./migrate.ts";
import { listDefs, readVersionInputs, runFolders, versionFileKey } from "./store.ts";
import { isPreset, type ReportDef, TYPE_NAMES } from "./types.ts";

export interface VersionSummary {
  id: string;
  generatedAt: string;
  archived: boolean;
  /** "data": the full report; "markdown": an older run, shown as it was written. */
  format: "data" | "markdown";
}

export interface ReportSummary {
  id: string;
  name: string;
  type: ReportDef["type"];
  typeName: string;
  countries: string;
  competitors: number | null;
  /** The competitors the newest version was built from (for the Pilot and Full check, the pick). */
  competitorNames: string[];
  /** Generation date of the newest version, null when none. */
  generatedAt: string | null;
  status: { kind: "ready" | "partial" | "running" | "none" | "draft"; text: string };
  /** The "Newer data" badge with its reason in plain words, or null. */
  newer: string | null;
  archived: boolean;
  deletable: boolean;
  /** The Pilot and the Full check can also be shown as they stand now (from the saved analyses). */
  canNow: boolean;
  /** Newest first. */
  versions: VersionSummary[];
}

const countriesOf = (d: ReportDef) =>
  d.scope.markets.length > 3
    ? d.scope.markets.map((m) => m.gl.toUpperCase()).join(" ")
    : d.scope.markets.map((m) => m.label).join(", ");

/** Why the data differs from what the newest version was built from, in plain words. */
function newerReason(
  x: ReportInputs,
  main: { gl: string; hl: string },
  inputs: ReturnType<typeof readVersionInputs>,
  savedHash: string | null,
): string | null {
  if (inputs && (inputs.mainMarket.gl !== main.gl || inputs.mainMarket.hl !== main.hl))
    return "The main country changed.";
  if (!savedHash || savedHash === x.dataHash) return null;
  if (inputs) {
    const was = new Set(inputs.pick.map((g) => g.appId));
    const now = new Set(x.plan.games.map((g) => g.appId));
    const added = x.plan.games.filter((g) => !was.has(g.appId)).map((g) => g.name);
    const removed = inputs.pick.filter((g) => !now.has(g.appId)).map((g) => g.name);
    if (added.length || removed.length)
      return `The pick changed (${[...added.map((n) => `${n} added`), ...removed.map((n) => `${n} removed`)].join(", ")}).`;
    if (inputs.versions.taxonomy !== x.plan.versions.taxonomy)
      return "The screen-type list was updated.";
  }
  return "New or updated analyses since this version was made.";
}

/**
 * The Report tab's list (plan-reports 5): runs the idempotent upkeep of the Pilot and Full check
 * reports first, then summarises every report. Code only; the Pilot and Full check "Newer data"
 * check compares the current data fingerprint with the newest version's (as today's report does).
 */
export function listReports(loaded: LoadedConfig): ReportSummary[] {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const main = mainMarket(loaded);
  syncPresetReports(s, paths, main);
  const folders = runFolders(s, paths);
  const job = readJournal(s, paths).jobs.ai ?? legacyAnalysisJob(s, paths) ?? undefined;
  const now = new Map<string, ReportInputs>();
  const current = (stage: "pilot" | "core") => {
    let x = now.get(stage);
    if (!x) {
      x = reportInputs(loaded, stage);
      now.set(stage, x);
    }
    return x;
  };
  const out = listDefs(s, paths).map((d): ReportSummary => {
    const versions: VersionSummary[] = d.versions
      .filter((v) => folders.has(v.id))
      .map((v) => ({
        id: v.id,
        generatedAt: v.generatedAt,
        archived: v.archived,
        format: folders.get(v.id)?.has("report-data.json")
          ? ("data" as const)
          : ("markdown" as const),
      }))
      .reverse();
    const newest = versions[0];
    const files = newest ? folders.get(newest.id) : undefined;
    const inputs =
      newest && files?.has("version.json") ? readVersionInputs(s, paths, newest.id) : null;
    // The report's own inputs first (version.json, then the saved report data), else the pick now.
    const saved = newest && files?.has("report-data.json") ? savedData(s, paths, newest.id) : null;
    const ours = loaded.config.ourApp.id;
    let names: string[] | null = inputs
      ? inputs.pick.filter((g) => g.appId !== ours).map((g) => g.name)
      : saved?.competitorNames?.length
        ? saved.competitorNames
        : null;
    let status: ReportSummary["status"] = newest
      ? { kind: "ready", text: "Ready" }
      : isPreset(d.type)
        ? { kind: "none", text: "Not run yet" }
        : { kind: "draft", text: "Draft" };
    let newer: string | null = null;
    if (isPreset(d.type)) {
      const x = current(d.type);
      names ??= x.plan.games.filter((g) => g.appId !== x.ourAppId).map((g) => g.name);
      if (newest && !files?.has("recommendations.json") && !saved?.hasRecommendations)
        status = { kind: "partial", text: "Partial: no recommendations written" };
      if (job?.state === "running" && job.stage === d.type)
        status = {
          kind: "running",
          text: `Analysing ${job.progress.done} of ${job.progress.total}`,
        };
      const hash = inputs?.dataHash ?? readLatest(paths, d.type)?.dataHash ?? null;
      if (newest) newer = newerReason(x, main, inputs, hash);
    }
    return {
      id: d.id,
      name: d.name,
      type: d.type,
      typeName: TYPE_NAMES[d.type],
      countries: countriesOf(d),
      competitors: names ? names.length : null,
      competitorNames: names ?? [],
      generatedAt: newest?.generatedAt ?? null,
      status,
      newer,
      archived: d.archived,
      deletable: !isPreset(d.type),
      canNow: isPreset(d.type),
      versions,
    };
  });
  // Drafts first, then newest first; reports never run go last.
  const rank = (r: ReportSummary) => (r.status.kind === "draft" ? 0 : r.generatedAt ? 1 : 2);
  return out.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.generatedAt ?? "").localeCompare(a.generatedAt ?? "") ||
      a.name.localeCompare(b.name),
  );
}

/**
 * From a version's saved report data: its competitors (the games that are not ours) and whether it
 * carries recommendations. Null when the file is unreadable or not in the expected shape.
 */
function savedData(
  s: ReturnType<typeof workspaceStorage>,
  c: { projectId: string },
  versionId: string,
): { competitorNames: string[] | null; hasRecommendations: boolean } | null {
  try {
    const d = s.getJson(versionFileKey(c, versionId, "report-data.json")) as {
      games?: unknown;
      ai?: { recommendations?: unknown } | null;
    };
    const games = Array.isArray(d?.games)
      ? (d.games as { name?: unknown; ours?: unknown }[])
      : null;
    return {
      competitorNames: games
        ? games.filter((g) => !g.ours && typeof g.name === "string").map((g) => String(g.name))
        : null,
      hasRecommendations: !!d?.ai?.recommendations,
    };
  } catch {
    return null;
  }
}
