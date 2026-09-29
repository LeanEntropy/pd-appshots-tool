import type { StoredObject } from "../analysis/call.ts";
import { type AnalysisRecord, isUsable } from "../analysis/records.ts";
import type { ProjectPaths } from "../config/load.ts";
import { answerKey, LIB, pixelsKey } from "../library/layout.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";
import { layoutProblems, readLayout } from "./checks.ts";
import { type Layout, splitLayouts } from "./schema.ts";
import { LAYOUT_CONTRACT, LAYOUT_SCHEMA_VERSION } from "./vocab.ts";

/**
 * An image's layout breakdown, saved apart from its analysis record (plan-layout-wireframes
 * 2.5): write-once, keyed to the record it belongs to and the layout version. The record is
 * never rewritten for a layout, and a new layout version is simply a new file.
 */
export interface LayoutFile {
  version: typeof LAYOUT_SCHEMA_VERSION;
  contract: typeof LAYOUT_CONTRACT;
  imageId: string;
  /** Analysis key of the record the layout belongs to. */
  recordKey: string;
  /** "same-call": asked with the full analysis; "backfill": a later layout-only call. */
  source: "same-call" | "backfill";
  model: string;
  /** Cached model answer it was read from. */
  object: string;
  createdAt: string;
  layout: Layout;
}

export type LayoutStatus = "current" | "missing" | "outdated";

/** The analysis key a record is (or will be) stored under. */
export const recordKeyOf = (paths: ProjectPaths, r: AnalysisRecord): string =>
  r.key ?? paths.library?.analysisKey ?? "project";

export function layoutKey(imageId: string, recordKey: string): string {
  const v = { image: imageId, record: recordKey, contract: LAYOUT_CONTRACT };
  return stableHash({ ...v, schema: LAYOUT_SCHEMA_VERSION }).slice(0, 32);
}

const dirOf = (paths: ProjectPaths, imageId: string) =>
  paths.library ? LIB.layoutDir(imageId) : projectKey(paths, "layout", imageId);

function fileKey(paths: ProjectPaths, imageId: string, key: string): string {
  return paths.library
    ? LIB.layout(imageId, key)
    : projectKey(paths, "layout", imageId, `${key}.json`);
}

/** Storage key of the pixel measurements of one layout (write-once, next to the pixel facts). */
export function measureKey(paths: ProjectPaths, imageId: string, key: string, version: string) {
  return pixelsKey(paths, imageId, `${version}.${key}`);
}

/** The layout in the record's producer answer, checked against the record's final reading. */
export function layoutFromAnswer(
  paths: ProjectPaths,
  r: AnalysisRecord,
): { layout: Layout | null; problems: string[]; object: StoredObject | null } {
  const storage = workspaceStorage(paths.workspace);
  const key = r.producer?.object;
  const obj = key
    ? (storage.getJson(answerKey(paths, "full-analysis", key)) as StoredObject | undefined)
    : undefined;
  if (!obj || !r.final) return { layout: null, problems: ["no saved answer"], object: null };
  const ref = `img${obj.imageIds.indexOf(r.imageId) + 1}`;
  const raw = splitLayouts(obj.output).layouts.get(ref);
  if (raw === undefined)
    return { layout: null, problems: ["analysed before layout capture"], object: obj };
  // After a settled dispute the final reading may differ: the layout must fit it.
  const got = readLayout(raw, { ...r.final, imageRef: ref });
  return { ...got, object: obj };
}

/** The saved layout of a record, or null. */
export function readLayoutFile(paths: ProjectPaths, r: AnalysisRecord): LayoutFile | null {
  const k = fileKey(paths, r.imageId, layoutKey(r.imageId, recordKeyOf(paths, r)));
  return (workspaceStorage(paths.workspace).getJson(k) as LayoutFile | undefined) ?? null;
}

/**
 * A saved layout still fits the record's final reading (its text and capture references, the
 * marketing layer present or not): a reading settled or rewritten later may no longer match.
 */
const fits = (f: LayoutFile, r: AnalysisRecord) =>
  !!r.final && layoutProblems(f.layout, r.final).length === 0;

/**
 * Saves a usable record's layout once, from its producer answer (free, no model call). Called
 * whenever a record is saved. The first valid layout wins; a later writer keeps it.
 */
export function ensureLayout(paths: ProjectPaths, r: AnalysisRecord): LayoutFile | null {
  if (!isUsable(r)) return null;
  const done = readLayoutFile(paths, r);
  if (done) return fits(done, r) ? done : null;
  const got = layoutFromAnswer(paths, r);
  if (!got.layout || !got.object) return null;
  const recordKey = recordKeyOf(paths, r);
  const file: LayoutFile = {
    version: LAYOUT_SCHEMA_VERSION,
    contract: LAYOUT_CONTRACT,
    imageId: r.imageId,
    recordKey,
    source: "same-call",
    model: got.object.model,
    object: got.object.key,
    createdAt: new Date().toISOString(),
    layout: got.layout,
  };
  const k = fileKey(paths, r.imageId, layoutKey(r.imageId, recordKey));
  const storage = workspaceStorage(paths.workspace);
  if (!storage.putJsonOnce(k, file)) return storage.getJson(k) as LayoutFile;
  return file;
}

/**
 * current: a layout of today's version for this record; outdated: only an older layout version
 * exists for it; missing: none (analysed before layout capture, or its layout failed the checks).
 */
export function layoutStatus(
  paths: ProjectPaths,
  r: AnalysisRecord,
): { status: LayoutStatus; file: LayoutFile | null } {
  const file = readLayoutFile(paths, r);
  if (file) return fits(file, r) ? { status: "current", file } : { status: "missing", file: null };
  const storage = workspaceStorage(paths.workspace);
  const rk = recordKeyOf(paths, r);
  for (const k of storage.list(dirOf(paths, r.imageId))) {
    const f = storage.getJson(k) as Partial<LayoutFile> | undefined;
    if (
      f?.recordKey === rk &&
      (f.version !== LAYOUT_SCHEMA_VERSION || f.contract !== LAYOUT_CONTRACT)
    )
      return { status: "outdated", file: null };
  }
  return { status: "missing", file: null };
}
