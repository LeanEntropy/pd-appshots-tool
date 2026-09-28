import { type LoadedConfig, projectPaths } from "../config/load.ts";
import type { Config } from "../config/schema.ts";
import { summarize } from "../core/summary.ts";
import { buildTargets, coreMarket, type DeckTarget, deckKey } from "../core/targets.ts";
import { appSegment } from "../play/answers.ts";
import type { Listing } from "../play/client.ts";
import { googleImageId } from "../play/screenshots.ts";
import { type ProjectContext, projectKey, workspaceStorage } from "../storage/index.ts";
import { openImageDb } from "../store/imagedb.ts";
import { stableHash } from "../util/hash.ts";
import { latestRun } from "../view/model.ts";
import { type DownloadResult, runDownload } from "./download.ts";
import {
  computePlanHash,
  type DownloadPlan,
  measureBytes,
  newClient,
  planProblem,
} from "./preview.ts";
import { saveListingTexts } from "./store-text.ts";

/**
 * Adding one competitor to a project that is downloaded already (plan 1.4 and 6.3): read only
 * that game's store pages, show what is new, and download only that, through the existing
 * preview and download code. Images already in the shared library are not downloaded again.
 */

/** Tests: store pages and image bytes without the network. */
export interface StoreDeps {
  listing?: (appId: string, gl: string, hl: string) => Promise<Listing>;
  fetchImage?: (url: string) => Promise<Buffer>;
  /** false: use the configured size per image instead of sampling Google's image server. */
  measure?: boolean;
}

export const gamePlanKey = (ctx: ProjectContext, appId: string) =>
  projectKey(ctx, "pending", "add-competitor", `${appSegment(appId)}.json`);

/** What a game's download depends on: the game, its closeness, the countries. */
export function gameHash(config: Config, appId: string): string {
  const c = config.competitors.find((x) => x.id === appId);
  return stableHash({
    competitor: c ?? null,
    markets: config.markets,
    scope: config.download.namedCompetitorMarkets,
  });
}

/** The game's store pages, one per country, with its chart positions from the last download. */
export function gameTargets(loaded: LoadedConfig, appId: string): DeckTarget[] {
  const run = latestRun(projectPaths(loaded).runs);
  const ranks = run?.decks.find((d) => d.appId === appId && Object.keys(d.chartRanks).length);
  return buildTargets(loaded.config, [])
    .filter((t) => t.appId === appId && t.group === "named")
    .map((t) => ({ ...t, chartRanks: { ...(ranks?.chartRanks ?? {}) } }));
}

/** Reads the game's store pages (no images) and saves the preview for the approval screen. */
export async function checkGame(
  loaded: LoadedConfig,
  appId: string,
  progress: (done: number, total: number, message: string) => void,
  deps: StoreDeps = {},
): Promise<DownloadPlan> {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const targets = gameTargets(loaded, appId);
  if (!targets.length) throw new Error("This game is not one of the project's competitors.");
  const name = targets[0]?.name ?? appId;
  const client = newClient(loaded, paths);
  const read = deps.listing ?? ((a: string, gl: string, hl: string) => client.listing(a, gl, hl));
  const listings: Record<string, Listing> = {};
  let done = 0;
  const message = `Checking the store pages of ${name}`;
  progress(0, targets.length, message);
  for (const t of targets) {
    listings[deckKey(t)] = await read(t.appId, t.gl, t.hl);
    progress(++done, targets.length, message);
  }
  saveListingTexts(workspaceStorage(paths.workspace), Object.values(listings), () => {});
  const fallback = config.download.estimatedBytesPerImage;
  const measured =
    deps.measure === false
      ? { bytes: fallback, source: "config" as const }
      : await measureBytes(Object.values(listings), fallback);
  const configHash = gameHash(config, appId);
  const label = (gl: string) => config.markets.find((m) => m.gl === gl)?.label ?? gl;
  const plan: DownloadPlan = {
    createdAt: new Date().toISOString(),
    configHash,
    planHash: computePlanHash(configHash, targets, listings),
    category: config.category,
    bytesPerImage: measured.bytes,
    bytesSource: measured.source,
    targets,
    listings,
    charts: [],
    summary: summarize(targets, new Map(Object.entries(listings)), [], measured.bytes),
    incomplete: targets
      .filter((t) => listings[deckKey(t)]?.status === "error")
      .map((t) => `The store page of ${name} in ${label(t.gl)} could not be read.`),
  };
  workspaceStorage(paths.workspace).putJson(gamePlanKey(paths, appId), plan);
  return plan;
}

