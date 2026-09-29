import { withRepeatOf } from "../analysis/deck-repeats.ts";
import { latestOrderDate } from "../analysis/orders.ts";
import { buildAnalysisPlan } from "../analysis/plan.ts";
import { isUsable } from "../analysis/records.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import type { Market } from "../config/schema.ts";
import { analysedSlots } from "../core/selection.ts";
import { settingsOf } from "../settings/access.ts";
import { readDeck } from "../store/manifest.ts";
import { stableHash } from "../util/hash.ts";
import { type AnchorCandidate, type ScopeInput, type ScopeItem, tierScope } from "./anchors.ts";
import { appleScope, storeCounts } from "./apple-scope.ts";
import { withLayerResults } from "./layer-lookup.ts";
import { readSamePairs } from "./match-check.ts";
import { theCountry } from "./names.ts";
import { forStore, type PlanContext } from "./plan-context.ts";
import { type CostParts, costOf, dropProposal, presetCost } from "./scope-cost.ts";
import { buildStoresPlan } from "./stores-plan.ts";
import { isPresetScope, type MarketRef, platformOfScope, type ReportScope } from "./types.ts";

export {
  chartGames,
  gameNames,
  type PlanContext,
  planContext,
} from "./plan-context.ts";

/** One game's deck in one country of a report, as the builder shows it. */
export interface ScopeDeck {
  appId: string;
  name: string;
  gl: string;
  hl: string;
  country: string;
  /** ok; not sold here (no store page); not downloaded; left out to stay within the limit. */
  state: "ok" | "not-sold" | "not-downloaded" | "left-out";
  positions: number[];
  /** The store-order snapshot date (YYYY-MM-DD), null when none was saved. */
  orderDate: string | null;
  /** An App Store deck (missing: Google Play). */
  platform?: "appstore";
}

export interface PlanImage extends ScopeItem {
  name: string;
  thumb: string | null;
}

export interface ScopePlan extends CostParts {
  type: ReportScope["type"];
  main: MarketRef;
  markets: MarketRef[];
  games: { appId: string; name: string; ours: boolean; chart: boolean }[];
  decks: ScopeDeck[];
  items: PlanImage[];
  counts: { identical: number; layerDiff: number; full: number; newImages: number };
  /** Pilot and Full check: the core cap (100 hard stop). */
  cap: { cap: number; coreTotal: number; withinCap: boolean } | null;
  /** Nothing new to analyse: the report is built at once, for free. */
  instant: boolean;
  planHash: string;
  /** Plans with App Store images: the counts per store (the approval's lines). */
  byStore?: ReturnType<typeof storeCounts>;
  /** The store the report reads ("stores": both). */
  platform?: "play" | "appstore" | "both";
}

const ref = (m: Market): MarketRef => ({ gl: m.gl, hl: m.hl, label: m.label });

/** The project's countries, the main country first, then the project's order. */
export function projectMarkets(loaded: LoadedConfig): MarketRef[] {
  const main = settingsOf(loaded.config).mainMarket;
  const all = loaded.config.markets.map(ref);
  return [ref(main), ...all.filter((m) => !(m.gl === main.gl && m.hl === main.hl))];
}

/**
 * What a report needs vs what exists (plan-reports 2.1), code only: every game and country of
 * the scope, each position's cost tier, the anchors, the store dates, the cost and the spending
 * limit. Pilot and Full check delegate to the existing planner, so their numbers and fingerprint
 * are exactly today's.
 */
