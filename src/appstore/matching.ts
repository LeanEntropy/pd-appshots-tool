import { type ProjectContext, projectKey, type Storage } from "../storage/index.ts";
import { type AppleApp, lookupBundleIds, type Storefront, searchApps } from "./api.ts";
import type { AppStoreProject, Match } from "./data.ts";
import { appleLangFor } from "./lang.ts";
import {
  fetchFailed,
  matchByBundle,
  matchBySearch,
  normaliseName,
  notSoldHere,
  type PlayGame,
} from "./match.ts";
import type { AppleQueue } from "./queue.ts";

export interface MatchMarket {
  gl: string;
  hl: string;
}

/** The Play developer name from the project's cached store reads (US first), else "". */
export function playDeveloper(
  storage: Storage,
  ctx: ProjectContext,
  appId: string,
  markets: readonly MatchMarket[],
): string {
  for (const m of markets) {
    const raw = storage.getJson(
      projectKey(ctx, "cache", "play", "listing", appId, `${m.gl}-${m.hl}.json`),
    ) as { developer?: unknown } | undefined;
    if (typeof raw?.developer === "string" && raw.developer) return raw.developer;
  }
  return "";
}

const decidedByUser = (m: Match | undefined) => m?.source === "user";

/**
 * Matches every game in every storefront (plan-app-store 1.3), few requests: one bundle-id
 * lookup per country for all games; a game found by its bundle id somewhere is "not sold" in the
 * countries where that lookup is empty; only games never found by bundle id are searched by
 * name, and those results always wait for the user. The user's own answers are never touched.
 */
export async function runMatching(
  queue: AppleQueue,
  games: readonly PlayGame[],
  markets: readonly MatchMarket[],
  prev: AppStoreProject,
  log: (s: string) => void,
): Promise<AppStoreProject["games"]> {
  const now = new Date().toISOString();
  const out: AppStoreProject["games"] = structuredClone(prev.games);
  const set = (appId: string, gl: string, m: Match) => {
    const g = out[appId] ?? { byCountry: {} };
    g.byCountry[gl] = m;
    out[appId] = g;
  };
  const open = (appId: string, gl: string) => !decidedByUser(out[appId]?.byCountry[gl]);
  const sf = (m: MatchMarket): Storefront => ({ gl: m.gl, lang: appleLangFor(m.gl, m.hl) });

  const byBundle = new Map<string, Map<string, Match | null>>();
  for (const m of markets) {
    const todo = games.filter((g) => open(g.appId, m.gl));
    let found: AppleApp[] | null = null;
    let error = "";
    try {
      found = await lookupBundleIds(
        queue,
        sf(m),
        todo.map((g) => g.appId),
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      log(`  ${m.gl.toUpperCase()}: the bundle-id lookup failed (${error})`);
    }
    for (const g of todo) {
      const r = found ? matchByBundle(g, found, now) : fetchFailed(now, error);
      const per = byBundle.get(g.appId) ?? new Map<string, Match | null>();
      per.set(m.gl, r);
      byBundle.set(g.appId, per);
    }
  }

  for (const g of games) {
    const per = byBundle.get(g.appId) ?? new Map<string, Match | null>();
    const hitIn = markets.find((m) => per.get(m.gl)?.candidates.length);
    for (const m of markets) {
      if (!open(g.appId, m.gl)) continue;
      const r = per.get(m.gl);
      if (r) {
        set(g.appId, m.gl, r);
        continue;
      }
      if (hitIn) {
        set(g.appId, m.gl, notSoldHere(now, hitIn.gl.toUpperCase()));
        continue;
      }
      try {
        const found = await searchApps(queue, { gl: m.gl, lang: "en_us" }, normaliseName(g.name));
        set(g.appId, m.gl, matchBySearch(g, found, now));
      } catch (e) {
        set(g.appId, m.gl, fetchFailed(now, e instanceof Error ? e.message : String(e)));
      }
    }
  }
  return out;
}
