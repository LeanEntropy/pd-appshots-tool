import { copyFileSync, existsSync, linkSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Storage } from "./types.ts";

/**
 * File operations used ONLY by the import into the shared library (plan 12B, B2): hardlink
 * (copy when the file system cannot link), move, and removal of entries the import created.
 * Feature code never calls these.
 */
export function linkOrCopy(
  storage: Storage,
  fromKey: string,
  toKey: string,
): "linked" | "copied" | "exists" {
  const to = storage.localPath(toKey);
  if (existsSync(to)) return "exists";
  const from = storage.localPath(fromKey);
  mkdirSync(dirname(to), { recursive: true });
  try {
    linkSync(from, to);
    return "linked";
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return "exists";
    const tmp = `${to}.${process.pid}.tmp`;
    copyFileSync(from, tmp);
    renameSync(tmp, to);
    return "copied";
  }
}

/** Moves a file or folder; refuses to replace anything at the destination. */
export function moveKey(storage: Storage, fromKey: string, toKey: string): boolean {
  const from = storage.localPath(fromKey);
  const to = storage.localPath(toKey);
  if (!existsSync(from)) return false;
  if (existsSync(to)) throw new Error(`Cannot move ${fromKey}: ${toKey} exists already.`);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  return true;
}

/** Removes one entry the import created (rollback). */
export function removeCreated(storage: Storage, k: string): void {
  rmSync(storage.localPath(k), { force: true });
}
