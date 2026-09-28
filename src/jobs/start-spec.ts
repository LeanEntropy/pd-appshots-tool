import type { Stage } from "../analysis/plan.ts";
import type { RunDeps, RunOutcome } from "../analysis/run.ts";
import type { Batch, Job } from "./journal.ts";

/** How a run ended: what the job keeps in the journal. */
export type RunEnd = Pick<
  RunOutcome,
  "runId" | "cancelled" | "aborted" | "stoppedForBudget" | "report" | "synthesisSkipped"
>;

/** One approved batch to start (a Pilot or Full check stage, or a report's AI batch). */
export interface StartSpec {
  stage?: Stage;
  reportId?: string;
  planHash: string;
  approvalId: string;
  /** The approved plan, frozen at start under state/approved/. */
  frozen: unknown;
  /** The batch this continues (found and checked by the caller), or null for a new one. */
  batch: Batch | null;
  /** The new batch's id suffix ("pilot", "core", the report id) and its spending limit. */
  newBatch: { suffix: string; stage: Batch["stage"]; limitUsd: number };
  /** Every id whose paid attempts count toward the batch (images and text-comparison ids). */
  attemptIds: string[];
  items: Job["items"];
  total: number;
  estimateUsd: [number, number];
  exec: (deps: RunDeps) => Promise<RunEnd>;
}