export function readGamePlan(loaded: LoadedConfig, appId: string): DownloadPlan | undefined {
  const paths = projectPaths(loaded);
  return workspaceStorage(paths.workspace).getJson(gamePlanKey(paths, appId)) as
    | DownloadPlan
    | undefined;
}

/** Plain reason why a saved game preview cannot be approved any more, or null. */
export function gamePlanProblem(loaded: LoadedConfig, plan: DownloadPlan, appId: string) {
  if (!loaded.config.competitors.some((c) => c.id === appId))
    return "This game is not in the project any more.";
  const p = planProblem(
    plan,
    gameHash(loaded.config, appId),
    loaded.config.download.metadataCacheHours,
  );
  if (!p) return null;
  return p.startsWith("The config changed")
    ? "The game or the project's countries changed since the store check. Check the store again."
    : `${p} Check the store again.`;
}

export interface GamePreview {
  appId: string;
  name: string;
  planHash: string;
  createdAt: string;
  countries: { gl: string; label: string; status: Listing["status"]; images: number }[];
  /** Different images across all countries (the same picture in two countries counts once). */
  images: number;
  /** Already in the shared image library (or this project): not downloaded again. */
  inLibrary: number;
  toDownload: number;
  bytes: number;
  bytesSource: "measured" | "config";
  aiCalls: 0;
  /** Not on Google Play in the core country: left out of the core check. */
  notInCore: string | null;
  incomplete: string[];
  problem: string | null;
}

/** The approval numbers of a saved game preview (no network). */
export function gamePreview(loaded: LoadedConfig, plan: DownloadPlan, appId: string): GamePreview {
  const { config } = loaded;
  const db = openImageDb(projectPaths(loaded));
  const ids = new Set<string>();
  const countries = plan.targets.map((t) => {
    const l = plan.listings[deckKey(t)];
    for (const s of l?.status === "ok" ? l.screenshots : []) ids.add(googleImageId(s));
    const label = config.markets.find((m) => m.gl === t.gl)?.label ?? t.gl.toUpperCase();
    const images = l?.status === "ok" ? l.screenshots.length : 0;
    return { gl: t.gl, label, status: l?.status ?? ("error" as const), images };
  });
  const inLibrary = [...ids].filter((g) => db.byGoogleId(g)).length;
  const core = coreMarket(config);
  const name = config.competitors.find((c) => c.id === appId)?.name ?? appId;
  const coreRow = countries.find((c) => c.gl === core.gl);
  return {
    appId,
    name,
    planHash: plan.planHash,
    createdAt: plan.createdAt,
    countries,
    images: ids.size,
    inLibrary,
    toDownload: ids.size - inLibrary,
    // Original plus its small preview copy, as in the project's download preview.
    bytes: (ids.size - inLibrary) * (plan.bytesPerImage + 20_000),
    bytesSource: plan.bytesSource,
    aiCalls: 0,
    notInCore:
      coreRow?.status === "unavailable"
        ? `${name} is not on Google Play in ${core.label}, so it cannot be in the core check. It is downloaded in the countries where it exists.`
        : null,
    incomplete: plan.incomplete,
    problem: gamePlanProblem(loaded, plan, appId),
  };
}

/**
 * Downloads an approved game preview. The new run keeps every deck of the latest download, so
 * the workspace shows the new game next to all the others.
 */
export async function downloadGame(
  loaded: LoadedConfig,
  plan: DownloadPlan,
  onImage: (done: number, total: number) => void,
  deps: StoreDeps = {},
): Promise<DownloadResult> {
  const mergeWith = latestRun(projectPaths(loaded).runs);
  if (!mergeWith) throw new Error("Download the project first, then add competitors.");
  return runDownload(loaded, plan, () => {}, {
    onImage,
    mergeWith,
    ...(deps.fetchImage ? { fetchImage: deps.fetchImage } : {}),
  });
}
