import { categoryOf, isArtCategory, reportLabeler } from "../analysis/categories.ts";
import { showsLogo } from "../analysis/image-tags.ts";
import { labeler, screenName } from "../analysis/labels.ts";
import { PATTERN_FIT_VERSION } from "../analysis/pattern-fit.ts";
import { PROMPT_VERSIONS } from "../analysis/prompts.ts";
import { type AnalysisRecord, isUsable } from "../analysis/records.ts";
import { SCHEMA_VERSION } from "../analysis/schema.ts";
import { TITLE_ART_TYPES } from "../appstore/apple-rules.ts";
import { appleLangFor } from "../appstore/lang.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { analysedSlots } from "../core/selection.ts";
import { workspaceStorage } from "../storage/index.ts";
import { newRunId, readDeck } from "../store/manifest.ts";
import { stableHash } from "../util/hash.ts";
import { pairKey } from "./anchors.ts";
import type { BuildResult } from "./build.ts";
import { withLayerRecords } from "./country-inputs.ts";
import type { CountryBuildOptions } from "./country-version.ts";
import { eligibility } from "./eligibility.ts";
import { mainMarketRef } from "./main-market.ts";
import { readSamePairs } from "./match-check.ts";
import { forStore } from "./plan-context.ts";
import type { PlanContext, ScopePlan } from "./scope-plan.ts";
import { buildScopePlan } from "./scope-plan.ts";
import { addVersion, versionFileKey, writeVersionInputs } from "./store.ts";
import { storesAdvice, storesSummary } from "./stores-advice.ts";
import { comparePair, storePatterns } from "./stores-data.ts";
import { storesMarkdown } from "./stores-md.ts";
import type { PairInput, Reading, StoreSlot, StoresReport } from "./stores-types.ts";
import type { ReportDef, ReportScope, VersionInputs } from "./types.ts";

/** Plain notes on what App Store data cannot show (plan-app-store 10; shown once, folded). */
export const STORE_CAVEATS = [
  "App Store images come from Apple's Lookup API, the only source Apple's terms allow: the set it returns is not verified against the page visitors see (for one game it was an older set).",
  "Preview videos, in-app events, the subtitle and the promotional text are not available from Apple's API, so video presence is not compared.",
  "Custom product pages cannot be seen from outside: only the default page is compared.",
];

/**
 * The "Google Play vs App Store" report of a scope, from the decks of both stores and the saved
 * analyses (code only; reads, never writes).
 */
export function storesReportOf(
  loaded: LoadedConfig,
  scope: ReportScope,
  o: { now?: Date; ctx?: PlanContext; partial?: string | null } = {},
): { report: StoresReport; plan: ScopePlan; records: Map<string, AnalysisRecord> } {
  const now = o.now ?? new Date();
  const play = forStore(loaded, "play", o.ctx);
  const apple = forStore(loaded, "appstore", o.ctx);
  const plan = buildScopePlan(play.loaded, scope, { ctx: play.ctx });
  const records = withLayerRecords(apple.loaded, plan);
  for (const [id, r] of apple.ctx.records) if (!records.records.has(id)) records.records.set(id, r);
  const same = new Set(readSamePairs(loaded));
  for (const [id, d] of records.layers) if (d.status === "ok") same.add(pairKey(id, d.anchorId));
  const label = reportLabeler(labeler(loadTaxonomy(loaded).taxonomy));
  const reading = (id: string | null, game: string): Reading | null => {
    const r: AnalysisRecord | undefined = id ? records.records.get(id) : undefined;
    if (!isUsable(r)) return null;
    const f = r.final;
    return {
      screenType: f.screenshot.screenType,
      screen: screenName(label, f.screenshot.screenType, f.screenshot.subtype ?? ""),
      headline: f.headline ?? "",
      texts: f.marketingLayer.texts.map((t) => t.text),
      logo: showsLogo(f, game),
      art: isArtCategory(categoryOf(f)) || TITLE_ART_TYPES.has(f.screenshot.screenType),
    };
  };
  const slotsOf = (
    decksDir: string,
    db: typeof play.ctx.db,
    appId: string,
    gl: string,
    hl: string,
    game: string,
  ) => {
    const d = readDeck(decksDir, { appId, gl, hl });
    const state = d?.status === "ok" ? "ok" : d?.status === "unavailable" ? "not-sold" : "none";
    const slots: StoreSlot[] = analysedSlots(loaded.config, d).flatMap((s) => {
      const rec = s.imageId ? db.get(s.imageId) : undefined;
      if (!rec) return [];
      return [
        {
          position: s.position,
          imageId: rec.id,
          thumb: rec.thumb ?? null,
          width: rec.width,
          height: rec.height,
          orientation: rec.orientation,
          phash: rec.phash,
          reading: reading(rec.id, game),
        },
      ];
    });
    return { state: state as PairInput["play"]["state"], slots };
  };
  const twins = new Map(
    plan.items
      .filter((i) => i.platform === "appstore" && i.sameAs)
      .map((i) => [i.imageId, i.sameAs]),
  );
  const pairs = plan.markets.flatMap((m) =>
    plan.games.map((g) => {
      const p = slotsOf(projectPaths(play.loaded).decks, play.ctx.db, g.appId, m.gl, m.hl, g.name);
      const a = slotsOf(
        projectPaths(apple.loaded).decks,
        apple.ctx.db,
        g.appId,
        m.gl,
        m.hl,
        g.name,
      );
      const withTwin = a.slots.map((s) => {
        const sameAs = twins.get(s.imageId);
        return sameAs ? { ...s, sameAs } : s;
      });
      return comparePair(
        {
          appId: g.appId,
          name: g.name,
          ours: g.ours,
          gl: m.gl,
          country: m.label,
          play: p,
          apple: { state: a.state, slots: withTwin },
        },
        same,
      );
    }),
  );
  const patterns = plan.markets.flatMap((m) => storePatterns(pairs, m.gl));
  const traffic = loaded.config.options.traffic;
  const advice = storesAdvice(pairs, patterns, {
    markets: plan.markets,
    projectMarkets: loaded.config.markets.map((m) => ({ gl: m.gl, hl: m.hl, label: m.label })),
    traffic: (gl) => traffic[gl] ?? "unknown",
    appleLang: (m) => `${m.label} (${appleLangFor(m.gl, m.hl)})`,
  });
  const partial = o.partial;
  const report: StoresReport = {
    kind: "stores",
    version: 1,
    generatedAt: now.toISOString(),
    countries: plan.markets.map((m) => ({ gl: m.gl, label: m.label })),
    summary: storesSummary(pairs, patterns, advice.recommendations),
    pairs,
    patterns,
    ...advice,
    caveats: [...(partial ? [partial] : []), ...STORE_CAVEATS],
    leftOut: plan.decks
      .filter((d) => d.state === "not-sold")
      .map(
        (d) =>
          `${d.name} (${d.country}, ${d.platform === "appstore" ? "App Store" : "Google Play"})`,
      ),
  };
  return { report, plan, records: records.records };
}

