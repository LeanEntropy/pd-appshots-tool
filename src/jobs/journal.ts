import { z } from "zod";
import { type ProjectContext, projectKey, type Storage } from "../storage/index.ts";

/**
 * state/job.json: the one job-status file of a project (plan 5.3 and 12B, B3). It holds the job
 * of each lane (running, or how the last one ended), the approved analysis batches (limit and
 * runs; their spend is summed from the attempt logs), and the saved expansion choices.
 */
const ProgressSchema = z.object({
  phase: z.string(),
  done: z.number(),
  total: z.number(),
  message: z.string(),
  spentUsd: z.number(),
});

const ErrorSchema = z.object({
  message: z.string(),
  name: z.string().nullable(),
  position: z.number().nullable(),
  at: z.string(),
});

export const JobSchema = z.object({
  id: z.string(),
  kind: z.enum(["store-check", "download", "analysis"]),
  /** Idempotency key: the approved plan's fingerprint. */
  planHash: z.string(),
  /** The approval screen the user accepted (fingerprint and when it was shown): used once. */
  approvalId: z.string().default(""),
  stage: z.enum(["pilot", "core"]).optional(),
  /** A One country or Compare countries report's AI batch (plan-reports 2.3). */
  reportId: z.string().optional(),
  /** The game a store job is for (checking or downloading an added competitor). */
  appId: z.string().optional(),
  batchId: z.string().nullable().default(null),
  /** Storage key of the frozen input (the immutable copy of the approved plan). */
  frozenInput: z.string().nullable().default(null),
  lockNonce: z.string(),
  startedAt: z.string(),
  heartbeatAt: z.string(),
  finishedAt: z.string().nullable().default(null),
  progress: ProgressSchema,
  state: z.enum(["running", "finished", "stopped", "failed"]),
  errors: z.array(ErrorSchema).default([]),
  error: z.string().nullable().default(null),
  report: z.string().nullable().default(null),
  synthesisSkipped: z.string().nullable().default(null),
  /** The images the run sends to AI, and its estimate (for the page's run list). */
  items: z
    .array(z.object({ name: z.string(), position: z.number(), imageId: z.string() }))
    .default([]),
  estimateUsd: z.tuple([z.number(), z.number()]).nullable().default(null),
  /** True when the user pressed Stop. */
  cancelled: z.boolean().default(false),
});
export type Job = z.infer<typeof JobSchema>;

export const BatchSchema = z.object({
  id: z.string(),
  /** "report": the AI batch of a report of the builder (reportId). */
  stage: z.enum(["pilot", "core", "report"]),
  reportId: z.string().optional(),
  firstApprovedPlanHash: z.string(),
  limitUsd: z.number(),
  runs: z.array(z.string()).default([]),
  /** Every image any run of this batch sent to AI (the attempts summed for its spend). */
  imageIds: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type Batch = z.infer<typeof BatchSchema>;

export const IncrementSchema = z.object({
  id: z.string(),
  kind: z.enum(["competitors", "countries", "charts"]),
  choice: z.array(z.string()),
  approvedPlanHash: z.string().optional(),
  state: z.enum(["chosen", "previewed", "running", "stopped", "done"]),
  savedAt: z.string(),
});
export type Increment = z.infer<typeof IncrementSchema>;

export const JournalSchema = z.object({
  version: z.literal(1),
  jobs: z.object({ store: JobSchema.optional(), ai: JobSchema.optional() }),
  batches: z.array(BatchSchema).default([]),
  increments: z.array(IncrementSchema).default([]),
});
export type Journal = z.infer<typeof JournalSchema>;

export const journalKey = (ctx: ProjectContext) => projectKey(ctx, "state", "job.json");

const empty = (): Journal => ({ version: 1, jobs: {}, batches: [], increments: [] });

/**
 * The project's journal. A file that cannot be read is kept aside (never silently lost) and an
 * empty journal is used; the job it described then shows as not started.
 */
export function readJournal(storage: Storage, ctx: ProjectContext): Journal {
  let raw: unknown;
  try {
    raw = storage.getJson(journalKey(ctx));
  } catch {
    raw = null;
  }
  if (raw === undefined) return empty();
  const parsed = JournalSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const bytes = storage.getBytes(journalKey(ctx));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (bytes) storage.putBlob(projectKey(ctx, "state", `job.json.bad-${stamp}`), bytes);
  return empty();
}

export function writeJournal(storage: Storage, ctx: ProjectContext, j: Journal): void {
  storage.putJson(journalKey(ctx), JournalSchema.parse(j));
}

/** Read-modify-write of the journal (the server is its only writer, one change at a time). */
export function updateJournal(
  storage: Storage,
  ctx: ProjectContext,
  change: (j: Journal) => void,
): Journal {
  const j = readJournal(storage, ctx);
  change(j);
  writeJournal(storage, ctx, j);
  return j;
}

/**
 * The status the tool kept before the journal existed (pending/analysis-status.json), read once
 * as a fallback when a project has no journal job yet. It is never written again.
 */
export function legacyAnalysisJob(storage: Storage, ctx: ProjectContext): Job | null {
  const s = storage.getJson(projectKey(ctx, "pending", "analysis-status.json")) as
    | {
        running?: boolean;
        stage?: "pilot" | "core" | null;
        progress?: Job["progress"] | null;
        startedAt?: string | null;
        finishedAt?: string | null;
        spentUsd?: number;
        errors?: Job["errors"];
        report?: string | null;
        error?: string | null;
        synthesisSkipped?: string | null;
      }
    | undefined;
  if (!s?.startedAt || !s.stage) return null;
  const parsed = JobSchema.safeParse({
    id: `legacy-${s.startedAt}`,
    kind: "analysis",
    planHash: "",
    stage: s.stage,
    lockNonce: "",
    startedAt: s.startedAt,
    heartbeatAt: s.finishedAt ?? s.startedAt,
    finishedAt: s.finishedAt ?? null,
    progress: s.progress ?? { phase: "done", done: 0, total: 0, message: "", spentUsd: 0 },
    // A run the old tool left "running" had no lock: it stopped when its server stopped.
    state: s.running || !s.finishedAt ? "stopped" : s.error ? "stopped" : "finished",
    errors: s.errors ?? [],
    error: s.error ?? null,
    report: s.report ?? null,
    synthesisSkipped: s.synthesisSkipped ?? null,
  });
  return parsed.success ? parsed.data : null;
}
