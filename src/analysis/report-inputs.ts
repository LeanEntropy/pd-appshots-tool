import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { coreDeck, notInCoreMarket } from "../core/selection.ts";
import { attributesOf, marketData, metaInput } from "../engine/inputs.ts";
import { legacyAnalysisJob, readJournal } from "../jobs/journal.ts";
import { readLayoutFile } from "../layout/store.ts";
import { playContextOf } from "../reports/play-context.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import { openImageDb } from "../store/imagedb.ts";
import type { AbTestsOutput } from "./ab-tests-schema.ts";
import { reportLabeler } from "./categories.ts";
import { withMeasuredRecords } from "./colour-store.ts";
import { repeatsOfItems, sameCheck } from "./deck-repeats.ts";
import { batchDataHash } from "./entries.ts";
import { readLatest } from "./final-report.ts";
import { labeler } from "./labels.ts";
import { orderHistory } from "./orders.ts";
import { type AnalysisPlan, buildAnalysisPlan, readSavedPlan, type Stage } from "./plan.ts";
import { withCurrentMapping } from "./record-refresh.ts";
import { readRecords } from "./records.ts";
import { buildReportData, type ReportInputs } from "./report-data.ts";
import { reportMarkdown } from "./report-md.ts";
import { compareStoreText } from "./store-compare.ts";
import type { Interpretation, Recommendations, Review } from "./synthesis-schema.ts";

/** One saved report run of a stage. */
export interface ReportRun {
  runId: string;
  createdAt: string;
  hasData: boolean;
}

/** Saved runs of a stage, newest first (folders reports/<run id>/ with a report.md). */
export function listRuns(loaded: LoadedConfig, stage: Stage): ReportRun[] {
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const prefix = projectKey(paths, "reports");
  const files = new Set<string>();
  for (const k of storage.list(prefix)) files.add(k.slice(prefix.length + 1));
  return [...files]
    .filter((f) => f.endsWith("/report.md"))
    .map((f) => f.slice(0, -"/report.md".length))
    .filter((d) => !d.includes("/") && /^\d{4}-/.test(d) && d.endsWith(`-${stage}`))
    .sort()
    .reverse()
    .map((runId) => ({
      runId,
      createdAt: runId.slice(0, 10),
      hasData: files.has(`${runId}/report-data.json`),
    }));
}

/** A saved report run's file (report.md, report-data.json, ...) as a storage key. */
export function runFileKey(loaded: LoadedConfig, runId: string, name: string): string {
  return projectKey(projectPaths(loaded), "reports", runId, name);
}

/** Prompt versions a run's AI parts were written with: its version.json, else its run manifest. */
function runPromptVersions(loaded: LoadedConfig, runId: string): Record<string, string> | null {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  type V = { versions?: { prompts?: Record<string, string> } } | undefined;
  const v = s.getJson(runFileKey(loaded, runId, "version.json")) as V;
  const m = s.getJson(projectKey(paths, "runs", runId, "manifest.json")) as V;
  return v?.versions?.prompts ?? m?.versions?.prompts ?? null;
}

/** Everything the pure report builder needs, read from disk (no AI). */
export function reportInputs(
  loaded: LoadedConfig,
  stage: Stage,
  override: { plan?: AnalysisPlan; ai?: ReportInputs["latestAi"]; skip?: string | null } = {},
): ReportInputs {
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const saved = override.plan ?? readSavedPlan(loaded, stage);
  // The cost of the next approval is the batch as it would be proposed now (no AI, not saved).
  const proposed = buildAnalysisPlan(loaded, stage);
  const plan = saved ?? proposed;
  const records = withMeasuredRecords(paths, loaded.config, withCurrentMapping(readRecords(paths)));
  const db = openImageDb(paths);
  const m = plan.market;
  const decks = new Map(plan.games.map((g) => [g.appId, coreDeck(loaded, g.appId)]));
  const orderDates = new Map(
    plan.games.map((g) => [g.appId, orderHistory(paths, g.appId, m.gl, m.hl).at(-1)?.date ?? null]),
  );
  let latestAi: ReportInputs["latestAi"] = override.ai ?? null;
  if (override.ai === undefined) {
    const latest = readLatest(paths, stage);
    const read = <T>(name: string) =>
      latest
        ? ((storage.getJson(runFileKey(loaded, latest.runId, name)) as T | undefined) ?? null)
        : null;
    const recommendations = read<Recommendations>("recommendations.json");
    const interpretation = read<Interpretation>("interpretation.json");
    if (latest && (recommendations || interpretation))
      latestAi = {
        runId: latest.runId,
        dataHash: latest.dataHash,
        interpretation,
        recommendations,
        review: read<Review>("review.json"),
        revised: !!read<Recommendations>("recommendations-draft.json"),
        abTests: read<AbTestsOutput>("ab-tests.json"),
        promptVersions: runPromptVersions(loaded, latest.runId),
      };
  }
  const status =
    readJournal(storage, paths).jobs.ai ?? legacyAnalysisJob(storage, paths) ?? undefined;
  const skip =
    override.skip !== undefined
      ? override.skip
      : status?.stage === stage
        ? (status.error ?? status.synthesisSkipped ?? null)
        : null;
  return {
    plan,
    approved: !!saved,
    ourAppId: loaded.config.ourApp.id,
    records,
    decks,
    db,
    orderDates,
    label: reportLabeler(labeler(loadTaxonomy(loaded).taxonomy)),
    dataHash: batchDataHash(plan, records),
    latestAi,
    lastSkip: skip,
    estimateUsd: proposed.estimate.usd,
    leftOut: notInCoreMarket(loaded).map((c) => c.name),
    play: playContextOf(loaded.config, [m]),
    repeats: repeatsOfItems(plan.items, (id) => db.get(id), sameCheck(paths, records)),
    focus: (id) => {
      const r = records.get(id);
      return (r && readLayoutFile(paths, r)?.layout.composition?.focus?.kind) || null;
    },
    attrs: attributesOf(paths, records),
    market: marketData(storage, paths, plan.games, m.gl),
    meta: metaInput(
      loaded,
      storage,
      marketData(
        storage,
        paths,
        loaded.config.competitors.map((c) => ({ appId: c.id, name: c.name })),
        m.gl,
      ),
    ),
    storeText: compareStoreText(
      storage,
      loaded.config.markets,
      { appId: loaded.config.ourApp.id, name: loaded.config.ourApp.name },
      plan.games.filter((g) => g.appId !== loaded.config.ourApp.id),
    ),
  };
}

/**
 * Writes the report as it stands now (no AI) to reports/current-<stage>/report.md. The folder
 * depth matches the run folders, so the relative image links work the same way.
 */
export function writeCurrentReport(loaded: LoadedConfig, stage: Stage): string {
  const inputs = reportInputs(loaded, stage);
  const data = buildReportData(inputs);
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const fileKey = projectKey(paths, "reports", `current-${stage}`, "report.md");
  const head = [
    `# ${stage === "pilot" ? "Core pilot" : "Core check"}: report from the saved analyses`,
    "",
    `Market: ${data.market}. Written ${new Date().toISOString().slice(0, 16).replace("T", " ")} from the analyses on disk, with no AI call.`,
    "",
  ];
  storage.putText(fileKey, `${[...head, ...reportMarkdown(data, inputs.label)].join("\n")}\n`);
  return storage.localPath(fileKey);
}
