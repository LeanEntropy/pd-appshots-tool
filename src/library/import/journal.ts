import { z } from "zod";
import { removeCreated } from "../../storage/import-ops.ts";
import { type ProjectContext, projectKey, type Storage } from "../../storage/index.ts";

/**
 * The import's journal (workspace/<id>/state/import.json): every library entry it created and
 * every shared file it changed, written as it goes, so an interrupted or failed import can be
 * rolled back to exactly the state before it, and a finished one is never repeated.
 */
export const JournalSchema = z.object({
  version: z.literal(1),
  projectId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  phase: z.enum(["linking", "staged", "switching", "done", "rolled-back"]),
  created: z.array(z.string()),
  modified: z.array(z.object({ key: z.string(), before: z.unknown() })),
  notes: z.array(z.string()),
});
export type Journal = z.infer<typeof JournalSchema>;

export const journalKey = (ctx: ProjectContext) => projectKey(ctx, "state", "import.json");
export const stagedRefsKey = (ctx: ProjectContext) =>
  projectKey(ctx, "state", "import", "refs.json");

export function readJournal(storage: Storage, ctx: ProjectContext): Journal | null {
  const raw = storage.getJson(journalKey(ctx));
  if (raw === undefined) return null;
  const p = JournalSchema.safeParse(raw);
  if (!p.success) throw new Error("The import journal cannot be read; nothing was changed.");
  return p.data;
}

export function saveJournal(storage: Storage, ctx: ProjectContext, j: Journal): void {
  storage.putJson(journalKey(ctx), j);
}

/**
 * A new journal. Entries created by an earlier attempt that never finished are carried over, so
 * a rollback still removes them.
 */
export function startJournal(storage: Storage, ctx: ProjectContext, now: string): Journal {
  const prev = readJournal(storage, ctx);
  const carry = prev && (prev.phase === "linking" || prev.phase === "staged");
  return {
    version: 1,
    projectId: ctx.projectId,
    startedAt: now,
    phase: "linking",
    created: carry ? prev.created : [],
    modified: carry ? prev.modified : [],
    notes: [],
  };
}

/**
 * Removes only what this import created and restores what it changed, newest first. Entries
 * that cannot be removed now stay in the journal, so the next attempt removes them.
 */
export function rollback(storage: Storage, ctx: ProjectContext, j: Journal): string[] {
  const left: string[] = [];
  for (const m of [...j.modified].reverse()) storage.putJson(m.key, m.before);
  for (const k of [...j.created].reverse()) {
    try {
      removeCreated(storage, k);
    } catch {
      left.push(k);
    }
  }
  saveJournal(storage, ctx, {
    ...j,
    phase: left.length ? "linking" : "rolled-back",
    created: left.reverse(),
    modified: [],
    finishedAt: new Date().toISOString(),
  });
  return left;
}
