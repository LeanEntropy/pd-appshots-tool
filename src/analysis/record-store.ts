import type { ProjectPaths } from "../config/load.ts";
import { LIB } from "../library/layout.ts";
import { readRefs } from "../library/refs.ts";
import { dataStamp } from "../storage/changes.ts";
import { libraryKey, projectKey, workspaceStorage } from "../storage/index.ts";
import { acceptedKeys, isLean, unprovenKey } from "./pipeline.ts";
import { type AnalysisRecord, isUsable } from "./records.ts";
import { LEAN_SCHEMA_VERSION } from "./schema.ts";

/**
 * Where a project's analysis records live. Before the import: one file per image in the
 * project's analysis folder. Afterwards: the shared library, one file per image and analysis
 * key. A project sees, per image:
 *   1. the record made with its current settings (shared by every project with those settings);
 *   2. otherwise its own earlier record (unproven import, or its own run with older settings),
 *      exactly as it saw it before the library existed.
 * Other projects' records under other settings are never used.
 */
export function readStoredRecord(paths: ProjectPaths, imageId: string): AnalysisRecord | undefined {
  const lib = paths.library;
  if (!lib) {
    return workspaceStorage(paths.workspace).getJson(
      projectKey(paths, "analysis", `${imageId}.json`),
    ) as AnalysisRecord | undefined;
  }
  return libraryRecord(paths, imageId, acceptedOrder(lib));
}

/** Its own key first, then the keys it accepts as current (the lean pipeline reads the full
 * records of the same settings; never the other way round). */
function acceptedOrder(lib: NonNullable<ProjectPaths["library"]>): string[] {
  return [lib.analysisKey, ...acceptedKeys(lib.pipeline).filter((k) => k !== lib.analysisKey)];
}

function libraryRecord(
  paths: ProjectPaths,
  imageId: string,
  accepted: readonly string[],
): AnalysisRecord | undefined {
  const storage = workspaceStorage(paths.workspace);
  const lib = paths.library;
  if (!lib) return undefined;
  // One folder read per image: only the record files that exist are opened (probing every
  // accepted key of every image cost seconds on Windows).
  const files = storage.children(LIB.analysisDir(imageId)).filter((n) => n.endsWith(".json"));
  if (!files.length) return undefined;
  const present = new Set(files);
  for (const key of accepted) {
    if (!present.has(`${key}.json`)) continue;
    const current = storage.getJson(LIB.record(imageId, key)) as AnalysisRecord | undefined;
    if (current && (key === lib.analysisKey || isUsable(current))) return current;
  }
  let best: AnalysisRecord | undefined;
  const own = unprovenKey(paths.projectId);
  const lean = isLean(lib.pipeline);
  for (const name of files) {
    const r = storage.getJson(`${LIB.analysisDir(imageId)}/${name}`) as AnalysisRecord | undefined;
    if (!r || (r.key !== own && r.writtenBy !== paths.projectId)) continue;
    // A lean record never stands in for a pipeline that asks for the full answer.
    if (!lean && r.schema === LEAN_SCHEMA_VERSION) continue;
    if (!best || r.updatedAt > best.updatedAt) best = r;
  }
  return best;
}

const recordsMemo = new Map<string, { stamp: string; records: Map<string, AnalysisRecord> }>();

/**
 * Every record of the project. Read from disk once per data change (the stamp of the workspace)
 * and handed out as copies, so a caller that changes a record never changes the cached one.
 */
export function readStoredRecords(paths: ProjectPaths): Map<string, AnalysisRecord> {
  const stamp = dataStamp(paths.workspace);
  const key = JSON.stringify([paths.workspace, paths.projectId, paths.library]);
  let hit = recordsMemo.get(key);
  if (hit?.stamp !== stamp) {
    hit = { stamp, records: readFromDisk(paths) };
    recordsMemo.set(key, hit);
  }
  return new Map([...hit.records].map(([id, r]) => [id, structuredClone(r)]));
}

function readFromDisk(paths: ProjectPaths): Map<string, AnalysisRecord> {
  const storage = workspaceStorage(paths.workspace);
  const out = new Map<string, AnalysisRecord>();
  const lib = paths.library;
  if (!lib) {
    for (const k of storage.list(projectKey(paths, "analysis"))) {
      if (!k.endsWith(".json") || k.split("/").length !== 4) continue;
      const r = storage.getJson(k) as AnalysisRecord;
      out.set(r.imageId, r);
    }
    return out;
  }
  // Images with no record folder at all are skipped with one read of the analysis folder.
  const analysed = new Set(storage.children(libraryKey("analysis")));
  const accepted = acceptedOrder(lib);
  for (const id of Object.keys(readRefs(storage, lib.refsKey, paths.projectId).images)) {
    if (!analysed.has(id)) continue;
    const r = libraryRecord(paths, id, accepted);
    if (r) out.set(id, r);
  }
  return out;
}

/**
 * Saves a record where it was read from (its key), or under the current analysis key when it is
 * new. The first usable result records which project and run paid for it; that is never changed.
 */
export function writeStoredRecord(paths: ProjectPaths, r: AnalysisRecord): void {
  const storage = workspaceStorage(paths.workspace);
  const lib = paths.library;
  if (!lib) {
    storage.putJson(projectKey(paths, "analysis", `${r.imageId}.json`), r);
    return;
  }
  const key = r.key ?? lib.analysisKey;
  const usable = r.status !== "failed" && !!r.final;
  const out: AnalysisRecord = {
    ...r,
    key,
    provenance: r.provenance ?? (key === lib.analysisKey ? "proven" : "unproven"),
    ...(key === lib.analysisKey && !r.pipeline ? { pipeline: lib.pipeline } : {}),
    writtenBy: paths.projectId,
    paidBy:
      r.paidBy ??
      (usable ? { projectId: paths.projectId, runId: r.runId, usd: null, at: r.updatedAt } : null),
  };
  storage.putJson(LIB.record(r.imageId, key), out);
}
