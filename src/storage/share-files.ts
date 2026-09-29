import { randomBytes } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
  type WriteStream,
} from "node:fs";
import { link, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PROJECT_ID, type Storage } from "./types.ts";

/**
 * Local-disk capabilities used ONLY by project sharing (export and import of a package, plan
 * 12C, C8), kept out of the general Storage interface like localPath. Everything they touch is
 * under shared/share/ (packages being written or received, staged imports) or is one project's
 * folder being moved aside or committed. Feature code never calls these for anything else.
 */
export const SHARE_PREFIX = "shared/share";
const inShare = (k: string) => k.startsWith(`${SHARE_PREFIX}/`);

/** Size in bytes of a stored file, or undefined when it does not exist. */
export function fileSize(storage: Storage, k: string): number | undefined {
  try {
    const s = statSync(storage.localPath(k));
    return s.isFile() ? s.size : undefined;
  } catch {
    return undefined;
  }
}

/** Sizes of many stored files (read in parallel: much faster than one by one on Windows). */
export async function fileSizes(storage: Storage, keys: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < keys.length; i += 256)
    await Promise.all(
      keys.slice(i, i + 256).map(async (k) => {
        try {
          const s = await stat(storage.localPath(k));
          if (s.isFile()) out.set(k, s.size);
        } catch {}
      }),
    );
  return out;
}

/**
 * Writes a new file (temp file, then an exclusive link: a half-written file never has the final
 * name, and an existing file is never replaced). Asynchronous, so many can be written at once.
 */
export async function writeNew(storage: Storage, k: string, bytes: Buffer): Promise<void> {
  const p = storage.localPath(k);
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, bytes);
  try {
    await link(tmp, p);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Free space on the disk of the workspace, in bytes (Infinity when it cannot be read). */
export function freeDiskBytes(storage: Storage): number {
  try {
    // The workspace folder itself (the parent of _library).
    const s = statfsSync(dirname(dirname(storage.localPath("library/x"))));
    return s.bavail * s.bsize;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export interface ShareWrite {
  stream: WriteStream;
  /** Moves the finished file into place (a half-written file never has the final name). */
  commit: () => void;
  abort: () => void;
}

/** A streamed write of one file under shared/share/, committed by rename. */
export function openShareWrite(storage: Storage, k: string): ShareWrite {
  if (!inShare(k)) throw new Error(`Refusing to write "${k}"`);
  const p = storage.localPath(k);
  mkdirSync(dirname(p), { recursive: true });
  const partial = `${p}.partial`;
  const stream = createWriteStream(partial);
  return {
    stream,
    commit: () => renameSync(partial, p),
    abort: () => {
      stream.destroy();
      rmSync(partial, { force: true });
    },
  };
}

/** Removes one file or staging folder under shared/share/ (never anything else). */
export function removeShared(storage: Storage, k: string): void {
  if (!inShare(k)) throw new Error(`Refusing to delete "${k}"`);
  rmSync(storage.localPath(k), { recursive: true, force: true });
}

/** Files directly under a shared/share/ folder, with their size and time (for clean-up). */
export function listShared(storage: Storage, k: string): { name: string; mtimeMs: number }[] {
  if (!inShare(k)) throw new Error(`Refusing to list "${k}"`);
  const p = storage.localPath(k);
  if (!existsSync(p)) return [];
  return readdirSync(p, { withFileTypes: true }).map((e) => ({
    name: e.name,
    mtimeMs: statSync(`${p}/${e.name}`).mtimeMs,
  }));
}

/**
 * Moves a project's folder aside (the "Replace" choice of an import): it goes to
 * shared/share/replaced/<id>-<stamp>, nothing is deleted.
 */
export function moveProjectAside(storage: Storage, id: string, stamp: string): string {
  if (!PROJECT_ID.test(id)) throw new Error(`Invalid project id "${id}"`);
  const from = storage.localPath(`projects/${id}/project.json`).replace(/[\\/]project\.json$/, "");
  const toKey = `${SHARE_PREFIX}/replaced/${id}-${stamp}`;
  const to = storage.localPath(toKey);
  if (!existsSync(from)) return toKey;
  if (existsSync(to)) throw new Error(`Cannot move project ${id} aside: ${toKey} exists already.`);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  return toKey;
}

/** Makes a staged project folder (under shared/share/) the project <id>, in one rename. */
export function commitStagedProject(storage: Storage, stagedKey: string, id: string): void {
  if (!inShare(stagedKey)) throw new Error(`Refusing to move "${stagedKey}"`);
  if (!PROJECT_ID.test(id)) throw new Error(`Invalid project id "${id}"`);
  const to = storage.localPath(`projects/${id}/project.json`).replace(/[\\/]project\.json$/, "");
  if (existsSync(to)) throw new Error(`A project "${id}" exists already.`);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(storage.localPath(stagedKey), to);
}
