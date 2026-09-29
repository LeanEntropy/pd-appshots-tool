import type { CallLog } from "../analysis/call.ts";
import type { ProjectPaths } from "../config/load.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import { LAYOUT_RUN_LOG } from "./cost.ts";
import type { LayoutFailure } from "./failure.ts";

/** One image's outcome in a layout run. */
export interface LayoutRunImage {
  imageId: string;
  game: string;
  outcome: "saved" | "had" | "skipped" | "failed";
  calls: number;
  usd: number;
}

/** runs/<run id>/layout.json: written after every image, so a crash keeps what happened. */
export interface LayoutRunLog {
  runId: string;
  kind: "layout-backfill";
  startedAt: string;
  endedAt: string | null;
  state: string;
  /** true: the run was the approved retry of images that had failed before. */
  retryFailed: boolean;
  total: number;
  estimateUsd: [number, number];
  limitUsd: number;
  spentUsd: number;
  /** Of which spent on images that failed. */
  failedUsd: number;
  images: LayoutRunImage[];
  failed: LayoutFailure[];
  calls: CallLog[];
}

export function writeLayoutRunLog(paths: ProjectPaths, log: LayoutRunLog): void {
  workspaceStorage(paths.workspace).putJson(
    projectKey(paths, "runs", log.runId, LAYOUT_RUN_LOG),
    log,
  );
}

/**
 * Images whose latest layout run failed, with why (oldest runs first, so a later outcome wins).
 * The caller drops those that have a layout by now.
 */
export function lastLayoutFailures(paths: ProjectPaths): Map<string, LayoutFailure> {
  const storage = workspaceStorage(paths.workspace);
  const out = new Map<string, LayoutFailure>();
  for (const run of storage.children(projectKey(paths, "runs")).sort()) {
    const log = storage.getJson(projectKey(paths, "runs", run, LAYOUT_RUN_LOG)) as
      | LayoutRunLog
      | undefined;
    // A log from elsewhere (an older or damaged file) is skipped, never trusted as is.
    if (log?.kind !== "layout-backfill" || !Array.isArray(log.images) || !Array.isArray(log.failed))
      continue;
    for (const im of log.images) if (im?.outcome !== "failed") out.delete(im?.imageId);
    for (const f of log.failed)
      if (typeof f?.imageId === "string" && typeof f.reason === "string") out.set(f.imageId, f);
  }
  return out;
}
