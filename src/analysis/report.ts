import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { ImageDb } from "../store/imagedb.ts";
import { ensureDir } from "../util/fsx.ts";
import type { AnalysisPlan } from "./plan.ts";
import { type AnalysisRecord, readRecords } from "./records.ts";

const usd = (n: number) => `$${n.toFixed(2)}`;
const STAGE = { pilot: "Core pilot", core: "Core check" };

/** The approval screen, in plain language. */
export function describeAnalysisPlan(p: AnalysisPlan): string {
  const lines = [
    `${STAGE[p.stage]}: approval needed before any AI call`,
    "",
    `Market: ${p.market.label}. Games and screenshot positions included:`,
    ...p.games.map(
      (g) => `  ${g.name}: positions ${g.positions.join(", ") || "none"} (${g.positions.length})`,
    ),
  ];
  if (p.excluded.length) {
    lines.push(`Left out (kept and shown raw, not analysed): ${p.excluded.length}`);
    const byGame = new Map<string, number[]>();
    for (const e of p.excluded)
      byGame.set(`${e.name}: ${e.reason}`, [
        ...(byGame.get(`${e.name}: ${e.reason}`) ?? []),
        e.position,
      ]);
    for (const [k, v] of byGame) lines.push(`  ${k}, positions ${v.join(", ")}`);
  }
  lines.push(
    "",
    "Images by cost level:",
    `  Identical to an image already analysed (no AI): ${p.counts.identical}`,
    `  Same picture as an analysed English image, new text (marketing-layer diff): ${p.counts.layerDiff}`,
    `  Full analysis: ${p.counts.full}`,
    `  New images counted against the core cap: ${p.counts.newImages}. Core total after this batch: ${p.coreTotal} of ${p.cap}${p.withinCap ? "" : " (over the cap: this batch will not run)"}.`,
    "",
    "Model passes:",
    ...p.estimate.passes.map(
      (m) => `  ${m.role} (${m.model}): ${m.calls} calls, ${m.images} images; ${m.note}`,
    ),
    "",
    `Estimated cost: ${usd(p.estimate.usd[0])} to ${usd(p.estimate.usd[1])} on Claude, plus about ${Math.round(p.estimate.gptTokens / 1000)}k GPT tokens for the second opinion. Provisional: the pilot measures the real costs.`,
    `Settling disagreements is estimated at ${p.estimate.expectedDisputes} images; the real number depends on the second opinion.`,
  );
  return lines.join("\n");
}

/** Markdown report of an analysis run, with local image paths. */
export function writeRunReport(
  loaded: LoadedConfig,
  plan: AnalysisPlan,
  runId: string,
  records: AnalysisRecord[],
  spentUsd: number,
): string {
  const paths = projectPaths(loaded);
  const dir = join(paths.reports, runId);
  ensureDir(dir);
  const db = ImageDb.open(paths.imageDb, paths.imagesOrig, paths.imagesThumb);
  const img = "../../images/";
  // Reused (identical) images show the analysis they share with an earlier result.
  const all = readRecords(paths);
  const count = (s: string) => records.filter((r) => r.status === s).length;
  const reviewed = records.filter((r) => r.reviewer).length;
  const agreed = records.filter((r) => r.reviewer && r.status === "ok").length;
  const lines = [
    `# ${STAGE[plan.stage]} result`,
    "",
    `Run ${runId}. Market: ${plan.market.label}. Spent: ${usd(spentUsd)} on Claude (estimate was ${usd(plan.estimate.usd[0])} to ${usd(plan.estimate.usd[1])}).`,
    "",
    `- Analysed: ${records.length}. Accepted as read: ${count("ok")}. Settled after a disagreement: ${count("adjudicated")}. Still disputed: ${count("disputed")}. Second opinion missing: ${count("unreviewed")}. Failed: ${count("failed")}.`,
    `- Second opinion agreed on ${agreed} of ${reviewed} cross-checked screenshots.`,
    "",
  ];
  for (const g of plan.games) {
    lines.push(
      `## ${g.name}`,
      "",
      "| Position | Screenshot | Screen type | Headline | Status | Differences |",
      "|---|---|---|---|---|---|",
    );
    for (const pos of g.positions) {
      const item = plan.items.find((i) => i.appId === g.appId && i.position === pos);
      const r = item ? all.get(item.imageId) : undefined;
      const rec = item ? db.get(item.imageId) : undefined;
      const pic = rec ? `[![${pos}](${img}${rec.thumb})](${img}${rec.file})` : "";
      const type = r?.final
        ? `${r.final.screenType}${r.final.subtype ? ` / ${r.final.subtype}` : ""}`
        : "";
      const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(
        `| ${pos} | ${pic} | ${cell(type)} | ${cell(r?.final?.headline ?? "")} | ${r?.status ?? (item?.tier === "identical" ? "reused" : "not run")} | ${cell((r?.differences ?? []).join("; "))} |`,
      );
    }
    lines.push("");
  }
  const file = join(dir, `${plan.stage}.md`);
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}
