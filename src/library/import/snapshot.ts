import { batchDataHash } from "../../analysis/entries.ts";
import { labeler } from "../../analysis/labels.ts";
import { buildAnalysisPlan, type Stage } from "../../analysis/plan.ts";
import {
  type AnalysisRecord,
  infoViews,
  isUsable,
  readRecords,
  summaries,
} from "../../analysis/records.ts";
import { coreOrder, type LoadedConfig, loadTaxonomy, projectPaths } from "../../config/load.ts";
import { openImageDb } from "../../store/imagedb.ts";
import { stableHash } from "../../util/hash.ts";
import { buildViewModel, latestRun } from "../../view/model.ts";

export interface PlanFacts {
  planHash: string;
  newImages: number;
  full: number;
  usd: [number, number];
  synthesisNeeded: boolean;
  dataHash: string;
}

/** What the import must not change: images, approval fingerprints, report freshness, views. */
export interface Snapshot {
  imageCount: number;
  images: string;
  records: string;
  usableRecords: number;
  plans: Record<Stage, PlanFacts | { error: string }>;
  view: string | null;
}

function planFacts(loaded: LoadedConfig, stage: Stage): PlanFacts | { error: string } {
  try {
    const plan = buildAnalysisPlan(loaded, stage);
    return {
      planHash: plan.planHash,
      newImages: plan.counts.newImages,
      full: plan.counts.full,
      usd: plan.estimate.usd,
      synthesisNeeded: plan.synthesisNeeded,
      dataHash: batchDataHash(plan, readRecords(projectPaths(loaded))),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const STORAGE_FIELDS = ["key", "provenance", "pipeline", "writtenBy", "paidBy"] as const;

/**
 * Everything a project sees of a record: its full content, minus the library's own bookkeeping
 * and the on-disk location of files (which the import changes on purpose). Served paths stay.
 */
function visible(r: AnalysisRecord): unknown {
  const out: Record<string, unknown> = { ...r };
  for (const k of STORAGE_FIELDS) delete out[k];
  const idn = r.identity;
  if (idn)
    out.identity = {
      ...idn,
      files: {
        original: idn.files.original?.relative ?? null,
        thumb: idn.files.thumb?.relative ?? null,
      },
    };
  return out;
}

export function takeSnapshot(loaded: LoadedConfig): Snapshot {
  const paths = projectPaths(loaded);
  const db = openImageDb(paths);
  const images = db
    .all()
    .map((r) => ({
      ...r,
      sources: [...r.sources].map((s) => `${s.appId}|${s.gl}|${s.hl}|${s.position}`).sort(),
      googleIds: [...r.googleIds].sort(),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const records = [...readRecords(paths).values()]
    .map((r) => [r.imageId, visible(r), isUsable(r)] as const)
    .sort((a, b) => a[0].localeCompare(b[0]));
  const run = latestRun(paths.runs);
  const label = labeler(loadTaxonomy(loaded).taxonomy);
  const view = run
    ? stableHash(
        buildViewModel(
          loaded.config,
          run,
          db,
          coreOrder(loaded, paths),
          summaries(paths, label),
          infoViews(paths, label),
        ),
      )
    : null;
  return {
    imageCount: images.length,
    images: stableHash(images),
    records: stableHash(records),
    usableRecords: records.filter((r) => r[2]).length,
    plans: { pilot: planFacts(loaded, "pilot"), core: planFacts(loaded, "core") },
    view,
  };
}

/** Plain-language differences; empty when the import changed nothing that matters. */
export function compareSnapshots(before: Snapshot, after: Snapshot): string[] {
  const out: string[] = [];
  if (before.imageCount !== after.imageCount || before.images !== after.images)
    out.push(`the image list differs (${before.imageCount} before, ${after.imageCount} after)`);
  if (before.records !== after.records || before.usableRecords !== after.usableRecords)
    out.push("the analysis records differ (status, version or usability)");
  for (const stage of ["pilot", "core"] as const) {
    const a = before.plans[stage];
    const b = after.plans[stage];
    if (stableHash(a) !== stableHash(b))
      out.push(`the ${stage} approval numbers or fingerprint differ`);
  }
  if (before.view !== after.view) out.push("the gallery view differs");
  return out;
}
