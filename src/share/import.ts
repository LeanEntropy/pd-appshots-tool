import { randomBytes } from "node:crypto";
import { ProjectSettingsSchema } from "../config/project-schema.ts";
import { readRegistry } from "../config/registry.ts";
import { forgetRefs } from "../library/serve.ts";
import { key, type Storage } from "../storage/index.ts";
import { acquireAll, LOCKS } from "../storage/leases.ts";
import {
  commitStagedProject,
  moveProjectAside,
  removeShared,
  SHARE_PREFIX,
  writeNew,
} from "../storage/share-files.ts";
import { entryKey, type Manifest } from "./format.ts";
import { inspectPackage, uploadKey } from "./inspect.ts";
import { type MergeResult, mergeLibraryFile } from "./merge.ts";
import { PackageError, readEntry, type ZipIndex } from "./read-zip.ts";
import { checkFile } from "./validate.ts";

export type ImportMode = "new" | "copy" | "replace";

export interface ImportResult {
  projectId: string;
  name: string;
  kind: Manifest["kind"];
  library: Record<MergeResult, number>;
  projectFiles: number;
  /** Where the replaced project was kept (Replace only). */
  replacedTo: string | null;
  /** The sender's spending limits, which are not copied (the receiver's own apply). */
  droppedLimits: boolean;
}

type Progress = (step: string, done: number, total: number) => void;

/** Writes in flight; drain(n) waits until at most n are left, and rethrows a failed write. */
function writePool() {
  const set = new Set<Promise<void>>();
  let failed: unknown = null;
  return {
    get size() {
      return set.size;
    },
    add(p: Promise<unknown>) {
      const q: Promise<void> = p.then(
        () => void set.delete(q),
        (e) => {
          set.delete(q);
          failed ??= e;
        },
      );
      set.add(q);
    },
    async drain(n: number) {
      while (set.size > n) await Promise.race(set);
      if (failed) throw failed;
    },
  };
}

/** Project-level rewrites of a copy or rename: its id, and records it keeps as its own. */
function rewrite(name: string, bytes: Buffer, from: string, to: string, fresh: boolean): Buffer {
  if (name === "project/project.json") {
    const s = ProjectSettingsSchema.parse(JSON.parse(bytes.toString("utf8")));
    const { budget: _b, ...keep } = s.overrides ?? {};
    const options = keep.options as Record<string, unknown> | undefined;
    const { spending: _s, ...opts } = options ?? {};
    const overrides = { ...keep, ...(options ? { options: opts } : {}) };
    const next = {
      ...s,
      id: to,
      ...(to !== from ? { name: `${s.name} (copy)` } : {}),
      archived: false,
      updatedAt: new Date().toISOString(),
      overrides,
    };
    if (!Object.keys(overrides).length) delete (next as { overrides?: unknown }).overrides;
    return Buffer.from(`${JSON.stringify(ProjectSettingsSchema.parse(next), null, 2)}\n`);
  }
  if (name === "project/refs.json") {
    const r = JSON.parse(bytes.toString("utf8"));
    return Buffer.from(`${JSON.stringify({ ...r, projectId: to }, null, 2)}\n`);
  }
  // Analyses the sender's project wrote stay visible to the copy (its "own earlier" records).
  if (fresh && to !== from && name.startsWith("library/analysis/")) {
    const r = JSON.parse(bytes.toString("utf8"));
    if (r.writtenBy === from) r.writtenBy = to;
    if (r.key === `unproven-${from}`) r.key = `unproven-${to}`;
    return Buffer.from(`${JSON.stringify(r, null, 2)}\n`);
  }
  return bytes;
}

/** An analysis stored under "unproven-<sender id>" moves to the copy's own name. */
function renamed(name: string, from: string, to: string): string {
  return from === to ? name : name.replace(`/unproven-${from}.json`, `/unproven-${to}.json`);
}

/**
 * Imports a checked upload (plan 12C, C3 to C8, adapted): 1) every file is read, hashed and
 * checked, nothing written; 2) library files are merged (content-addressed, idempotent);
 * 3) the project is written to a staging folder and made the project in one rename. A failure
 * before step 3 leaves every project as it was; library files added meanwhile are unreferenced.
 */
