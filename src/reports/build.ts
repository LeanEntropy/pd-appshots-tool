import { reportLabeler } from "../analysis/categories.ts";
import { repeatsOfItems, sameCheck } from "../analysis/deck-repeats.ts";
import { batchDataHash } from "../analysis/entries.ts";
import { labeler } from "../analysis/labels.ts";
import { PATTERN_FIT_VERSION } from "../analysis/pattern-fit.ts";
import type { AnalysisPlan } from "../analysis/plan.ts";
import { PROMPT_VERSIONS } from "../analysis/prompts.ts";
import type { ReportInputs } from "../analysis/report-data.ts";
import { SCHEMA_VERSION } from "../analysis/schema.ts";
import { compareStoreText } from "../analysis/store-compare.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import { readDeck } from "../store/manifest.ts";
import { stableHash } from "../util/hash.ts";
import { buildCountryVersion } from "./country-version.ts";
import { eligibility, eligibilityProblem, scopeIncomplete } from "./eligibility.ts";
import { forStore } from "./plan-context.ts";
import { buildScopePlan, type PlanContext, planContext, type ScopePlan } from "./scope-plan.ts";
import { readDef } from "./store.ts";
import { isPresetDef, type MarketRef, type ReportDef } from "./types.ts";
import { buildPresetVersion } from "./version.ts";

/** One country of a builder report: the inputs the existing report builder reads. */
export interface CountrySlice {
  market: MarketRef;
  inputs: ReportInputs;
}

/**
 * Per country, the report inputs of that country's part of the plan (plan-reports 3: the
 * existing buildReportData is reused per country with its plan slice). Code only.
 */
export function countrySlices(
  loaded: LoadedConfig,
  plan: ScopePlan,
  ctx: PlanContext = planContext(loaded),
): CountrySlice[] {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const { db, records } = ctx;
  const taxonomy = loadTaxonomy(loaded);
  const label = reportLabeler(labeler(taxonomy.taxonomy));
  const storage = workspaceStorage(paths.workspace);
  const same = sameCheck(paths, records);
  const versions = {
    prompts: PROMPT_VERSIONS,
    schema: SCHEMA_VERSION,
    taxonomy: taxonomy.hash,
    fit: PATTERN_FIT_VERSION,
  };
  return plan.markets.map((m) => {
    const decks = plan.decks.filter((d) => d.gl === m.gl && d.state === "ok");
    const items = plan.items.filter((i) => i.gl === m.gl && !i.anchorAdded);
    const games = decks.map((d) => ({ appId: d.appId, name: d.name, positions: d.positions }));
    const slice = {
      stage: "core",
      createdAt: "",
      planHash: plan.planHash,
      market: m,
      games,
      items,
      excluded: [],
      counts: plan.counts,
      cap: 0,
      coreTotal: 0,
      withinCap: true,
      estimate: plan.images,
      synthesisNeeded: false,
      models: {},
      versions,
      review: null,
      estimates: null,
      budget: null,
    } satisfies AnalysisPlan;
    const missing = plan.decks.filter((d) => d.gl === m.gl && d.state !== "ok");
    const inputs: ReportInputs = {
      plan: slice,
      approved: true,
      ourAppId: config.ourApp.id,
      records,
      decks: new Map(
        decks.map((d) => [d.appId, readDeck(paths.decks, { appId: d.appId, gl: m.gl, hl: m.hl })]),
      ),
      db,
      orderDates: new Map(decks.map((d) => [d.appId, d.orderDate])),
      label,
      dataHash: batchDataHash(slice, records),
      repeats: repeatsOfItems(items, (id) => db.get(id), same),
      latestAi: null,
      lastSkip: null,
      estimateUsd: plan.text.usd,
      leftOut: missing.filter((d) => d.state === "not-sold").map((d) => d.name),
      storeText: compareStoreText(
        storage,
        config.markets.filter((x) => x.gl === m.gl && x.hl === m.hl),
        { appId: config.ourApp.id, name: config.ourApp.name },
        games.filter((g) => g.appId !== config.ourApp.id),
      ),
    };
    return { market: m, inputs };
  });
}

/** Fingerprint of the data a builder report is made from (the "Newer data" comparison). */
export function scopeDataHash(plan: ScopePlan, slices: readonly CountrySlice[]): string {
  return stableHash({
    scope: plan.decks.map((d) => [d.appId, d.gl, d.state, d.orderDate]),
    countries: slices.map((s) => [s.market.gl, s.inputs.dataHash]),
  });
}

export type BuildResult =
  | { ok: true; versionId: string; def: ReportDef }
  | { ok: false; status: number; problem: string };

/**
 * "Build report" (plan-reports 1.2): builds a new immutable version at once, only when the report
 * needs no new analysis. Pilot and Full check are rebuilt from the saved analyses; One country and
 * Compare countries get their full content, with the text-only AI parts already paid for (the rest
 * marked missing, with how to get them). No AI is ever called here.
 */
export async function buildReportVersion(
  loaded: LoadedConfig,
  def: ReportDef,
  o: { now?: Date; research?: (plan: ScopePlan) => { lines: string[]; saved: unknown } } = {},
): Promise<BuildResult> {
  const now = o.now ?? new Date();
  // The report's store (plan-app-store 7.1): an App Store report reads the App Store decks.
  const store = forStore(loaded, def.scope.platform);
  loaded = store.loaded;
  const e = eligibility(loaded);
  const refused = eligibilityProblem(e, def.type);
  if (refused) return { ok: false, status: 409, problem: refused };
  const incomplete = scopeIncomplete(def.scope);
  if (incomplete) return { ok: false, status: 409, problem: incomplete };
  const ctx = store.ctx;
  const plan = buildScopePlan(loaded, def.scope, { ctx });
  if (!plan.instant)
    return {
      ok: false,
      status: 409,
      problem: `This report needs ${plan.counts.newImages} new ${plan.counts.newImages === 1 ? "image" : "images"} analysed first (about $${plan.usd[0].toFixed(2)} to $${plan.usd[1].toFixed(2)}). Nothing was sent.`,
    };
  if (!isPresetDef(def))
    return buildCountryVersion(loaded, def, {
      now,
      ctx,
      ...(o.research ? { research: o.research } : {}),
    });
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const take = o.research;
  buildPresetVersion(loaded, def, now, take ? () => take(plan) : undefined);
  const next = readDef(s, paths, def.id) ?? def;
  const versionId = next.versions.at(-1)?.id ?? "";
  return { ok: true, versionId, def: next };
}
