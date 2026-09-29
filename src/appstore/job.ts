import { coreOrder, projectPaths } from "../config/load.ts";
import { loadProject } from "../config/project.ts";
import { type ProjectContext, projectKey, workspaceStorage } from "../storage/index.ts";
import { acquireAll, LOCKS, lockHolder } from "../storage/leases.ts";
import { type AppStoreProject, appStoreLock, readAppStore, writeAppStore } from "./data.ts";
import { type CountryTally, type FetchPair, runFetch } from "./fetch-run.ts";
import { AppleImages } from "./ingest.ts";
import type { PlayGame } from "./match.ts";
import { playDeveloper, runMatching } from "./matching.ts";
import { AppleQueue, type Clock, type Fetcher, realClock } from "./queue.ts";

export interface AppStoreJobOptions {
  root: string;
  projectId: string;
  /** Turn the project's App Store switch on first (the user's explicit opt-in). */
  enable?: boolean;
  /** Match only; fetch nothing. */
  matchOnly?: boolean;
  log: (s: string) => void;
  fetcher?: Fetcher;
  clock?: Clock;
  /** API pace; the Search API allows about 20 calls a minute. */
  apiIntervalMs?: number;
  imageIntervalMs?: number;
}

export interface AppStoreJobResult {
  matches: {
    auto: string[];
    /** Confirmed by the user earlier (fetched like the automatic ones). */
    confirmed: string[];
    confirm: string[];
    notFound: string[];
    failed: string[];
  };
  countries: CountryTally[];
  seconds: number;
  apiRequests: number;
  throttled: number;
}

/** The games in scope: our game, then the project's picked core competitors (in pick order). */
export function scopeGames(
  root: string,
  projectId: string,
): { games: PlayGame[]; markets: { gl: string; hl: string }[] } {
  const loaded = loadProject(projectId, { root });
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const ctx: ProjectContext = { projectId };
  const { config } = loaded;
  const markets = config.markets.map((m) => ({ gl: m.gl, hl: m.hl }));
  // The United States first, then the project's order.
  markets.sort((a, b) => Number(b.gl === "us") - Number(a.gl === "us"));
  const names = new Map(config.competitors.map((c) => [c.id, c.name]));
  const ids = [config.ourApp.id, ...coreOrder(loaded, paths).filter((id) => names.has(id))];
  const games = ids.map((appId) => ({
    appId,
    name: appId === config.ourApp.id ? config.ourApp.name : (names.get(appId) ?? appId),
    developer: playDeveloper(storage, ctx, appId, markets),
  }));
  return { games, markets };
}

const who = (g: PlayGame, gl: string) => `${g.name} ${gl.toUpperCase()}`;

/** Every (game, country) by its match status, for the run summary. */
export function summarise(
  store: AppStoreProject,
  games: readonly PlayGame[],
  markets: readonly { gl: string }[],
): AppStoreJobResult["matches"] {
  const res: AppStoreJobResult["matches"] = {
    auto: [],
    confirmed: [],
    confirm: [],
    notFound: [],
    failed: [],
  };
  for (const m of markets)
    for (const g of games) {
      const x = store.games[g.appId]?.byCountry[m.gl];
      if (x?.status === "matched") (x.auto ? res.auto : res.confirmed).push(who(g, m.gl));
      else if (x?.status === "needs_confirmation") res.confirm.push(who(g, m.gl));
      else if (x?.status === "fetch_failed") res.failed.push(who(g, m.gl));
      else res.notFound.push(who(g, m.gl));
    }
  return res;
}

/**
 * The App Store run as one job (free, no AI): takes the store lock for the project (so no other
 * store job runs and this project cannot start an analysis meanwhile), matches every game in
 * every country, saves the matches, then fetches the automatically matched or confirmed pairs.
 */
export async function runAppStoreJob(o: AppStoreJobOptions): Promise<AppStoreJobResult> {
  const started = Date.now();
  const { games, markets } = scopeGames(o.root, o.projectId);
  const loaded = loadProject(o.projectId, { root: o.root });
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const ctx: ProjectContext = { projectId: o.projectId };
  // The store lock first, then the analysis check (an analysis takes its lock, then checks
  // the store lock), so the two can never both start. The project's App Store lock keeps the
  // page's confirmations and switch from writing while this job reads and writes the same file.
  const held = acquireAll(storage, [LOCKS.store, appStoreLock(ctx)], {
    projectId: o.projectId,
    kind: "appstore",
  });
  if ("heldBy" in held)
    throw new Error(
      "Another store job is running (Google Play or App Store), or the App Store settings of this project are being saved. Try again when it ends.",
    );
  try {
    if (lockHolder(storage, LOCKS.ai)?.projectId === o.projectId)
      throw new Error("This project is analysing images now. Run this when the analysis ends.");
    const fetcher = o.fetcher ?? ((u: string) => fetch(u));
    const clock = o.clock ?? realClock;
    const api = new AppleQueue(fetcher, { minIntervalMs: o.apiIntervalMs ?? 4000 }, clock);
    const img = new AppleQueue(
      fetcher,
      { minIntervalMs: o.imageIntervalMs ?? 300, backoffMs: 10_000 },
      clock,
    );
    let store: AppStoreProject = readAppStore(storage, ctx);
    if (o.enable && !store.enabled) store = { ...store, enabled: true };
    if (!store.enabled)
      throw new Error(
        "The App Store is off for this project. Turn it on in Settings (or pass --enable).",
      );
    o.log(`Matching ${games.length} games in ${markets.length} countries (Lookup API, free)...`);
    store.games = await runMatching(api, games, markets, store, o.log);
    // The pair list: every game in every project country (the user asked for this scope).
    const pairs = new Map(store.pairs.map((p) => [`${p.game}|${p.gl}`, p]));
    for (const g of games)
      for (const m of markets) pairs.set(`${g.appId}|${m.gl}`, { game: g.appId, gl: m.gl });
    store.pairs = [...pairs.values()];
    held.check();
    writeAppStore(storage, ctx, store);

    const todo: FetchPair[] = [];
    for (const m of markets)
      for (const g of games)
        if (store.games[g.appId]?.byCountry[m.gl]?.status === "matched")
          todo.push({ appId: g.appId, name: g.name, gl: m.gl, hl: m.hl });
    let countries: CountryTally[] = [];
    if (!o.matchOnly) {
      o.log(`Fetching ${todo.length} App Store decks, one country at a time...`);
      const images = new AppleImages(
        paths.workspace,
        storage,
        ctx,
        (u) => img.bytes(u),
        held.check,
      );
      countries = await runFetch(
        { storage, ctx, api, images, log: o.log, check: held.check },
        todo,
        store,
      );
      held.check();
      // The identity check may have sent matches back to the user.
      writeAppStore(storage, ctx, store);
    }
    const result: AppStoreJobResult = {
      // After the fetch: the identity check may have sent matches back to the user.
      matches: summarise(store, games, markets),
      countries,
      seconds: Math.round((Date.now() - started) / 1000),
      apiRequests: api.sent,
      throttled: api.throttled + img.throttled,
    };
    held.check();
    storage.putJson(
      projectKey(ctx, "appstore-runs", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`),
      result,
    );
    return result;
  } finally {
    held.release();
  }
}