export function buildScopePlan(
  loaded: LoadedConfig,
  scope: ReportScope,
  o: { proposeDrop?: boolean; ctx?: PlanContext; crossPlanned?: AnchorCandidate[] } = {},
): ScopePlan {
  if (scope.type === "stores") return buildStoresPlan(loaded, scope, o);
  // The report's store: an App Store report reads the App Store decks (plan-app-store 7.1).
  const store = forStore(loaded, platformOfScope(scope), o.ctx);
  if (store.loaded !== loaded || store.ctx !== o.ctx)
    return buildScopePlan(store.loaded, scope, { ...o, ctx: store.ctx });
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const ctx = store.ctx;
  const { db, records, names } = ctx;
  const main = ref(settingsOf(config).mainMarket);
  const thumb = (id: string) => db.get(id)?.thumb ?? null;
  if ((scope.type === "pilot" || scope.type === "core") && isPresetScope(scope)) {
    const p = buildAnalysisPlan(loaded, scope.type);
    const items = p.items.map((i) => ({
      ...i,
      country: main.label,
      main: true,
      width: db.get(i.imageId)?.width ?? 0,
      height: db.get(i.imageId)?.height ?? 0,
      thumb: thumb(i.imageId),
    }));
    return {
      type: scope.type,
      main,
      markets: [main],
      games: p.games.map((g) => ({
        appId: g.appId,
        name: g.name,
        ours: g.appId === config.ourApp.id,
        chart: false,
      })),
      decks: p.games.map((g) => ({
        appId: g.appId,
        name: g.name,
        gl: main.gl,
        hl: main.hl,
        country: main.label,
        state: "ok",
        positions: g.positions,
        orderDate: latestOrderDate(paths, g.appId, main.gl, main.hl),
      })),
      items,
      counts: p.counts,
      cap: { cap: p.cap, coreTotal: p.coreTotal, withinCap: p.withinCap },
      instant: p.counts.newImages === 0,
      planHash: p.planHash,
      ...presetCost(config, p),
    };
  }
  const order = projectMarkets(loaded);
  const markets = order.filter((m) => scope.markets.some((s) => s.gl === m.gl && s.hl === m.hl));
  const games = [
    { appId: config.ourApp.id, ours: true, chart: false },
    ...scope.competitors.map((appId) => ({ appId, ours: false, chart: false })),
    ...scope.includeCharts.map((appId) => ({ appId, ours: false, chart: true })),
  ].map((g) => ({ ...g, name: names.get(g.appId) ?? g.appId }));
  const leftOut = new Set((scope.leftOut ?? []).map((x) => `${x.appId}|${x.gl}`));
  const analysedIds = new Set([...records.values()].filter(isUsable).map((r) => r.imageId));
  const apple = ctx.apple ? appleScope(loaded, ctx, games, records, o.crossPlanned) : null;
  const decks: ScopeDeck[] = [];
  const inputs: ScopeInput[] = [];
  for (const m of markets)
    for (const g of games) {
      const d = readDeck(paths.decks, { appId: g.appId, gl: m.gl, hl: m.hl });
      const base = { appId: g.appId, name: g.name, gl: m.gl, hl: m.hl, country: m.label };
      const orderDate = latestOrderDate(paths, g.appId, m.gl, m.hl);
      if (d?.status !== "ok") {
        const state = d?.status === "unavailable" ? "not-sold" : "not-downloaded";
        decks.push({ ...base, state, positions: [], orderDate });
        continue;
      }
      const slots = analysedSlots(config, d).filter((s) => s.imageId && db.get(s.imageId));
      const out = leftOut.has(`${g.appId}|${m.gl}`) && !g.ours;
      decks.push({
        ...base,
        ...(apple ? { platform: "appstore" as const } : {}),
        state: out ? "left-out" : "ok",
        positions: slots.map((s) => s.position),
        orderDate,
      });
      if (out) continue;
      for (const s of slots) {
        const rec = db.get(s.imageId as string);
        if (!rec) continue;
        inputs.push({
          ...base,
          main: m.gl === main.gl && m.hl === main.hl,
          position: s.position,
          imageId: rec.id,
          phash: rec.phash,
          width: rec.width,
          height: rec.height,
          ...(apple ? apple.input(rec.id) : {}),
        });
      }
    }
  // Anchors: each game's main-country deck and its analysed images, per country.
  const mainCands = new Map<string, AnchorCandidate[]>();
  const abroad = new Map<string, AnchorCandidate[]>();
  for (const g of games) {
    const d = readDeck(paths.decks, { appId: g.appId, gl: main.gl, hl: main.hl });
    const list: AnchorCandidate[] = [];
    for (const s of d?.status === "ok" ? analysedSlots(config, d) : []) {
      const rec = s.imageId ? db.get(s.imageId) : undefined;
      if (rec)
        list.push({
          appId: g.appId,
          gl: main.gl,
          hl: main.hl,
          country: main.label,
          position: s.position,
          imageId: rec.id,
          phash: rec.phash,
          width: rec.width,
          height: rec.height,
          analysed: analysedIds.has(rec.id),
        });
    }
    mainCands.set(g.appId, list);
  }
  const label = (gl: string) => order.find((m) => m.gl === gl)?.label ?? gl.toUpperCase();
  for (const r of records.values()) {
    if (!isUsable(r) || !games.some((g) => g.appId === r.appId)) continue;
    const rec = db.get(r.imageId);
    if (!rec) continue;
    const c: AnchorCandidate = {
      appId: r.appId,
      gl: r.gl,
      hl: r.hl,
      country: label(r.gl),
      position: r.position,
      imageId: r.imageId,
      phash: rec.phash,
      width: rec.width,
      height: rec.height,
      analysed: true,
    };
    const isMain = r.gl === main.gl && r.hl === main.hl;
    const into = isMain ? mainCands : abroad;
    const list = into.get(r.appId) ?? [];
    if (!list.some((x) => x.imageId === c.imageId)) into.set(r.appId, [...list, c]);
  }
  const tiered = tierScope(
    withRepeatOf(inputs, ctx.same ?? (() => 0)),
    mainCands,
    abroad,
    analysedIds,
    theCountry(main.label),
    ctx.different,
    ctx.pixel,
    apple ? { ...apple.cross, same: readSamePairs(loaded) } : undefined,
  );
  const items: PlanImage[] = withLayerResults(tiered, ctx).map((t) => ({
    ...t,
    name: names.get(t.appId) ?? t.appId,
    thumb: thumb(t.imageId),
  }));
  const counts = {
    identical: items.filter((i) => i.tier === "identical").length,
    layerDiff: items.filter((i) => i.tier === "layer-diff").length,
    full: items.filter((i) => i.tier === "full").length,
    newImages: 0,
  };
  counts.newImages = counts.layerDiff + counts.full;
  const cost = costOf(config, markets, main, items);
  const body = {
    type: scope.type,
    main,
    markets,
    games,
    decks,
    items,
    counts,
    cap: null,
    instant: counts.newImages === 0,
    ...cost,
    ...(apple ? { byStore: storeCounts(items), platform: "appstore" as const } : {}),
  };
  const plan: ScopePlan = { ...body, planHash: stableHash(body) };
  if (o.proposeDrop !== false && plan.overLimit)
    plan.drop = dropProposal(plan, scope, (s) =>
      buildScopePlan(loaded, s, { proposeDrop: false, ctx }),
    );
  return plan;
}
