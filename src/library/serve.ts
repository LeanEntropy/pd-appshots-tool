import type { ProjectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import { LIB } from "./layout.ts";
import { readRefs } from "./refs.ts";

const IMAGE = /^images\/(orig|thumb|model)\/([0-9a-f]{64})(-\d+)?\.(jpg|png|webp|gif|bin)$/;
const TTL_MS = 3000;
const cache = new Map<string, { at: number; ids: Set<string> }>();

function referenced(paths: ProjectPaths, refsKey: string): Set<string> {
  const hit = cache.get(refsKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;
  const refs = readRefs(workspaceStorage(paths.workspace), refsKey, paths.projectId);
  const ids = new Set(Object.keys(refs.images));
  cache.set(refsKey, { at: Date.now(), ids });
  return ids;
}

/**
 * The library file behind a project's image URL (images/orig|thumb|model/<sha>...), served only
 * if this project references that image, so one project's page cannot reach another's images.
 */
export function libraryImagePath(paths: ProjectPaths, rel: string): string | null {
  const lib = paths.library;
  const m = IMAGE.exec(rel);
  if (!lib || !m || !referenced(paths, lib.refsKey).has(m[2] as string)) return null;
  const storage = workspaceStorage(paths.workspace);
  const k = LIB.imageFile(rel.slice("images/".length));
  return storage.exists(k) ? storage.localPath(k) : null;
}