export async function importPackage(
  storage: Storage,
  uploadId: string,
  mode: ImportMode,
  progress: Progress = () => {},
): Promise<ImportResult> {
  progress("Reading the file", 0, 0);
  const { ix, manifest, inspection } = await inspectPackage(storage, uploadId);
  const from = manifest.project.id;
  let result: ImportResult;
  try {
    if (inspection.collision && mode === "new")
      throw new PackageError(
        `You already have a project "${inspection.collision.name}". Import it as a copy, or replace yours.`,
      );
    const to = mode === "copy" ? (inspection.collision?.copyId ?? from) : from;
    await verifyAll(ix, manifest, progress);

    const held = acquireAll(storage, [LOCKS.library, LOCKS.ai, LOCKS.store], {
      projectId: to,
      kind: "share-import",
    });
    if ("heldBy" in held)
      throw new PackageError(
        "The tool is analysing or downloading right now. Import when that has finished.",
      );
    try {
      result = await write(storage, ix, manifest, { from, to, mode, uploadId }, progress);
    } finally {
      held.release();
    }
  } finally {
    ix.close();
  }
  // The upload is removed once it is imported (kept after a failure, to try again).
  removeShared(storage, uploadKey(uploadId));
  return result;
}

/** Step 1: every entry's bytes hash to the manifest and pass the checks of its kind. */
async function verifyAll(ix: ZipIndex, manifest: Manifest, progress: Progress) {
  const refsFile = ix.entries.get("project/refs.json");
  if (!refsFile) throw new PackageError("The file does not contain a complete project.");
  const refs = JSON.parse((await readEntry(ix, refsFile)).bytes.toString("utf8"));
  const shas = new Set(Object.keys(refs?.images ?? {}));
  let done = 0;
  for (const f of manifest.files) {
    const e = ix.entries.get(f.path);
    if (!e) throw new PackageError(`The file is missing "${f.path}".`);
    const r = await readEntry(ix, e);
    if (r.sha256 !== f.sha256)
      throw new PackageError(`"${f.path}" was changed or damaged after it was shared.`);
    const problem = checkFile(f.path, r.bytes, shas);
    if (problem) throw new PackageError(problem);
    if (++done % 50 === 0 || done === manifest.files.length)
      progress("Checking every file", done, manifest.files.length);
  }
}

async function write(
  storage: Storage,
  ix: ZipIndex,
  manifest: Manifest,
  o: { from: string; to: string; mode: ImportMode; uploadId: string },
  progress: Progress,
): Promise<ImportResult> {
  const library: Record<MergeResult, number> = { added: 0, same: 0, kept: 0, updated: 0 };
  const staged = key(SHARE_PREFIX, "staging", `${o.uploadId}-${randomBytes(4).toString("hex")}`);
  let projectFiles = 0;
  const pending = writePool();
  let droppedLimits = false;
  let done = 0;
  const total = manifest.files.length;
  try {
    for (const f of manifest.files) {
      const e = ix.entries.get(f.path);
      const target = entryKey(renamed(f.path, o.from, o.to), o.to, staged);
      if (!e || !target) throw new PackageError(`"${f.path}" cannot be imported.`);
      const r = await readEntry(ix, e);
      if (r.sha256 !== f.sha256)
        throw new PackageError(`"${f.path}" changed while it was being imported.`);
      if (f.path === "project/project.json") {
        const o = JSON.parse(r.bytes.toString("utf8")).overrides;
        droppedLimits = !!(o?.budget || o?.options?.spending);
      }
      const fresh = target.area === "project" || !storage.exists(target.key);
      const bytes = rewrite(f.path, r.bytes, o.from, o.to, fresh);
      if (target.area === "project") projectFiles++;
      // New files are written several at a time (much faster on Windows); merges one by one.
      if (fresh) {
        if (target.area === "library") library.added++;
        pending.add(writeNew(storage, target.key, bytes));
        if (pending.size >= 32) await pending.drain(8);
      } else library[mergeLibraryFile(storage, target.key, bytes)]++;
      if (++done % 50 === 0 || done === total)
        progress(
          target.area === "library" ? "Adding pictures and analyses" : "Adding project data",
          done,
          total,
        );
    }
    await pending.drain(0);
    progress("Opening the project", total, total);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let replacedTo: string | null = null;
    if (o.mode === "replace" && storage.listProjectIds().includes(o.to))
      replacedTo = moveProjectAside(storage, o.to, stamp);
    try {
      commitStagedProject(storage, staged, o.to);
    } catch (e) {
      if (replacedTo) commitStagedProject(storage, replacedTo, o.to);
      throw e;
    }
    forgetRefs(storage.localPath(key("projects", o.to, "refs.json")));
    storage.putJson(key("projects", o.to, "state", "shared-from.json"), {
      version: 1,
      packageId: manifest.packageId,
      kind: manifest.kind,
      sharedAt: manifest.createdAt,
      importedAt: new Date().toISOString(),
      fromProject: o.from,
    });
    readRegistry(storage);
    const settings = storage.getJson(key("projects", o.to, "project.json")) as { name: string };
    return {
      projectId: o.to,
      name: settings.name,
      kind: manifest.kind,
      library,
      projectFiles,
      replacedTo,
      droppedLimits,
    };
  } finally {
    await pending.drain(0).catch(() => {});
    removeShared(storage, staged);
  }
}
