import type { AnalysisRecord } from "../analysis/records.ts";
import type { ProjectPaths } from "../config/load.ts";
import { LIB, pixelsKey } from "../library/layout.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";
import { layoutProblems } from "./checks.ts";
import { LAYOUT_MEASURE_VERSION, type LayoutMeasure } from "./measure/index.ts";
import type { Layout } from "./schema.ts";
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
  /** "new": right after a new analysis; "backfill": added later to an older analysis. */
  source: "new" | "backfill";
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

/** The saved measurements of a record's layout, or null. */
export function readLayoutMeasure(paths: ProjectPaths, r: AnalysisRecord): LayoutMeasure | null {
  const key = layoutKey(r.imageId, recordKeyOf(paths, r));
  const k = measureKey(paths, r.imageId, key, LAYOUT_MEASURE_VERSION);
  return (workspaceStorage(paths.workspace).getJson(k) as LayoutMeasure | undefined) ?? null;
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

/** Saves a record's layout once; the first valid layout wins, a later writer keeps it. */
export function saveLayout(
  paths: ProjectPaths,
  r: AnalysisRecord,
  layout: Layout,
  from: { source: LayoutFile["source"]; model: string; object: string },
): LayoutFile {
  const recordKey = recordKeyOf(paths, r);
  const file: LayoutFile = {
    version: LAYOUT_SCHEMA_VERSION,
    contract: LAYOUT_CONTRACT,
    imageId: r.imageId,
    recordKey,
    ...from,
    createdAt: new Date().toISOString(),
    layout,
  };
  const k = fileKey(paths, r.imageId, layoutKey(r.imageId, recordKey));
  const storage = workspaceStorage(paths.workspace);
  if (!storage.putJsonOnce(k, file)) return storage.getJson(k) as LayoutFile;
  return file;
}

/**
 * current: a layout of today's version for this record that fits its reading; outdated: only an
 * older layout version exists for it; missing: none (analysed before layouts, or it failed).
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
