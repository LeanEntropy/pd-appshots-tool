import { resolve } from "node:path";
import { LocalFsStorage } from "./local-fs.ts";

export { LocalFsStorage } from "./local-fs.ts";
export * from "./types.ts";

const cache = new Map<string, LocalFsStorage>();

/** The storage of one workspace folder (one instance per folder per process). */
export function workspaceStorage(workspaceDir: string): LocalFsStorage {
  const root = resolve(workspaceDir);
  let s = cache.get(root);
  if (!s) {
    s = new LocalFsStorage(root);
    cache.set(root, s);
  }
  return s;
}
export { flagSvg, fontWoff2 } from "./tool-assets.ts";
