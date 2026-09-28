import { z } from "zod";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { fitFor } from "../core/selection.ts";
import { buildReportVersion } from "../reports/build.ts";
import { eligibility, eligibilityProblem, scopeIncomplete } from "../reports/eligibility.ts";
import { mainMarketRef } from "../reports/main-market.ts";
import { matchCheck, savePairVerdict } from "../reports/match-check.ts";
import { suggestName } from "../reports/names.ts";
import { buildScopePlan, chartGames, projectMarkets } from "../reports/scope-plan.ts";
import { createReport, listDefs, readDef, saveDef } from "../reports/store.ts";
import { researchSnapshot } from "../reports/suggest.ts";
import { isPreset, type ReportScope } from "../reports/types.ts";
import { workspaceStorage } from "../storage/index.ts";
import { readDeck } from "../store/manifest.ts";
import type { ApiResponse } from "./api.ts";

/** The report builder (plan-reports 1.2, milestone R3): options, drafts, plans, instant builds. */

const RELOAD = "The page sent a choice the tool does not know. Reload the page.";
const bad = (problem = RELOAD): ApiResponse => ({ status: 400, body: { problems: [problem] } });
const AppId = z.string().min(1).max(200);

export const ScopeBody = z.strictObject({
  type: z.enum(["pilot", "core", "country", "compare"]),
  markets: z
    .array(z.strictObject({ gl: z.string().regex(/^[a-z]{2}$/), hl: z.string().max(20) }))
    .max(40),
  competitors: z.array(AppId).max(60),
  includeCharts: z.array(AppId).max(30).default([]),
  leftOut: z
    .array(z.strictObject({ appId: AppId, gl: z.string().regex(/^[a-z]{2}$/) }))
    .max(400)
    .optional(),
});

/**
 * A scope from the page, checked against the project's own countries, competitors and chart
 * games (never trusted as given). Pilot and Full check are presets: their scope comes from the pick.
 */
export function resolveScope(
  loaded: LoadedConfig,
  raw: unknown,
  o: { partial?: boolean } = {},
): ReportScope | string {
  const p = ScopeBody.safeParse(raw);
  if (!p.success) return RELOAD;
  const b = p.data;
  const main = mainMarketRef(loaded);
  if (b.type === "pilot" || b.type === "core")
    return { type: b.type, markets: [main], competitors: [], includeCharts: [] };
  const all = projectMarkets(loaded);
  const markets = b.markets.map((m) => all.find((x) => x.gl === m.gl && x.hl === m.hl));
  const named = new Set(loaded.config.competitors.map((c) => c.id));
  const charts = new Set(chartGames(loaded).map((c) => c.appId));
  const dup = (xs: string[]) => new Set(xs).size !== xs.length;
  if (markets.some((m) => !m) || dup(b.markets.map((m) => m.gl))) return RELOAD;
  if (b.competitors.some((a) => !named.has(a)) || dup(b.competitors)) return RELOAD;
  if (b.includeCharts.some((a) => !charts.has(a)) || dup(b.includeCharts)) return RELOAD;
  if (b.type === "country" && markets.length > 1)
    return "Pick one country for a One country report.";
  const incomplete = scopeIncomplete({ type: b.type, markets });
  if (incomplete && !o.partial) return incomplete;
  // Left out to stay within the limit: only picked games (never ours) in picked countries, once.
  const games = new Set([...b.competitors, ...b.includeCharts]);
  const gls = new Set(markets.map((m) => m?.gl));
  const out = (b.leftOut ?? []).map((x) => `${x.appId}|${x.gl}`);
  if (dup(out) || (b.leftOut ?? []).some((x) => !games.has(x.appId) || !gls.has(x.gl)))
    return RELOAD;
  return {
    type: b.type,
    markets: markets.filter((m) => m !== undefined),
    competitors: b.competitors,
    includeCharts: b.includeCharts,
    ...(b.leftOut?.length ? { leftOut: b.leftOut } : {}),
  };
}

/** What the builder offers: types (greyed with the reason), countries, games and availability. */
export function getBuilder(loaded: LoadedConfig): ApiResponse {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const e = eligibility(loaded);
  const markets = projectMarkets(loaded);
  const pick = fitFor(loaded).fit.selected.map((c) => c.appId);
  const sold = (appId: string) =>
    Object.fromEntries(
      markets.map((m) => {
        const d = readDeck(paths.decks, { appId, gl: m.gl, hl: m.hl });
        return [
          m.gl,
          d?.status === "ok" ? "ok" : d?.status === "unavailable" ? "not-sold" : "none",
        ];
      }),
    );
  const defs = listDefs(workspaceStorage(paths.workspace), paths);
  const main = mainMarketRef(loaded);
  const preset = (t: "pilot" | "core") =>
    defs.find((d) => d.type === t && d.scope.markets[0]?.gl === main.gl)?.id ?? null;
  return {
    status: 200,
    body: {
      types: e.types,
      warning: e.warning,
      coreReady: e.coreReady,
      main,
      markets,
      pick,
      presets: { pilot: preset("pilot"), core: preset("core") },
      ours: { appId: config.ourApp.id, name: config.ourApp.name },
      competitors: [...config.competitors]
        .sort((a, b) => {
          const ia = pick.indexOf(a.id);
          const ib = pick.indexOf(b.id);
          return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
        })
        .map((c) => ({ appId: c.id, name: c.name, inPick: pick.includes(c.id), sold: sold(c.id) })),
      charts: chartGames(loaded).map((c) => ({ ...c, sold: sold(c.appId) })),
    },
  };
}

