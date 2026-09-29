import { z } from "zod";
import type { LoadedConfig } from "../config/load.ts";
import { backfillScope, backfillStatus, startBackfill, stopBackfill } from "../layout/backfill.ts";
import type { ApiResponse } from "./api.ts";

const StartBody = z.strictObject({ scopeHash: z.string().regex(/^[0-9a-f]{64}$/) });

/** The earlier images without a layout, their cost, and the running backfill (no AI). */
export function getLayoutBackfill(loaded: LoadedConfig): ApiResponse {
  return { status: 200, body: { scope: backfillScope(loaded), progress: backfillStatus(loaded) } };
}

/** Starts the approved backfill: only for the exact list the approval dialog showed. */
export function postLayoutBackfill(loaded: LoadedConfig, raw: unknown): ApiResponse {
  const parsed = StartBody.safeParse(raw);
  if (!parsed.success)
    return { status: 400, body: { problems: ["The approval could not be read."] } };
  const r = startBackfill(loaded, parsed.data.scopeHash);
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
