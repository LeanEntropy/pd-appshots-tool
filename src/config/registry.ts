import { z } from "zod";
import type { Storage } from "../storage/index.ts";
import { readSettings } from "./project.ts";

/** workspace/projects.json: an index of the projects, rebuildable from their project.json files. */
export const REGISTRY_KEY = "registry/projects.json";

const EntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  ourAppId: z.string(),
  iconFile: z.string().optional(),
  createdAt: z.string(),
  lastOpenedAt: z.string(),
  archived: z.boolean(),
  /** Cached for the home screen; recomputed from the disk whenever a project's state is read. */
  summary: z.object({ stage: z.string(), line: z.string(), updatedAt: z.string() }).optional(),
});
export type RegistryEntry = z.infer<typeof EntrySchema>;

export const RegistrySchema = z.object({ version: z.literal(1), projects: z.array(EntrySchema) });
export type Registry = z.infer<typeof RegistrySchema>;

/** A fresh index from every workspace/<id>/project.json (project.json is the source of truth). */
export function rebuildRegistry(storage: Storage, previous?: Registry): Registry {
  const old = new Map((previous?.projects ?? []).map((p) => [p.id, p]));
  const projects: RegistryEntry[] = [];
  for (const id of storage.listProjectIds()) {
    const s = readSettings(storage, { projectId: id });
    if (!s) continue;
    const was = old.get(id);
    projects.push({
      id,
      name: s.name,
      ourAppId: s.ourApp.id,
      ...(s.ourApp.iconFile ? { iconFile: s.ourApp.iconFile } : {}),
      createdAt: s.createdAt,
      lastOpenedAt: was?.lastOpenedAt ?? s.updatedAt,
      archived: s.archived ?? false,
      ...(was?.summary ? { summary: was.summary } : {}),
    });
  }
  return { version: 1, projects };
}

/**
 * The registry, rebuilt when it is missing or out of step with the project folders. A file that
 * cannot be read is kept aside as projects.json.bad-<date>, never silently discarded.
 */
export function readRegistry(storage: Storage): Registry {
  let raw: unknown;
  try {
    raw = storage.getJson(REGISTRY_KEY);
  } catch {
    raw = null;
  }
  const parsed = raw === undefined ? null : RegistrySchema.safeParse(raw);
  if (parsed && !parsed.success) {
    const bytes = storage.getBytes(REGISTRY_KEY);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    if (bytes) storage.putBlob(`${REGISTRY_KEY}.bad-${stamp}`, bytes);
  }
  const current = parsed?.success ? parsed.data : undefined;
  const ids = storage.listProjectIds();
  const inStep =
    current &&
    current.projects.length === ids.length &&
    current.projects.every((p) => ids.includes(p.id));
  if (current && inStep) return current;
  const rebuilt = rebuildRegistry(storage, current);
  if (rebuilt.projects.length || raw !== undefined) storage.putJson(REGISTRY_KEY, rebuilt);
  return rebuilt;
}

export function upsertEntry(storage: Storage, entry: RegistryEntry): Registry {
  const reg = readRegistry(storage);
  const others = reg.projects.filter((p) => p.id !== entry.id);
  const next: Registry = { version: 1, projects: [...others, entry] };
  storage.putJson(REGISTRY_KEY, next);
  return next;
}

export function markOpened(storage: Storage, id: string, now = new Date().toISOString()): void {
  const reg = readRegistry(storage);
  const p = reg.projects.find((x) => x.id === id);
  if (!p) return;
  p.lastOpenedAt = now;
  storage.putJson(REGISTRY_KEY, reg);
}

/** Project id from a game title ("Rogue Legend" -> "rogue-legend"), with -2, -3 on collision. */
export function slugFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50)
      .replace(/-+$/, "") || "project";
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Projects for the list: last opened first, archived ones last. */
export function listProjects(storage: Storage): RegistryEntry[] {
  return [...readRegistry(storage).projects].sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) || b.lastOpenedAt.localeCompare(a.lastOpenedAt),
  );
}

/** The most recently opened project that is not archived, or null when there is none. */
export function mostRecentProject(storage: Storage): string | null {
  return listProjects(storage).find((p) => !p.archived)?.id ?? null;
}
