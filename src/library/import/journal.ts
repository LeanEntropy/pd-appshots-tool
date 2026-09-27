import { z } from "zod";
import { removeCreated } from "../../storage/import-ops.ts";
import { type ProjectContext, projectKey, type Storage } from "../../storage/index.ts";
import { GoogleIdSchema, RefsSchema } from "../refs.ts";

/**
 * The import's journal (workspace/<id>/state/import.json), written AHEAD of every change: the
 * library entries it is about to create and the Google-id files it is about to append to. An
 * interrupted or failed import is rolled back from it; a finished one is never repeated.
 */
export const JournalSchema = z.object({
  version: z.literal(2),
  projectId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  phase: z.enum(["linking", "staged", "switching", "done", "rolled-back"]),
  /** Entries this import creates (some may not exist yet if it stopped mid-way). */
  created: z.array(z.string()),
  /** Hashes this import appends to existing Google-id files. */
  appended: z.array(z.object({ key: z.string(), sha256: z.string() })),
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

/** A new journal; what an earlier unfinished attempt created is carried over for its rollback. */
export function startJournal(storage: Storage, ctx: ProjectContext, now: string): Journal {
  const prev = readJournal(storage, ctx);
  const carry = prev && (prev.phase === "linking" || prev.phase === "staged");
  return {
    version: 2,
    projectId: ctx.projectId,
    startedAt: now,
    phase: "linking",
    created: carry ? prev.created : [],
    appended: carry ? prev.appended : [],
    notes: [],
  };
}

/** Image hashes that other projects use: their library entries are never removed by a rollback. */
function usedByOthers(storage: Storage, ctx: ProjectContext): Set<string> {
  const out = new Set<string>();
  for (const id of storage.listProjectIds()) {
    if (id === ctx.projectId) continue;
    const refs = RefsSchema.safeParse(storage.getJson(projectKey({ projectId: id }, "refs.json")));
    if (refs.success) for (const sha of Object.keys(refs.data.images)) out.add(sha);
  }
  return out;
}

const SHA = /[0-9a-f]{64}/;

/**
 * Removes only what this import created and takes back only what it appended, newest first.
 * Anything another project uses meanwhile is kept. Entries that cannot be removed now stay in
 * the journal, so the next attempt removes them. Returns what is left.
 */
export function rollback(storage: Storage, ctx: ProjectContext, j: Journal): string[] {
  const others = usedByOthers(storage, ctx);
  const left: string[] = [];
  for (const a of [...j.appended].reverse()) {
    const f = GoogleIdSchema.safeParse(storage.getJson(a.key));
    if (f.success)
      storage.putJson(a.key, {
        ...f.data,
        entries: f.data.entries.filter((e) => e.sha256 !== a.sha256),
      });
  }
  for (const k of [...j.created].reverse()) {
    const sha = SHA.exec(k)?.[0];
    if (k.startsWith("library/") && sha && others.has(sha)) continue;
    if (k.startsWith("library/google/")) {
      const f = GoogleIdSchema.safeParse(storage.getJson(k));
      if (f.success && f.data.entries.some((e) => others.has(e.sha256))) continue;
    }
    if (k.startsWith("library/objects/")) {
      const o = storage.getJson(k) as { imageIds?: string[] } | undefined;
      if (o?.imageIds?.some((id) => others.has(id))) continue;
    }
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
    appended: [],
    finishedAt: new Date().toISOString(),
  });
  return left;
}
