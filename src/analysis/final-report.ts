import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type LoadedConfig,
  loadTaxonomy,
  type ProjectPaths,
  projectPaths,
} from "../config/load.ts";
import type { ImageDb } from "../store/imagedb.ts";
import { ensureDir, readJsonIfExists, writeJsonAtomic } from "../util/fsx.ts";
import { artWording } from "./art-wording.ts";
import { labeler } from "./labels.ts";
import { compareOrders, orderHistory } from "./orders.ts";
import type { AnalysisPlan, Stage } from "./plan.ts";
import { buildReportData } from "./report-data.ts";
import { reportInputs } from "./report-inputs.ts";
import { reportMarkdown } from "./report-md.ts";
import type { RunOutcome } from "./run.ts";

const usd = (n: number) => `$${n.toFixed(2)}`;
const STAGE = { pilot: "Core pilot", core: "Core check" };

export interface LatestReport {
  runId: string;
  file: string;
  createdAt: string;
  /** Fingerprint of the analyses the patterns and recommendations were built from. */
  dataHash: string | null;
  complete: boolean;
}

export function latestFile(paths: ProjectPaths, stage: Stage): string {
  return join(paths.reports, `latest-${stage}.json`);
}

export function readLatest(paths: ProjectPaths, stage: Stage): LatestReport | undefined {
  return readJsonIfExists(latestFile(paths, stage)) as LatestReport | undefined;
}

/** Markdown report plus all its data as JSON in reports/<run id>/; updates the latest pointer. */
export function writeFinalReport(
  loaded: LoadedConfig,
  plan: AnalysisPlan,
  o: RunOutcome,
  _db: ImageDb,
  dataHash: string | null = null,
): string {
  const paths = projectPaths(loaded);
  const dir = join(paths.reports, o.runId);
  ensureDir(dir);
  const label = labeler(loadTaxonomy(loaded).taxonomy);
  const count = (s: string) => o.records.filter((r) => r.status === s).length;
  const s = o.synthesis;
  const lines = [
    `# ${STAGE[plan.stage]}: final report`,
    "",
    `Run ${o.runId}. Market: ${plan.market.label}. Spent: ${usd(o.spentUsd)} on Claude (estimate ${usd(plan.estimate.usd[0])} to ${usd(plan.estimate.usd[1])}).`,
    "",
  ];
  if (o.aborted) lines.push(`**${o.aborted}**`, "");
  if (o.stoppedForBudget)
    lines.push("**Stopped: the spending limit for this batch was reached.**", "");
  lines.push(
    `- Analysed in this run: ${o.records.length}. Accepted: ${count("ok")}. Settled after a disagreement: ${count("adjudicated")}. Still disputed: ${count("disputed")}. Not double-checked (second opinion failed, first reading kept): ${count("unreviewed")}. Failed: ${count("failed")}.`,
    "",
  );
  if (o.errors.length) {
    lines.push("## Problems", "");
    for (const e of o.errors)
      lines.push(
        `- ${e.name ? `${e.name}${e.position ? ` #${e.position}` : ""}: ` : ""}${e.message}`,
      );
    lines.push("");
  }
  if (o.synthesisSkipped)
    lines.push(`Patterns and recommendations were not written: ${o.synthesisSkipped}`, "");
  // The same report model as the gallery's Report page: deterministic content always, AI after.
  const data = buildReportData(
    reportInputs(loaded, plan.stage, {
      plan,
      skip: o.synthesisSkipped,
      ai:
        s && (s.recommendations || s.interpretation)
          ? {
              runId: o.runId,
              dataHash,
              interpretation: s.interpretation,
              recommendations: s.recommendations,
              review: s.review,
              revised: !!s.draft,
            }
          : undefined,
    }),
  );
  lines.push(...reportMarkdown(data, label));
  const changes = plan.games.flatMap((g) => {
    const h = orderHistory(paths, g.appId, plan.market.gl, plan.market.hl);
    const [prev, last] = [h.at(-2), h.at(-1)];
    if (!prev || !last) return [];
    const ch = compareOrders(prev, last, label);
    return [`- ${g.name}, since ${prev.date}: ${ch.length ? ch.join("; ") : "no change"}`];
  });
  if (changes.length) lines.push("## Store order changes", "", ...changes, "");
  const file = join(dir, "report.md");
  writeFileSync(file, `${artWording(lines.join("\n"))}\n`);
  const files: Record<string, unknown> = {
    "report-data.json": data,
    "patterns.json": o.patterns,
    "ours-vs.json": o.oursVs,
    "interpretation.json": s?.interpretation ?? null,
    "recommendations.json": s?.recommendations ?? null,
    "recommendations-draft.json": s?.draft ?? null,
    "review.json": s?.review ?? null,
  };
  for (const [name, value] of Object.entries(files))
    if (value) writeJsonAtomic(join(dir, name), value);
  const latest: LatestReport = {
    runId: o.runId,
    file,
    createdAt: new Date().toISOString(),
    dataHash,
    complete: !!s?.recommendations,
  };
  writeJsonAtomic(latestFile(paths, plan.stage), latest);
  return file;
}
