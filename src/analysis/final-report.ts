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
import { labeler } from "./labels.ts";
import { compareOrders, orderHistory } from "./orders.ts";
import type { AnalysisPlan, Stage } from "./plan.ts";
import { readRecords, screenLabel } from "./records.ts";
import {
  cell,
  oursSection,
  patternSection,
  recommendationSection,
  thumb,
} from "./report-sections.ts";
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
  db: ImageDb,
  dataHash: string | null = null,
): string {
  const paths = projectPaths(loaded);
  const dir = join(paths.reports, o.runId);
  ensureDir(dir);
  const all = readRecords(paths);
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
    `- Analysed in this run: ${o.records.length}. Accepted: ${count("ok")}. Settled after a disagreement: ${count("adjudicated")}. Still disputed: ${count("disputed")}. Second opinion missing: ${count("unreviewed")}. Failed: ${count("failed")}.`,
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
  if (s?.recommendations)
    lines.push(...recommendationSection(s.recommendations, s.review, !!s.draft, label));
  if (o.oursVs) lines.push(...oursSection(o.oursVs, db, label));
  if (o.patterns) lines.push(...patternSection(o.patterns, s?.interpretation ?? null, label));

  lines.push("## Store order and screenshots", "");
  for (const g of plan.games) {
    const hist = orderHistory(paths, g.appId, plan.market.gl, plan.market.hl);
    const last = hist.at(-1);
    const prev = hist.at(-2);
    lines.push(`### ${g.name}`, "");
    if (last) lines.push(`Store order saved for ${last.date}.`);
    if (last && prev) {
      const ch = compareOrders(prev, last, label);
      lines.push(`Changes since ${prev.date}: ${ch.length ? ch.join("; ") : "none"}.`);
    }
    lines.push(
      "",
      "| Position | Screenshot | Screen type | Headline | Layer | Status | Differences between readings |",
      "|---|---|---|---|---|---|---|",
    );
    for (const pos of g.positions) {
      const item = plan.items.find((i) => i.appId === g.appId && i.position === pos);
      const r = item ? all.get(item.imageId) : undefined;
      const f = r?.final ?? null;
      lines.push(
        `| ${pos} | ${thumb(db, item?.imageId ?? null, `${g.name} ${pos}`)} | ${cell(f ? screenLabel(f, label) : "")} | ${cell(f?.headline ?? "")} | ${f ? (f.marketingLayer.present ? "yes" : "no") : ""} | ${r?.status ?? "not run"} | ${cell((r?.differences ?? []).join("; "))} |`,
      );
    }
    lines.push("");
  }
  const file = join(dir, "report.md");
  writeFileSync(file, `${lines.join("\n")}\n`);
  const data: Record<string, unknown> = {
    "patterns.json": o.patterns,
    "ours-vs.json": o.oursVs,
    "interpretation.json": s?.interpretation ?? null,
    "recommendations.json": s?.recommendations ?? null,
    "recommendations-draft.json": s?.draft ?? null,
    "review.json": s?.review ?? null,
  };
  for (const [name, value] of Object.entries(data))
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
