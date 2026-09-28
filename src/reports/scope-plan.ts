import { latestOrderDate } from "../analysis/orders.ts";
import { buildAnalysisPlan } from "../analysis/plan.ts";
import { type AnalysisRecord, isUsable, readRecords } from "../analysis/records.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import type { Market } from "../config/schema.ts";
import { analysedSlots } from "../core/selection.ts";
import { settingsOf } from "../settings/access.ts";
import { type ImageDb, openImageDb } from "../store/imagedb.ts";
import { readDeck } from "../store/manifest.ts";
import { stableHash } from "../util/hash.ts";
import { latestRun } from "../view/model.ts";
import { type AnchorCandidate, type ScopeInput, type ScopeItem, tierScope } from "./anchors.ts";
import { readDifferentPairs } from "./match-check.ts";
import { theCountry } from "./names.ts";
import { type CostParts, costOf, dropProposal, presetCost } from "./scope-cost.ts";
import type { MarketRef, ReportScope } from "./types.ts";

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
}

const ref = (m: Market): MarketRef => ({ gl: m.gl, hl: m.hl, label: m.label });

/** The project's countries, the main country first, then the project's order. */
export function projectMarkets(loaded: LoadedConfig): MarketRef[] {
  const main = settingsOf(loaded.config).mainMarket;
  const all = loaded.config.markets.map(ref);
  return [ref(main), ...all.filter((m) => !(m.gl === main.gl && m.hl === main.hl))];
}

/** Chart games of the latest download (never analysed unless the user ticks them). */
export function chartGames(loaded: LoadedConfig): { appId: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const d of latestRun(projectPaths(loaded).runs)?.decks ?? [])
    if (d.group === "chart" && !seen.has(d.appId)) seen.set(d.appId, d.title ?? d.name);
  return [...seen].map(([appId, name]) => ({ appId, name }));
}

/**
 * What every plan of one request reads from disk (the image database, the analyses, the pairs
 * marked different, the game names): read once and shared, so the suggestions can price many
 * scopes in one go.
 */
export interface PlanContext {
  db: ImageDb;
  records: Map<string, AnalysisRecord>;
  different: Set<string>;
  names: Map<string, string>;
}

export function planContext(loaded: LoadedConfig): PlanContext {
  const paths = projectPaths(loaded);
  return {
    db: openImageDb(paths),
    records: readRecords(paths),
    different: readDifferentPairs(loaded),
    names: gameNames(loaded),
  };
}

/** Plain name of a game of the project (ours, a named competitor or a chart game). */
export function gameNames(loaded: LoadedConfig): Map<string, string> {
  const { config } = loaded;
  return new Map([
    ...chartGames(loaded).map((g) => [g.appId, g.name] as const),
    ...config.competitors.map((c) => [c.id, c.name] as const),
    [config.ourApp.id, config.ourApp.name],
  ]);
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
  o: { proposeDrop?: boolean; ctx?: PlanContext } = {},
): ScopePlan {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const ctx = o.ctx ?? planContext(loaded);
  const { db, records, names } = ctx;
  const main = ref(settingsOf(config).mainMarket);
  const thumb = (id: string) => db.get(id)?.thumb ?? null;
  if (scope.type === "pilot" || scope.type === "core") {
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
    inputs,
    mainCands,
    abroad,
    analysedIds,
    theCountry(main.label),
    ctx.different,
  );
  const items: PlanImage[] = tiered.map((t) => ({
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
  };
  const plan: ScopePlan = { ...body, planHash: stableHash(body) };
  if (o.proposeDrop !== false && plan.overLimit)
    plan.drop = dropProposal(plan, scope, (s) =>
      buildScopePlan(loaded, s, { proposeDrop: false, ctx }),
    );
  return plan;
}
