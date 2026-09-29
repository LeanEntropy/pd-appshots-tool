import { platformOf } from "../appstore/data.ts";
import { REGISTRY_KEY, RegistrySchema } from "../config/registry.ts";
import type { Storage } from "../storage/index.ts";
import { refsKey } from "./layout.ts";
import { readRefs } from "./refs.ts";

/**
 * Where every library picture is used, across all projects (plan-games-library 7.1): one pass
 * over each project's refs.json, kept in memory under the workspace's data stamp by the caller
 * (Computed). A picture's identity is its hash (platform-free); a source without a platform is
 * Google Play (the App Store plan adds the field later).
 */
export interface ImageUse {
  projectId: string;
  appId: string;
  gl: string;
  hl: string;
  position: number;
  platform: "play" | "apple";
}

export interface ProjectInfo {
  id: string;
  name: string;
  archived: boolean;
  /** When the user last opened it ("" when unknown). */
  lastOpenedAt: string;
  ourAppId: string;
}

/** The one parser of a refs source (shared with the App Store plan's platform field). */
export function useOf(projectId: string, s: unknown): ImageUse | null {
  const o = (s ?? {}) as Record<string, unknown>;
  if (typeof o.appId !== "string" || typeof o.gl !== "string" || typeof o.hl !== "string")
    return null;
  const position = typeof o.position === "number" && Number.isInteger(o.position) ? o.position : 0;
  return {
    projectId,
    appId: o.appId,
    gl: o.gl,
    hl: o.hl,
    position,
    platform: platformOf(o.platform) === "appstore" ? "apple" : "play",
  };
}

/** The projects of the workspace, from the registry as saved (never rebuilt or written here). */
export function projectInfos(storage: Storage): ProjectInfo[] {
  let entries: ProjectInfo[] = [];
  try {
    const r = RegistrySchema.safeParse(storage.getJson(REGISTRY_KEY));
    if (r.success)
      entries = r.data.projects.map((p) => ({
        id: p.id,
        name: p.name,
        archived: p.archived,
        lastOpenedAt: p.lastOpenedAt,
        ourAppId: p.ourAppId,
      }));
  } catch {}
  const known = new Set(entries.map((e) => e.id));
  // A project folder the registry does not list yet (tests, a fresh import) still counts.
  for (const id of storage.listProjectIds())
    if (!known.has(id))
      entries.push({ id, name: id, archived: false, lastOpenedAt: "", ourAppId: "" });
  return entries;
}

/** Active projects first (most recently opened first), archived ones last. */
export function byRecent(a: ProjectInfo, b: ProjectInfo): number {
  return (
    Number(a.archived) - Number(b.archived) ||
    b.lastOpenedAt.localeCompare(a.lastOpenedAt) ||
    a.id.localeCompare(b.id)
  );
}

export type ImageUses = Map<string, ImageUse[]>;

/** sha -> every place it appears, in every project that uses the shared library. */
export function buildImageUses(storage: Storage, projects: readonly ProjectInfo[]): ImageUses {
  const out: ImageUses = new Map();
  for (const p of projects) {
    const k = refsKey({ projectId: p.id });
    if (!storage.exists(k)) continue;
    let refs: ReturnType<typeof readRefs>;
    try {
      refs = readRefs(storage, k, p.id);
    } catch {
      continue;
    }
    for (const [sha, v] of Object.entries(refs.images)) {
      const list = out.get(sha) ?? [];
      for (const s of v.sources) {
        const u = useOf(p.id, s);
        if (u) list.push(u);
      }
      out.set(sha, list);
    }
  }
  for (const list of out.values())
    list.sort(
      (a, b) =>
        a.projectId.localeCompare(b.projectId) ||
        a.appId.localeCompare(b.appId) ||
        a.gl.localeCompare(b.gl) ||
        a.position - b.position,
    );
  return out;
}
