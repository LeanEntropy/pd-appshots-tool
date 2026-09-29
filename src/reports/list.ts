import { readLatest } from "../analysis/final-report.ts";
import type { ReportInputs } from "../analysis/report-data.ts";
import { reportInputs } from "../analysis/report-inputs.ts";
import { loadCountries } from "../config/countries.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { legacyAnalysisJob, readJournal } from "../jobs/journal.ts";
import { workspaceStorage } from "../storage/index.ts";
import { builderNewer, draftStatus } from "./builder-status.ts";
import { reconcileDerived } from "./derived-relations.ts";
import { derivedNewer } from "./derived-stale.ts";
import { eligibility } from "./eligibility.ts";
import { mainMarketRef } from "./main-market.ts";
import { syncPresetReports } from "./migrate.ts";
import { countryName } from "./names.ts";
import { sameScope } from "./same-scope.ts";
import { type PlanContext, planContext } from "./scope-plan.ts";
import { newerReason } from "./stale.ts";
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
  /** The country codes of the report, the first one first. */
  markets: string[];
  /** The plain country names in the same order ("Hong Kong", never its language). */
  countryNames: string[];
  /** The same, with the language where the country offers more than one ("Hong Kong (Traditional Chinese)", "United States"). */
  countryLabels: string[];
  /** Another report set up exactly like this one (same kind, countries and games), or null. */
  sameAs: string | null;
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
  /** A One country report made from a comparison: the comparison (its name null once deleted). */
  derivedFrom?: { id: string; name: string | null } | null;
}

/** Plain country names, never codes (from the version's own scope when saved). */
const countriesOf = (markets: ReportDef["scope"]["markets"]) =>
  markets.map((m) => m.label).join(", ");

/**
 * The Report tab's list (plan-reports 5): runs the idempotent upkeep of the Pilot and Full check
 * reports first, then summarises every report. Code only; the Pilot and Full check "Newer data"
 * check compares the current data fingerprint with the newest version's (as today's report does).
 */
export function listReports(loaded: LoadedConfig): ReportSummary[] {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const main = mainMarketRef(loaded);
  // A country's language is named only where the country offers more than one.
  const multiLang = new Set(
    loadCountries()
      .countries.filter((c) => c.languages.length > 1)
      .map((c) => c.gl),
  );
  syncPresetReports(s, paths, main);
  try {
    // Country reports of finished comparisons (code only, idempotent; plan-cross-country 2.2).
    reconcileDerived(loaded);
  } catch {
    // Finished on the next list.
  }
  const folders = runFolders(s, paths);
  const job = readJournal(s, paths).jobs.ai ?? legacyAnalysisJob(s, paths) ?? undefined;
  const now = new Map<string, ReportInputs>();
  let elig: ReturnType<typeof eligibility> | undefined;
  let ctx: PlanContext | undefined;
  const current = (stage: "pilot" | "core") => {
    let x = now.get(stage);
    if (!x) {
      x = reportInputs(loaded, stage);
      now.set(stage, x);
    }
    return x;
  };
  const defs = listDefs(s, paths);
  const out = defs.map((d): ReportSummary => {
    const versions: VersionSummary[] = d.versions
      .filter((v) => folders.has(v.id))
      .map((v) => ({
        id: v.id,
        generatedAt: v.generatedAt,
        archived: v.archived,
        format: ["report-data.json", "countries.json", "country-report.json"].some((f) =>
          folders.get(v.id)?.has(f),
        )
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
        status = { kind: "partial", text: "Partial \u00b7 no recommendations" };
      if (job?.state === "running" && job.stage === d.type)
        status = {
          kind: "running",
          text: `Analysing ${job.progress.done} of ${job.progress.total}`,
        };
      const hash = inputs?.dataHash ?? readLatest(paths, d.type)?.dataHash ?? null;
      if (newest) newer = newerReason(x, main, inputs, hash);
    } else if (!newest) {
      ctx ??= planContext(loaded);
      status = { kind: "draft", text: draftStatus(loaded, d, ctx) };
    } else {
      elig ??= eligibility(loaded);
      ctx ??= planContext(loaded);
      newer = inputs?.derivedFrom
        ? derivedNewer(loaded, d, inputs, defs, ctx)
        : builderNewer(loaded, d, inputs, elig, ctx);
      const left =
        newest && files?.has("country-report.json") ? missingParts(s, paths, newest.id) : 0;
      if (left)
        status = {
          kind: "partial",
          text: `Partial \u00b7 ${left} ${left === 1 ? "part" : "parts"} missing`,
        };
    }
    if (job?.state === "running" && job.reportId === d.id)
      status = { kind: "running", text: job.progress.message || "Running" };
    const markets = inputs?.scope.markets ?? d.scope.markets;
    return {
      id: d.id,
      name: d.name,
      type: d.type,
      typeName: TYPE_NAMES[d.type],
      countries: countriesOf(markets),
      markets: markets.map((m) => m.gl),
      countryNames: markets.map((m) => countryName(m.label)),
      countryLabels: markets.map((m) => (multiLang.has(m.gl) ? m.label : countryName(m.label))),
      sameAs: d.archived ? null : (sameScope(defs, d.scope, d.id)[0]?.name ?? null),
      competitors: names ? names.length : null,
      competitorNames: names ?? [],
      generatedAt: newest?.generatedAt ?? null,
      status,
      newer,
      archived: d.archived,
      deletable: !isPreset(d.type),
      canNow: isPreset(d.type),
      versions,
      derivedFrom: d.derivedFrom
        ? {
            id: d.derivedFrom.reportId,
            name: defs.find((x) => x.id === d.derivedFrom?.reportId)?.name ?? null,
          }
        : null,
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

/** How many AI parts a country version lacks (0 when unreadable). */
function missingParts(
  s: ReturnType<typeof workspaceStorage>,
  c: { projectId: string },
  versionId: string,
): number {
  try {
    const d = s.getJson(versionFileKey(c, versionId, "country-report.json")) as {
      missing?: unknown[];
    };
    return Array.isArray(d?.missing) ? d.missing.length : 0;
  } catch {
    return 0;
  }
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
