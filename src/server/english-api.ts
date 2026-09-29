import { z } from "zod";
import { englishScope, englishStatus, startEnglish, stopEnglish } from "../analysis/english-run.ts";
import type { LoadedConfig } from "../config/load.ts";
import type { ApiResponse } from "./api.ts";

const StartBody = z.strictObject({ scopeHash: z.string().regex(/^[0-9a-f]{64}$/) });

/** The texts without English, their cost, and the running step (no AI). */
export function getEnglish(loaded: LoadedConfig): ApiResponse {
  const s = englishScope(loaded);
  return {
    status: 200,
    body: {
      scope: {
        ...s,
        items: s.items.slice(0, 500),
        more: Math.max(0, s.items.length - 500),
        texts: s.items.length,
      },
      progress: englishStatus(loaded),
    },
  };
}

/** Starts the approved English step: only for the exact list the approval dialog showed. */
export function postEnglish(loaded: LoadedConfig, raw: unknown): ApiResponse {
  const parsed = StartBody.safeParse(raw);
  if (!parsed.success)
    return { status: 400, body: { problems: ["The approval could not be read."] } };
  const r = startEnglish(loaded, parsed.data.scopeHash);
  if (!r.ok) return { status: r.status, body: { problems: [r.problem] } };
  r.done.catch(() => {});
  return { status: 202, body: { started: true } };
}

export function postEnglishStop(loaded: LoadedConfig): ApiResponse {
  if (stopEnglish(loaded))
    return {
      status: 202,
      body: { stopping: true, message: "Stopping after the texts in progress." },
    };
  return { status: 409, body: { problems: ["No English step is running for this project."] } };
}
