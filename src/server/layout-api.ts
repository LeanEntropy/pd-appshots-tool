import { z } from "zod";
import type { LoadedConfig } from "../config/load.ts";
import { backfillScope, backfillStatus, startBackfill, stopBackfill } from "../layout/backfill.ts";
import type { ApiResponse } from "./api.ts";

const StartBody = z.strictObject({
  scopeHash: z.string().regex(/^[0-9a-f]{64}$/),
  /** The separate approval to try again the images that failed before. */
  retryFailed: z.boolean().optional(),
});

/**
 * The earlier images without a layout, their cost, the images that failed before (with why, and
 * their own retry list), and the running backfill (no AI).
 */
export function getLayoutBackfill(loaded: LoadedConfig): ApiResponse {
  const scope = backfillScope(loaded);
  const retry = scope.failed.length ? backfillScope(loaded, { retryFailed: true }) : null;
  return { status: 200, body: { scope, retry, progress: backfillStatus(loaded) } };
}

/** Starts the approved backfill: only for the exact list the approval dialog showed. */
export function postLayoutBackfill(loaded: LoadedConfig, raw: unknown): ApiResponse {
  const parsed = StartBody.safeParse(raw);
  if (!parsed.success)
    return { status: 400, body: { problems: ["The approval could not be read."] } };
  const r = startBackfill(loaded, parsed.data.scopeHash, undefined, parsed.data.retryFailed);
  if (!r.ok) return { status: r.status, body: { problems: [r.problem] } };
  r.done.catch(() => {});
  return { status: 202, body: { started: true } };
}

export function postLayoutBackfillStop(loaded: LoadedConfig): ApiResponse {
  if (stopBackfill(loaded))
    return {
      status: 202,
      body: { stopping: true, message: "Stopping after the images in progress." },
    };
  return { status: 409, body: { problems: ["No layout step is running for this project."] } };
}
