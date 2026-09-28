import { z } from "zod";
import { buildReportData } from "../analysis/report-data.ts";
import { listRuns, reportInputs, runFileKey } from "../analysis/report-inputs.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import { markdownToHtml } from "../view/md-html.ts";
import type { ApiResponse } from "./api.ts";

const StageParam = z.enum(["pilot", "core"]);

/** The report as it stands now, computed from the saved analyses (no AI), plus the saved runs. */
export function getReportCurrent(loaded: LoadedConfig, stage: string | null): ApiResponse {
  const parsed = StageParam.safeParse(stage);
  if (!parsed.success) return { status: 400, body: { problems: ["Unknown batch."] } };
  const data = buildReportData(reportInputs(loaded, parsed.data));
  return { status: 200, body: { data, runs: listRuns(loaded, parsed.data) } };
}

/**
 * One saved run: its report data when saved with it, else its markdown as HTML (older runs).
 * The id must be one of the listed runs, so no path is ever taken from the request.
 */
export function getReportRun(
  loaded: LoadedConfig,
  stage: string | null,
  id: string | null,
): ApiResponse {
  const parsed = StageParam.safeParse(stage);
  if (!parsed.success) return { status: 400, body: { problems: ["Unknown batch."] } };
  const run = listRuns(loaded, parsed.data).find((r) => r.runId === id);
  if (!run) return { status: 404, body: { problems: ["No such report run."] } };
  const storage = workspaceStorage(projectPaths(loaded).workspace);
  const mdKey = runFileKey(loaded, run.runId, "report.md");
  const file = storage.localPath(mdKey);
  const data = storage.getJson(runFileKey(loaded, run.runId, "report-data.json"));
  if (data) return { status: 200, body: { runId: run.runId, file, data } };
  const md = storage.getText(mdKey) ?? "";
  return { status: 200, body: { runId: run.runId, file, html: markdownToHtml(md) } };
}
