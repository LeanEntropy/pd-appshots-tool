import type { AnalysisRecord } from "../analysis/records.ts";
import type { ProjectPaths } from "../config/load.ts";
import { imageKey, modelFile } from "../library/layout.ts";
import { workspaceStorage } from "../storage/index.ts";
import type { ImageDb } from "../store/imagedb.ts";
import { LAYOUT_MEASURE_VERSION, type LayoutMeasure, measureLayout } from "./measure/index.ts";
import { ensureLayout, type LayoutFile, layoutKey, measureKey, recordKeyOf } from "./store.ts";

/** The saved measurements of a layout, or null. */
export function readLayoutMeasure(paths: ProjectPaths, r: AnalysisRecord): LayoutMeasure | null {
  const k = measureKey(
    paths,
    r.imageId,
    layoutKey(r.imageId, recordKeyOf(paths, r)),
    LAYOUT_MEASURE_VERSION,
  );
  return (workspaceStorage(paths.workspace).getJson(k) as LayoutMeasure | undefined) ?? null;
}

/**
 * After a record is saved: its layout (from the producer's answer, free) and the layout's pixel
 * measurements (code only), each written once. Never fails the save: a missing image or a
 * measuring error leaves the layout unmeasured ("estimated").
 */
export async function ensureLayoutMeasured(
  paths: ProjectPaths,
  db: Pick<ImageDb, "get">,
  r: AnalysisRecord,
): Promise<{ file: LayoutFile | null; measure: LayoutMeasure | null }> {
  const file = ensureLayout(paths, r);
  if (!file) return { file: null, measure: null };
  const done = readLayoutMeasure(paths, r);
  if (done) return { file, measure: done };
  const storage = workspaceStorage(paths.workspace);
  const rec = db.get(r.imageId);
  const bytes =
    (rec ? storage.getBytes(imageKey(paths, rec.file)) : undefined) ??
    storage.getBytes(imageKey(paths, modelFile(!!paths.library, r.imageId)));
  if (!bytes) return { file, measure: null };
  const key = layoutKey(r.imageId, file.recordKey);
  const measure = await measureLayout(bytes, file.layout, {
    imageId: r.imageId,
    layoutKey: key,
  }).catch(() => null);
  if (measure)
    storage.putJsonOnce(measureKey(paths, r.imageId, key, LAYOUT_MEASURE_VERSION), measure);
  return { file, measure };
}
