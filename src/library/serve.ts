import type { ProjectPaths } from "../config/load.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import { LIB } from "./layout.ts";
import { readRefs } from "./refs.ts";

const IMAGE = /^images\/(orig|thumb|model)\/([0-9a-f]{64})(-\d+)?\.(jpg|png|webp|gif|bin)$/;
const TTL_MS = 3000;
const cache = new Map<string, { at: number; ids: Set<string> }>();

/** Called whenever refs are written in this process, so a removed image is refused at once. */
export function forgetRefs(refsPath: string): void {
  cache.delete(refsPath);
}

function referenced(paths: ProjectPaths, refsKey: string): Set<string> {
  const id = workspaceStorage(paths.workspace).localPath(refsKey);
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ids;
  const refs = readRefs(workspaceStorage(paths.workspace), refsKey, paths.projectId);
  const ids = new Set(Object.keys(refs.images));
  cache.set(id, { at: Date.now(), ids });
  return ids;
}

/**
 * The library file behind a project's image URL (images/orig|thumb|model/<sha>...), as a storage
 * key, only if this project references that image: one project's page cannot reach another's.
 */
export function libraryImageKey(paths: ProjectPaths, rel: string): string | null {
  const lib = paths.library;
  const m = IMAGE.exec(rel);
  const sha = m?.[2] as string;
  // The project's App Store images are its images too (refs-appstore.json, plan-app-store 3).
  const apple = projectKey({ projectId: paths.projectId }, "refs-appstore.json");
  if (!lib || !m || !(referenced(paths, lib.refsKey).has(sha) || referenced(paths, apple).has(sha)))
    return null;
  const k = LIB.imageFile(rel.slice("images/".length));
  const storage = workspaceStorage(paths.workspace);
  if (storage.exists(k)) return k;
  // A picture shared as a small preview only (a Light copy): its preview is shown instead.
  const thumb = LIB.imageFile(`thumb/${m[2]}.webp`);
  return storage.exists(thumb) ? thumb : null;
}
