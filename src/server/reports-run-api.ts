import { z } from "zod";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import type { RunnerOptions } from "../jobs/runner.ts";
import { enqueueReport, reportApproval } from "../reports/report-job.ts";
import { readDef } from "../reports/store.ts";
import { workspaceStorage } from "../storage/index.ts";
import type { ApiResponse } from "./api.ts";

/**
 * The paid run of a One country or Compare countries report (milestone R4): POST
 * reports/<id>/approval shows the numbers (no AI; the doubtful picture matches first), and POST
 * reports/<id>/run starts exactly the approved plan as a job.
 */
export function postReportApproval(loaded: LoadedConfig, id: string): ApiResponse | null {
  const paths = projectPaths(loaded);
  const def = readDef(workspaceStorage(paths.workspace), paths, id);
  if (!def) return null;
  const r = reportApproval(loaded, def);
  if ("problem" in r) return { status: 409, body: { problems: [r.problem] } };
  return { status: 200, body: { id: def.id, name: def.name, type: def.type, ...r } };
}

const RunBody = z.strictObject({ planHash: z.string().regex(/^[0-9a-f]{64}$/) });

export function postReportRun(
  loaded: LoadedConfig,
  id: string,
  raw: unknown,
  opts: RunnerOptions & { names?: (id: string) => string; onEnd?: () => void } = {},
): ApiResponse {
  const b = RunBody.safeParse(raw);
  if (!b.success) return { status: 400, body: { problems: ["The approval could not be read."] } };
  const r = enqueueReport(loaded, { reportId: id, planHash: b.data.planHash }, opts);
  if (!r.ok) return { status: r.status, body: { problems: [r.problem] } };
  const ended = () => {
    try {
      opts.onEnd?.();
    } catch {
      // The next page load refreshes it.
    }
  };
  r.done.then(ended, ended);
  return { status: 202, body: { started: true, jobId: r.jobId } };
}
