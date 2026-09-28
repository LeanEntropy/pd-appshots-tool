import { type ProjectContext, projectKey, type Storage } from "../storage/index.ts";
import {
  isPreset,
  type ReportDef,
  ReportDefSchema,
  type ReportScope,
  type ReportType,
  type VersionEntry,
  type VersionInputs,
  VersionInputsSchema,
} from "./types.ts";

/**
 * Report defs and versions through storage (plan-reports 4). A version folder is immutable:
 * rename and archive change only the def. The only delete is a report's own files.
 */
export const defKey = (c: ProjectContext, id: string) =>
  projectKey(c, "reports", "defs", `${id}.json`);
export const versionFileKey = (c: ProjectContext, versionId: string, name: string) =>
  projectKey(c, "reports", versionId, name);

const RUN_FOLDER = /^\d{4}-\d{2}-\d{2}T[0-9-]+Z-[a-z0-9-]+$/;

export function readDef(s: Storage, c: ProjectContext, id: string): ReportDef | null {
  let raw: unknown;
  try {
    raw = s.getJson(defKey(c, id));
  } catch {
    return null;
  }
  const p = ReportDefSchema.safeParse(raw);
  return p.success && p.data.id === id ? p.data : null;
}

/** Every readable def of the project (a broken def file is skipped, never a crash). */
export function listDefs(s: Storage, c: ProjectContext): ReportDef[] {
  const prefix = projectKey(c, "reports", "defs");
  const ids = [...s.list(prefix)]
    .map((k) => k.slice(prefix.length + 1))
    .filter((f) => /^r-[a-z0-9-]+\.json$/.test(f))
    .map((f) => f.slice(0, -5));
  return ids.flatMap((id) => readDef(s, c, id) ?? []);
}

export function saveDef(s: Storage, c: ProjectContext, def: ReportDef): void {
  s.putJson(defKey(c, def.id), ReportDefSchema.parse(def));
}

/** Top-level run folders under reports/, each with the names of its files. */
export function runFolders(s: Storage, c: ProjectContext): Map<string, Set<string>> {
  const prefix = projectKey(c, "reports");
  const out = new Map<string, Set<string>>();
  for (const k of s.list(prefix)) {
    const [dir = "", ...rest] = k.slice(prefix.length + 1).split("/");
    if (!rest.length || !RUN_FOLDER.test(dir)) continue;
    const files = out.get(dir) ?? new Set<string>();
    files.add(rest.join("/"));
    out.set(dir, files);
  }
  return out;
}

/** A version's version.json, or null (older runs have none; a broken one counts as none). */
export function readVersionInputs(
  s: Storage,
  c: ProjectContext,
  versionId: string,
): VersionInputs | null {
  try {
    const p = VersionInputsSchema.safeParse(
      s.getJson(versionFileKey(c, versionId, "version.json")),
    );
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** Write-once: false when the version already has its version.json. */
export function writeVersionInputs(
  s: Storage,
  c: ProjectContext,
  versionId: string,
  v: VersionInputs,
): boolean {
  return s.putJsonOnce(versionFileKey(c, versionId, "version.json"), VersionInputsSchema.parse(v));
}

/** Names are unique per project: a number is added on collision ("Name (2)"). */
export function uniqueName(defs: readonly ReportDef[], name: string, exceptId = ""): string {
  const taken = new Set(defs.filter((d) => d.id !== exceptId).map((d) => d.name.toLowerCase()));
  const base = name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} (${n})`.toLowerCase())) return `${base} (${n})`;
}

/** A short slug from the name plus a counter (r-japan-korea-taiwan-1). */
export function newReportId(defs: readonly ReportDef[], name: string): string {
  const slug =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "report";
  const ids = new Set(defs.map((d) => d.id));
  for (let n = 1; ; n++) if (!ids.has(`r-${slug}-${n}`)) return `r-${slug}-${n}`;
}

/** A new report (One country or Compare countries; the builder of a later milestone uses it). */
export function createReport(
  s: Storage,
  c: ProjectContext,
  o: { name: string; type: ReportType; scope: ReportScope; now?: Date },
): ReportDef {
  const defs = listDefs(s, c);
  const name = uniqueName(defs, o.name);
  const def: ReportDef = {
    id: newReportId(defs, name),
    name,
    type: o.type,
    scope: o.scope,
    createdAt: (o.now ?? new Date()).toISOString(),
    archived: false,
    versions: [],
  };
  if (!s.putJsonOnce(defKey(c, def.id), ReportDefSchema.parse(def)))
    throw new Error("A report with this id exists already.");
  return def;
}

/**
 * Registers a saved version. Re-doing a Pilot or Full check archives every earlier version
 * (decision D3): they stay readable and exportable, and are never deleted.
 */
export function addVersion(
  s: Storage,
  c: ProjectContext,
  id: string,
  entry: Omit<VersionEntry, "archived">,
): ReportDef {
  const def = readDef(s, c, id);
  if (!def) throw new Error(`No report "${id}".`);
  if (def.versions.some((v) => v.id === entry.id)) return def;
  const versions = [...def.versions, { ...entry, archived: false }].sort((a, b) =>
    a.generatedAt.localeCompare(b.generatedAt),
  );
  const newest = versions.at(-1)?.id;
  const next = {
    ...def,
    versions: isPreset(def.type)
      ? versions.map((v) => ({ ...v, archived: v.id !== newest }))
      : versions,
  };
  saveDef(s, c, next);
  return next;
}

export type Change = { ok: true; def: ReportDef } | { ok: false; status: number; problem: string };

export function renameReport(s: Storage, c: ProjectContext, id: string, name: string): Change {
  const def = readDef(s, c, id);
  if (!def) return { ok: false, status: 404, problem: "This report no longer exists." };
  if (!name.trim()) return { ok: false, status: 400, problem: "The name cannot be empty." };
  const next = { ...def, name: uniqueName(listDefs(s, c), name, id) };
  saveDef(s, c, next);
  return { ok: true, def: next };
}

export function setArchived(s: Storage, c: ProjectContext, id: string, archived: boolean): Change {
  const def = readDef(s, c, id);
  if (!def) return { ok: false, status: 404, problem: "This report no longer exists." };
  const next = { ...def, archived };
  saveDef(s, c, next);
  return { ok: true, def: next };
}

/**
 * Deletes one report's own files: its version folders, then its def. Pilot and Full check are
 * never deleted (they carry the analysis freshness pointers). Library analyses are never touched.
 */
export function deleteReport(s: Storage, c: ProjectContext, id: string): Change {
  const def = readDef(s, c, id);
  if (!def) return { ok: false, status: 404, problem: "This report no longer exists." };
  if (isPreset(def.type))
    return {
      ok: false,
      status: 409,
      problem: "The Pilot and the Full check cannot be deleted. You can archive them instead.",
    };
  for (const v of def.versions) {
    if (!v.id.endsWith(`-${def.id}`)) continue;
    s.deleteReportFiles(projectKey(c, "reports", v.id));
  }
  s.deleteReportFiles(defKey(c, def.id));
  return { ok: true, def };
}