/**
 * A new immutable version of a "Google Play vs App Store" report (no AI call). Written once:
 * stores-report.json, report.md and version.json.
 */
export async function buildStoresVersion(
  loaded: LoadedConfig,
  def: ReportDef,
  o: CountryBuildOptions = {},
): Promise<BuildResult & { problems?: string[] }> {
  const now = o.now ?? new Date();
  o.onBuild?.();
  const partial = typeof o.partial === "function" ? o.partial() : (o.partial ?? null);
  const built = storesReportOf(loaded, def.scope, {
    now,
    ...(o.ctx ? { ctx: o.ctx } : {}),
    partial,
  });
  const { report, plan } = built;
  const records = { records: built.records };
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const versionId = newRunId(def.id, now);
  if (s.exists(versionFileKey(paths, versionId, "report.md")))
    return { ok: false, status: 409, problem: "A version was just built. Try again in a moment." };
  s.putJsonOnce(versionFileKey(paths, versionId, "stores-report.json"), report);
  s.putText(versionFileKey(paths, versionId, "report.md"), storesMarkdown(report));
  const v: VersionInputs = {
    reportId: def.id,
    type: def.type,
    generatedAt: now.toISOString(),
    createdAt: now.toISOString(),
    mainMarket: mainMarketRef(loaded),
    scope: def.scope,
    pick: plan.games.map((g) => ({ appId: g.appId, name: g.name, positions: [] })),
    orderDates: Object.fromEntries(
      plan.decks.map((d) => [`${d.appId}@${d.gl}${d.platform ? "@appstore" : ""}`, d.orderDate]),
    ),
    records: plan.items.map((i) => ({
      appId: i.appId,
      gl: i.gl,
      position: i.position,
      imageId: i.imageId,
      updatedAt: isUsable(records.records.get(i.imageId))
        ? (records.records.get(i.imageId)?.updatedAt ?? null)
        : null,
    })),
    versions: {
      prompts: PROMPT_VERSIONS,
      schema: SCHEMA_VERSION,
      taxonomy: loadTaxonomy(loaded).hash,
      fit: PATTERN_FIT_VERSION,
    },
    planHash: o.planHash ?? null,
    dataHash: stableHash(report.pairs.map((r) => [r.appId, r.gl, r.rows])),
    aiRunId: o.aiRunId ?? null,
    base: eligibility(loaded).base,
  };
  writeVersionInputs(s, paths, versionId, v);
  const next = addVersion(s, paths, def.id, { id: versionId, generatedAt: v.generatedAt });
  return { ok: true, versionId, def: next };
}
