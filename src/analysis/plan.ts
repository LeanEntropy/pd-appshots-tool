import { join } from "node:path";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { analysedSlots, coreDeck, fitFor } from "../core/selection.ts";
import { baselineMarket, coreMarket } from "../core/targets.ts";
import { ImageDb } from "../store/imagedb.ts";
import { readJsonIfExists, writeJsonAtomic } from "../util/fsx.ts";
import { stableHash } from "../util/hash.ts";
import { batchDataHash } from "./entries.ts";
import { type Estimate, estimate } from "./estimate.ts";
import { readLatest } from "./final-report.ts";
import { PATTERN_FIT_VERSION } from "./pattern-fit.ts";
import { PROMPT_VERSIONS } from "./prompts.ts";
import { isUsable, readRecords } from "./records.ts";
import { SCHEMA_VERSION } from "./schema.ts";
import { assignTiers, type TierInput, type TierResult } from "./tiers.ts";

export type Stage = "pilot" | "core";

export interface PlanItem extends TierResult {
  name: string;
}

export interface ExcludedItem {
  name: string;
  position: number;
  reason: string;
}

export interface AnalysisPlan {
  stage: Stage;
  createdAt: string;
  planHash: string;
  market: { gl: string; hl: string; label: string };
  games: { appId: string; name: string; positions: number[] }[];
  items: PlanItem[];
  excluded: ExcludedItem[];
  counts: { identical: number; layerDiff: number; full: number; newImages: number };
  cap: number;
  coreTotal: number;
  withinCap: boolean;
  estimate: Estimate;
  /** Patterns and recommendations must be (re)written: new images, or none for this data yet. */
  synthesisNeeded: boolean;
  models: Record<string, string>;
  versions: { prompts: Record<string, string>; schema: string; taxonomy: string; fit: string };
  review: unknown;
  estimates: unknown;
  budget: unknown;
}

export function planFile(loaded: LoadedConfig, stage: Stage): string {
  return join(projectPaths(loaded).pending, `analysis-plan-${stage}.json`);
}

export function readSavedPlan(loaded: LoadedConfig, stage: Stage): AnalysisPlan | undefined {
  return readJsonIfExists(planFile(loaded, stage)) as AnalysisPlan | undefined;
}

/**
 * Deterministic work list for an analysis stage (no AI): pilot = our deck plus the first
 * picked competitors; core = every deck the whole-deck fit rule keeps. Core market only.
 */
export function buildAnalysisPlan(
  loaded: LoadedConfig,
  stage: Stage,
  opts: { save: boolean } = { save: false },
): AnalysisPlan {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const market = coreMarket(config);
  const baseline = baselineMarket(config);
  const view = fitFor(loaded);
  const competitors =
    stage === "pilot"
      ? view.fit.selected.slice(0, config.core.pilotCompetitors)
      : view.fit.selected;
  const apps = [{ appId: config.ourApp.id, name: config.ourApp.name }, ...competitors];
  const db = ImageDb.open(paths.imageDb, paths.imagesOrig, paths.imagesThumb);

  const inputs: TierInput[] = [];
  const excluded: ExcludedItem[] = [];
  const games: AnalysisPlan["games"] = [];
  for (const a of apps) {
    const deck = coreDeck(loaded, a.appId);
    const keep = new Set(analysedSlots(config, deck).map((s) => s.position));
    const positions: number[] = [];
    for (const s of deck?.slots ?? []) {
      const rec = s.imageId ? db.get(s.imageId) : undefined;
      if (!keep.has(s.position))
        excluded.push({
          name: a.name,
          position: s.position,
          reason: `${s.deviceClass}-shaped screenshot (only ${config.core.deviceClasses.join(", ")} analysed)`,
        });
      else if (!rec) excluded.push({ name: a.name, position: s.position, reason: "image missing" });
      else {
        positions.push(s.position);
        inputs.push({
          appId: a.appId,
          gl: market.gl,
          hl: market.hl,
          position: s.position,
          imageId: rec.id,
          phash: rec.phash,
        });
      }
    }
    games.push({ appId: a.appId, name: a.name, positions });
  }

  const records = readRecords(paths);
  const analysed = [...records.values()]
    .filter((r) => isUsable(r))
    .map((r) => ({
      appId: r.appId,
      imageId: r.imageId,
      phash: db.get(r.imageId)?.phash ?? "",
      baseline: r.gl === baseline.gl && r.hl === baseline.hl,
    }))
    .filter((a) => a.phash);
  const names = new Map(apps.map((a) => [a.appId, a.name]));
  const tiered = assignTiers(
    inputs,
    analysed,
    (gl, hl) => gl === baseline.gl && hl === baseline.hl,
  );
  const items: PlanItem[] = tiered.map((t) => ({ ...t, name: names.get(t.appId) ?? t.appId }));
  const counts = {
    identical: items.filter((i) => i.tier === "identical").length,
    layerDiff: items.filter((i) => i.tier === "layer-diff").length,
    full: items.filter((i) => i.tier === "full").length,
    newImages: 0,
  };
  counts.newImages = counts.layerDiff + counts.full;
  // Core total = unique images of the current core set (all fitted decks) that are analysed
  // already, plus this batch's new ones. Records of games no longer in the core do not count.
  const coreIds = new Set<string>();
  for (const a of [{ appId: config.ourApp.id }, ...view.fit.selected]) {
    for (const s of analysedSlots(config, coreDeck(loaded, a.appId)))
      if (s.imageId) coreIds.add(s.imageId);
  }
  const alreadyInCore = [...coreIds].filter((id) => {
    return isUsable(records.get(id));
  }).length;
  const coreTotal = alreadyInCore + counts.newImages;
  const versions = {
    prompts: PROMPT_VERSIONS,
    schema: SCHEMA_VERSION,
    taxonomy: loadTaxonomy(loaded).hash,
    fit: PATTERN_FIT_VERSION,
  };
  const models = { ...config.models } as Record<string, string>;
  const latest = readLatest(paths, stage);
  const synthesisNeeded =
    counts.newImages > 0 ||
    !latest?.complete ||
    latest.dataHash !== batchDataHash({ games, items, versions }, records);
  const est = estimate(config, items, synthesisNeeded);
  const body = {
    stage,
    market: { gl: market.gl, hl: market.hl, label: market.label },
    games,
    items,
    excluded,
    counts,
    cap: config.core.imageCap,
    coreTotal,
    withinCap: coreTotal <= config.core.imageCap,
    estimate: est,
    synthesisNeeded,
    models,
    versions,
    review: config.review,
    estimates: config.estimates,
    budget: config.budget,
  };
  // The fingerprint covers everything shown on the approval screen and everything the run uses.
  const plan: AnalysisPlan = {
    ...body,
    createdAt: new Date().toISOString(),
    planHash: stableHash(body),
  };
  // Saved only when the approval screen is shown, so an approval always refers to what was seen.
  if (opts.save) writeJsonAtomic(planFile(loaded, stage), plan);
  return plan;
}
