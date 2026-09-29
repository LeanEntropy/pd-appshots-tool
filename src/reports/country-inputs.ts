import { reportLabeler } from "../analysis/categories.ts";
import { withMeasuredRecords } from "../analysis/colour-store.ts";
import { batchEntries } from "../analysis/entries.ts";
import type { Labeler } from "../analysis/labels.ts";
import { labeler } from "../analysis/labels.ts";
import { combinedRecord, type LayerDiffRecord } from "../analysis/layer-diff.ts";
import { withCurrentMapping } from "../analysis/record-refresh.ts";
import { type AnalysisRecord, isUsable, readRecords } from "../analysis/records.ts";
import { reportInputs } from "../analysis/report-inputs.ts";
import type { Recommendations } from "../analysis/synthesis-schema.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { analysedSlots } from "../core/selection.ts";
import { readDeck } from "../store/manifest.ts";
import { type CountrySlice, countrySlices } from "./build.ts";
import { eligibility } from "./eligibility.ts";
import { layerLookup } from "./layer-lookup.ts";
import { type LocalisationData, localisation } from "./localisation.ts";
import type { PlanContext, ScopePlan } from "./scope-plan.ts";

/**
 * What a One country or Compare countries report is built from, read once (code only): the
 * analyses plus, for each image that only had its text compared, the reading assembled from its
 * anchor and the text-layer comparison; the per-country slices; the localisation against the
 * main country; and the recommendations of the check the report rests on (Full check, else Pilot).
 */
export interface CountryInputs {
  plan: ScopePlan;
  records: Map<string, AnalysisRecord>;
  layers: Map<string, LayerDiffRecord>;
  slices: CountrySlice[];
  label: Labeler;
  localisation: LocalisationData | null;
  base: {
    stage: "pilot" | "core" | null;
    recommendations: Recommendations | null;
    runId: string | null;
    competitors: number;
  };
}

/** The analysed phone slots of a game in one country (from its deck manifest). */
export function slotsOf(loaded: LoadedConfig) {
  const paths = projectPaths(loaded);
  return (appId: string, gl: string, hl: string) => {
    const d = readDeck(paths.decks, { appId, gl, hl });
    if (d?.status !== "ok") return [];
    return analysedSlots(loaded.config, d).flatMap((s) =>
      s.imageId ? [{ position: s.position, imageId: s.imageId }] : [],
    );
  };
}

/**
 * The analyses of a report's images, plus a reading assembled by code for each image whose text
 * was compared with its anchor (anchor screen + new marketing layer); never saved as an analysis.
 */
export function withLayerRecords(
  loaded: LoadedConfig,
  plan: Pick<ScopePlan, "items">,
): { records: Map<string, AnalysisRecord>; layers: Map<string, LayerDiffRecord> } {
  const records = withMeasuredRecords(
    projectPaths(loaded),
    loaded.config,
    withCurrentMapping(readRecords(projectPaths(loaded))),
  );
  const lookup = layerLookup(loaded, records);
  const layers = new Map<string, LayerDiffRecord>();
  for (const it of plan.items) {
    if (!it.basedOn || it.basedOn === it.imageId || isUsable(records.get(it.imageId))) continue;
    const d = lookup(it.imageId, it.basedOn);
    if (!d) continue;
    layers.set(it.imageId, d);
    const anchor = records.get(it.basedOn);
    const view = isUsable(anchor) ? combinedRecord(d, anchor) : null;
    if (view) records.set(it.imageId, view);
  }
  return { records, layers };
}

export function countryInputs(
  loaded: LoadedConfig,
  plan: ScopePlan,
  ctx: PlanContext,
): CountryInputs {
  const { records, layers } = withLayerRecords(loaded, plan);
  const merged: PlanContext = { ...ctx, records };
  const slices = countrySlices(loaded, plan, merged);
  const label = reportLabeler(labeler(loadTaxonomy(loaded).taxonomy));
  const e = eligibility(loaded);
  const baseInputs = e.base ? reportInputs(loaded, e.base) : null;
  const baseAi = baseInputs?.latestAi ?? null;
  const baseGames = baseInputs ? baseInputs.plan.games.length - 1 : 0;
  const slots = slotsOf(loaded);
  const loc = localisation({
    main: plan.main,
    markets: plan.markets,
    games: plan.games.map((g) => ({ appId: g.appId, name: g.name, ours: g.ours })),
    decks: plan.decks,
    slots,
    image: (id) => {
      const r = ctx.db.get(id);
      return r ? { phash: r.phash, width: r.width, height: r.height, thumb: r.thumb } : null;
    },
    record: (id) => records.get(id),
    layer: (id) => layers.get(id),
    different: ctx.different,
  });
  return {
    plan,
    records,
    layers,
    slices,
    label,
    localisation: loc,
    base: {
      stage: e.base,
      recommendations: baseAi?.recommendations ?? null,
      runId: baseAi?.runId ?? null,
      competitors: Math.max(0, baseGames),
    },
  };
}

/** Every analysed image of one country slice, ours separated (the pattern code's entries). */
export function sliceEntries(x: CountryInputs, s: CountrySlice) {
  return batchEntries(s.inputs.plan, x.records, s.inputs.db, s.inputs.ourAppId, s.inputs.repeats);
}