/** The numbers of a scope (code only): what it needs, the cost, and the suggested name. */
export function planFor(loaded: LoadedConfig, scope: ReportScope): ApiResponse {
  const plan = buildScopePlan(loaded, scope);
  return {
    status: 200,
    body: { plan, suggestedName: suggestName(scope, mainMarketRef(loaded)) },
  };
}

export function postPlan(loaded: LoadedConfig, raw: unknown): ApiResponse {
  const scope = resolveScope(loaded, (raw as { scope?: unknown } | null)?.scope);
  if (typeof scope === "string") return bad(scope);
  const refused = eligibilityProblem(eligibility(loaded), scope.type);
  if (refused) return { status: 409, body: { problems: [refused] } };
  return planFor(loaded, scope);
}

const DraftBody = z.strictObject({ scope: z.unknown(), name: z.string().max(120).optional() });

/** A new draft report (autosaved as soon as the user ticks something in the builder). */
export function postDraft(loaded: LoadedConfig, raw: unknown): ApiResponse {
  const b = DraftBody.safeParse(raw);
  if (!b.success) return bad();
  const scope = resolveScope(loaded, b.data.scope, { partial: true });
  if (typeof scope === "string") return bad(scope);
  if (isPreset(scope.type))
    return bad("The Pilot and the Full check are in the list already: build them from there.");
  const refused = eligibilityProblem(eligibility(loaded), scope.type);
  if (refused) return { status: 409, body: { problems: [refused] } };
  const paths = projectPaths(loaded);
  const name = b.data.name?.trim() || suggestName(scope, mainMarketRef(loaded));
  const def = createReport(workspaceStorage(paths.workspace), paths, {
    name,
    type: scope.type,
    scope,
  });
  return { status: 201, body: { id: def.id, name: def.name } };
}

/** Saves a new scope for a report of the builder (its next version uses it). */
export function saveScope(loaded: LoadedConfig, id: string, raw: unknown): ApiResponse | null {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const def = readDef(s, paths, id);
  if (!def) return null;
  const scope = resolveScope(loaded, raw, { partial: true });
  if (typeof scope === "string") return bad(scope);
  if (isPreset(def.type) || scope.type !== def.type)
    return bad("The kind of a saved report cannot change. Start a new report instead.");
  const refused = eligibilityProblem(eligibility(loaded), scope.type);
  if (refused) return { status: 409, body: { problems: [refused] } };
  saveDef(s, paths, { ...def, scope });
  return { status: 200, body: { id: def.id, scope } };
}

export function getReportPlan(loaded: LoadedConfig, id: string): ApiResponse | null {
  const paths = projectPaths(loaded);
  const def = readDef(workspaceStorage(paths.workspace), paths, id);
  if (!def) return null;
  const about = { id: def.id, name: def.name, type: def.type, scope: def.scope };
  // A draft saved before its countries were picked has no numbers yet.
  const incomplete = scopeIncomplete(def.scope);
  if (incomplete) return { status: 200, body: { ...about, plan: null, problem: incomplete } };
  const r = planFor(loaded, def.scope);
  return { ...r, body: { ...(r.body as object), ...about } };
}

/** "Build report": a new version at once when nothing needs AI; otherwise a refusal with why. */
export function postBuild(loaded: LoadedConfig, id: string): ApiResponse | null {
  const paths = projectPaths(loaded);
  const def = readDef(workspaceStorage(paths.workspace), paths, id);
  if (!def) return null;
  const r = buildReportVersion(loaded, def, { research: () => researchSnapshot(loaded) });
  if (!r.ok) return { status: r.status, body: { problems: [r.problem] } };
  return { status: 200, body: { id: def.id, versionId: r.versionId, name: r.def.name } };
}

export function getMatchCheck(loaded: LoadedConfig): ApiResponse {
  return { status: 200, body: matchCheck(loaded) };
}

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const VerdictBody = z.strictObject({ image: Hash, anchor: Hash, same: z.boolean() });

/** The user's answer for one doubtful pair: the same screen, or different screens. */
export function postMatchVerdict(loaded: LoadedConfig, raw: unknown): ApiResponse {
  const b = VerdictBody.safeParse(raw);
  if (!b.success) return bad();
  const known = matchCheck(loaded, 10_000).doubtful.some(
    (p) => p.image.id === b.data.image && p.anchor.id === b.data.anchor,
  );
  if (!known) return bad();
  savePairVerdict(loaded, b.data.image, b.data.anchor, b.data.same);
  return { status: 200, body: { saved: true } };
}
