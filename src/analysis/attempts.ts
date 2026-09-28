import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { ProjectPaths } from "../config/load.ts";
import { libraryKey, projectKey, workspaceStorage } from "../storage/index.ts";
import { type Lease, type LockInfo, tryAcquire } from "../storage/leases.ts";

/**
 * Paid attempts per image (plan 12A, A3 and A4). Every paid model call for an image is logged
 * as "started" under the image's record lock BEFORE the call, and closed with its real cost
 * after it. A batch's spend is the sum of its attempts (one source, so a crash cannot leave a
 * ledger and a record disagreeing). An attempt still "started" after a crash counts at its
 * estimate. The log sits next to the record: in the library for shared analyses, else in the
 * project (projects not yet in the library).
 */
export const AttemptSchema = z.object({
  attemptId: z.string(),
  projectId: z.string(),
  runId: z.string(),
  batchId: z.string().nullable(),
  state: z.enum(["started", "finished", "failed"]),
  usd: z.number().nullable(),
  estimateUsd: z.number(),
  at: z.string(),
  endedAt: z.string().optional(),
});
export type Attempt = z.infer<typeof AttemptSchema>;

const LogSchema = z.object({ imageId: z.string(), attempts: z.array(AttemptSchema) });

/** Pseudo image id for the batch's pattern and recommendation calls (project-level). */
export const SYNTHESIS = "synthesis";

function logKey(paths: ProjectPaths, imageId: string, batchId: string | null): string {
  if (imageId === SYNTHESIS)
    return projectKey(paths, "state", "attempts", `synthesis-${batchId ?? "none"}.json`);
  const lib = paths.library;
  return lib
    ? libraryKey("attempts", imageId, `${lib.analysisKey}.json`)
    : projectKey(paths, "state", "attempts", `${imageId}.json`);
}

/** The record lock of one image under the project's analysis settings. */
export function recordLockKey(paths: ProjectPaths, imageId: string): string {
  const lib = paths.library;
  return lib
    ? libraryKey("locks", `analysis-${imageId}-${lib.analysisKey}.lock`)
    : projectKey(paths, "state", "locks", `analysis-${imageId}.lock`);
}

export function lockRecord(
  paths: ProjectPaths,
  imageId: string,
  kind: string,
): Lease | { heldBy: LockInfo | null } {
  const storage = workspaceStorage(paths.workspace);
  return tryAcquire(storage, recordLockKey(paths, imageId), { projectId: paths.projectId, kind });
}

export function readAttempts(
  paths: ProjectPaths,
  imageId: string,
  batchId: string | null = null,
): Attempt[] {
  const raw = workspaceStorage(paths.workspace).getJson(logKey(paths, imageId, batchId));
  const parsed = LogSchema.safeParse(raw);
  return parsed.success ? parsed.data.attempts : [];
}

function save(paths: ProjectPaths, imageId: string, batchId: string | null, list: Attempt[]) {
  workspaceStorage(paths.workspace).putJson(logKey(paths, imageId, batchId), {
    imageId,
    attempts: list,
  });
}

/** Logs a paid attempt as started. Call only while holding the image's record lock. */
export function startAttempt(
  paths: ProjectPaths,
  imageId: string,
  a: { runId: string; batchId: string | null; estimateUsd: number },
): string {
  const attemptId = randomBytes(8).toString("hex");
  const list = readAttempts(paths, imageId, a.batchId);
  list.push({
    attemptId,
    projectId: paths.projectId,
    runId: a.runId,
    batchId: a.batchId,
    state: "started",
    usd: null,
    estimateUsd: Math.round(a.estimateUsd * 100) / 100,
    at: new Date().toISOString(),
  });
  save(paths, imageId, a.batchId, list);
  return attemptId;
}

export function endAttempt(
  paths: ProjectPaths,
  imageId: string,
  attemptId: string,
  batchId: string | null,
  state: "finished" | "failed",
  usd: number,
): void {
  const list = readAttempts(paths, imageId, batchId);
  const a = list.find((x) => x.attemptId === attemptId);
  if (!a) return;
  a.state = state;
  a.usd = Math.round(usd * 10000) / 10000;
  a.endedAt = new Date().toISOString();
  save(paths, imageId, batchId, list);
}

export interface BatchSpend {
  usd: number;
  /** Attempts left "started" by a stop or crash: counted at their estimate. */
  interrupted: number;
}

/**
 * What this project paid in one batch: its attempts on the batch's images plus the batch's
 * pattern and recommendation calls. Only this project's attempts count (reuse is free).
 */
export function batchSpend(
  paths: ProjectPaths,
  batchId: string,
  imageIds: Iterable<string>,
): BatchSpend {
  let usd = 0;
  let interrupted = 0;
  for (const id of new Set([...imageIds, SYNTHESIS])) {
    for (const a of readAttempts(paths, id, batchId)) {
      if (a.batchId !== batchId || a.projectId !== paths.projectId) continue;
      if (a.state === "started") {
        interrupted++;
        usd += a.estimateUsd;
      } else usd += a.usd ?? 0;
    }
  }
  return { usd: Math.round(usd * 100) / 100, interrupted };
}
