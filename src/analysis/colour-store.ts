import type { ProjectPaths } from "../config/load.ts";
import type { Config } from "../config/schema.ts";
import { imageKey, LIB, modelFile } from "../library/layout.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import type { ImageDb } from "../store/imagedb.ts";
import { stableHash } from "../util/hash.ts";
import {
  COLOUR_MEASURE_VERSION,
  type MeasuredColours,
  measureColours,
  withMeasuredColours,
} from "./colour-measure.ts";
import { type AnalysisRecord, isUsable } from "./records.ts";

/** Where an image's measured layer colours are kept (next to its pixel facts). */
function colourKey(paths: ProjectPaths, imageId: string): string {
  return paths.library
    ? LIB.pixels(imageId, COLOUR_MEASURE_VERSION)
    : projectKey(paths, "images", "facts", `${imageId}.${COLOUR_MEASURE_VERSION}.json`);
}

/** The reading the boxes came from: a new or changed reading is measured again. */
const basedOn = (r: AnalysisRecord) => stableHash(r.final).slice(0, 32);

/** The saved measurement for this record, or null (not measured yet, or for an older record). */
export function readMeasured(paths: ProjectPaths, r: AnalysisRecord): MeasuredColours | null {
  const m = workspaceStorage(paths.workspace).getJson(colourKey(paths, r.imageId)) as
    | MeasuredColours
    | undefined;
  return m?.version === COLOUR_MEASURE_VERSION && m.basedOn === basedOn(r) ? m : null;
}

/**
 * Measures a usable record's layer colours once (free, code only) from the model copy, or the
 * original when there is none. Called whenever a record is saved.
 */
export async function ensureMeasured(
  paths: ProjectPaths,
  db: Pick<ImageDb, "get">,
  r: AnalysisRecord,
): Promise<MeasuredColours | null> {
  if (!isUsable(r)) return null;
  const done = readMeasured(paths, r);
  if (done) return done;
  const storage = workspaceStorage(paths.workspace);
  const rec = db.get(r.imageId);
  const bytes =
    storage.getBytes(imageKey(paths, modelFile(!!paths.library, r.imageId))) ??
    (rec ? storage.getBytes(imageKey(paths, rec.file)) : undefined);
  if (!bytes) return null;
  const m = await measureColours(bytes, r.final, basedOn(r)).catch(() => null);
  if (m) storage.putJson(colourKey(paths, r.imageId), m);
  return m;
}

/** withMeasuredRecords after measuring every record not measured yet (when the switch is on). */
export async function measuredRecords(
  paths: ProjectPaths,
  db: Pick<ImageDb, "get">,
  config: Config,
  records: ReadonlyMap<string, AnalysisRecord>,
): Promise<Map<string, AnalysisRecord>> {
  if (config.options.speed.measuredColours)
    for (const r of records.values()) await ensureMeasured(paths, db, r);
  return withMeasuredRecords(paths, config, records);
}

/**
 * Records for statistics and the recommendation input. With "Colours measured by code" on,
 * every usable reading carries its measured colours (old and new records alike, never mixed
 * with the model's); until every usable record is measured, all keep the model's colours.
 */
export function withMeasuredRecords(
  paths: ProjectPaths,
  config: Config,
  records: ReadonlyMap<string, AnalysisRecord>,
): Map<string, AnalysisRecord> {
  if (!config.options.speed.measuredColours) return new Map(records);
  const measured = new Map<string, MeasuredColours>();
  for (const [id, r] of records) {
    if (!isUsable(r)) continue;
    const m = readMeasured(paths, r);
    // One image not measured yet: the model's colours for all, so the two never mix.
    if (!m) return new Map(records);
    measured.set(id, m);
  }
  return new Map(
    [...records].map(([id, r]) => {
      const m = measured.get(id);
      return [id, m && r.final ? { ...r, final: withMeasuredColours(r.final, m) } : r];
    }),
  );
}
