import { PER_IMAGE_STEPS } from "../../analysis/pipeline.ts";
import { readSettings, settingsKey } from "../../config/project.ts";
import type { ProjectSettings } from "../../config/project-schema.ts";
import { upsertEntry } from "../../config/registry.ts";
import { moveKey } from "../../storage/import-ops.ts";
import { type ProjectContext, projectKey, type Storage } from "../../storage/index.ts";
import { stableStringify } from "../../util/hash.ts";
import { refsKey } from "../layout.ts";
import { type Journal, saveJournal, stagedRefsKey } from "./journal.ts";

export const sameSettings = (a: ProjectSettings, b: ProjectSettings) =>
  stableStringify({ ...a, createdAt: "", updatedAt: "" }) ===
  stableStringify({ ...b, createdAt: "", updatedAt: "" });

/** The old folders are kept (hardlinks, no extra space) until the user confirms deleting them. */
export function moveOldFolders(storage: Storage, ctx: ProjectContext): void {
  const keep = (...p: string[]) => projectKey(ctx, "_before-library", ...p);
  moveKey(storage, projectKey(ctx, "images"), keep("images"));
  moveKey(storage, projectKey(ctx, "analysis"), keep("analysis"));
  for (const step of PER_IMAGE_STEPS)
    moveKey(storage, projectKey(ctx, "objects", step), keep("objects", step));
}

export function finishSwitch(
  storage: Storage,
  ctx: ProjectContext,
  settings: ProjectSettings,
  j: Journal,
): void {
  j.phase = "switching";
  saveJournal(storage, ctx, j);
  const existing = readSettings(storage, ctx);
  if (!existing) storage.putJsonOnce(settingsKey(ctx), settings);
  if (!storage.exists(refsKey(ctx))) moveKey(storage, stagedRefsKey(ctx), refsKey(ctx));
  moveOldFolders(storage, ctx);
  const s = existing ?? settings;
  upsertEntry(storage, {
    id: ctx.projectId,
    name: s.name,
    ourAppId: s.ourApp.id,
    createdAt: s.createdAt,
    lastOpenedAt: new Date().toISOString(),
    archived: s.archived ?? false,
  });
  saveJournal(storage, ctx, { ...j, phase: "done", finishedAt: new Date().toISOString() });
}
