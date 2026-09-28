import { type CountryCatalogue, marketLabel } from "../config/countries.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import type { ProjectSettings } from "../config/project-schema.ts";
import type { Config } from "../config/schema.ts";
import { summarize } from "../core/summary.ts";
import { buildTargets, deckKey, mainMarket } from "../core/targets.ts";
import type { ChartResult, Listing } from "../play/client.ts";
import { googleImageId } from "../play/screenshots.ts";
import { type ProjectContext, projectKey, workspaceStorage } from "../storage/index.ts";
import { openImageDb } from "../store/imagedb.ts";
import { stableHash } from "../util/hash.ts";
import { latestRun } from "../view/model.ts";
import type { StoreDeps } from "./add-competitor.ts";
import {
  computePlanHash,
  type DownloadPlan,
  measureBytes,
  newClient,
  planProblem,
  readPlan,
} from "./preview.ts";
import { saveListingTexts } from "./store-text.ts";

/**
 * Adding countries to a project that is downloaded already (from a multi-country suggestion):
 * the countries are saved to the project's settings in their usual language, then only their
 * store pages are read (free, no images), the approval shows the images and disk space, and
 * only images not in the shared library are downloaded (the add-competitor download code).
 */

export interface CountriesDeps extends StoreDeps {
  chart?: (col: string, cat: string, gl: string, hl: string, depth: number) => Promise<ChartResult>;
}
export type CountriesPlan = DownloadPlan & { gls: string[] };

export const countriesPlanKey = (ctx: ProjectContext) =>
  projectKey(ctx, "pending", "add-countries.json");

export interface AddableCountry {
  gl: string;
  hl: string;
  label: string;
  region: string;
  language: string;
}

/** Google Play countries not in the project yet, each in its usual language (HK: zh-TW, PH: en). */
export function addableCountries(cat: CountryCatalogue, s: ProjectSettings): AddableCountry[] {
  const have = new Set(s.markets.map((m) => m.gl));
  return cat.countries
    .filter((c) => !have.has(c.gl))
    .map((c) => ({
      gl: c.gl,
      hl: c.defaultHl,
      label: c.label,
      region: c.region,
      language: cat.languages[c.defaultHl] ?? c.defaultHl,
    }));
}

/** The settings with the countries added at the end, or a plain problem. */
export function withCountries(
  cat: CountryCatalogue,
  s: ProjectSettings,
  gls: readonly string[],
): { settings: ProjectSettings; added: string[] } | { problem: string } {
  const want = [...new Set(gls)];
  if (!want.length) return { problem: "Tick at least one country to add." };
  const markets = [...s.markets];
  for (const gl of want) {
    const c = cat.countries.find((x) => x.gl === gl);
    if (!c) return { problem: `The country "${gl}" is not on the list. Reload the page.` };
    if (markets.some((m) => m.gl === gl))
      return { problem: `${c.label} is in the project already.` };
    markets.push({ gl, hl: c.defaultHl, label: marketLabel(cat, gl, c.defaultHl) });
  }
  if (markets.length > 40) return { problem: "A project can have at most 40 countries." };
  return { settings: { ...s, markets }, added: want };
}

/** What the download of these countries depends on: the countries, games and chart settings. */
export function countriesHash(config: Config, gls: readonly string[]): string {
  return stableHash({
    gls: [...gls].sort(),
    markets: config.markets,
    competitors: config.competitors.map((c) => c.id),
    charts: config.charts,
    scope: [config.download.ourMarkets, config.download.namedCompetitorMarkets],
  });
}

async function readCharts(
  loaded: LoadedConfig,
  gls: ReadonlySet<string>,
  deps: CountriesDeps,
): Promise<ChartResult[]> {
  const { config } = loaded;
  if (config.charts.enabled === false) return [];
  const paths = projectPaths(loaded);
  const client = newClient(loaded, paths);
  let category = config.category;
  if (category === "auto") category = readPlan(paths)?.category ?? "auto";
  if (category === "auto") {
    const main = mainMarket(config);
    const ours = await client.listing(config.ourApp.id, main.gl, main.hl);
    if (ours.status !== "ok" || !ours.genreId) return [];
    category = ours.genreId;
  }
  const chart =
    deps.chart ?? ((c, cat, gl, hl, n) => client.chart(c, cat, gl, hl, n) as Promise<ChartResult>);
  const out: ChartResult[] = [];
  for (const m of config.markets.filter((x) => gls.has(x.gl)))
    out.push(await chart(config.charts.collection, category, m.gl, m.hl, config.charts.depth));
  return out;
}

/** Reads the new countries' store pages (and charts), no images, and saves the approval plan. */
export async function checkCountries(
  loaded: LoadedConfig,
  gls: readonly string[],
  progress: (done: number, total: number, message: string) => void,
  deps: CountriesDeps = {},
): Promise<CountriesPlan> {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const want = new Set(gls);
  if (![...want].every((gl) => config.markets.some((m) => m.gl === gl)))
    throw new Error("These countries are not in the project. Reload the page.");
  progress(0, 0, "Reading the top charts of the new countries");
  const charts = await readCharts(loaded, want, deps);
  const run = latestRun(paths.runs);
  const known = new Set(run?.decks.map((d) => deckKey(d)) ?? []);
  const targets = buildTargets(config, charts).filter(
    (t) => want.has(t.gl) || (t.group === "chart" && !known.has(deckKey(t))),
  );
  const client = newClient(loaded, paths);
  const read = deps.listing ?? ((a: string, gl: string, hl: string) => client.listing(a, gl, hl));
  const listings: Record<string, Listing> = {};
  const message = "Checking the store pages in the new countries";
  let done = 0;
  progress(0, targets.length, message);
  for (const t of targets) {
    listings[deckKey(t)] = await read(t.appId, t.gl, t.hl);
    progress(++done, targets.length, message);
  }
  saveListingTexts(workspaceStorage(paths.workspace), Object.values(listings), () => {});
  progress(done, targets.length, "Measuring the image sizes");
  const fallback = config.download.estimatedBytesPerImage;
  const measured =
    deps.measure === false
      ? { bytes: fallback, source: "config" as const }
      : await measureBytes(Object.values(listings), fallback);
  const configHash = countriesHash(config, [...want]);
  const label = (gl: string) => config.markets.find((m) => m.gl === gl)?.label ?? gl;
  const plan: CountriesPlan = {
    gls: [...want],
    createdAt: new Date().toISOString(),
    configHash,
    planHash: computePlanHash(configHash, targets, listings),
    category: charts[0]?.category ?? config.category,
    bytesPerImage: measured.bytes,
    bytesSource: measured.source,
    targets,
    listings,
    charts,
    summary: summarize(targets, new Map(Object.entries(listings)), charts, measured.bytes),
    incomplete: [
      ...charts
        .filter((c) => c.status !== "ok")
        .map((c) => `The chart for ${label(c.gl)} could not be read.`),
      ...targets
        .filter((t) => listings[deckKey(t)]?.status === "error")
        .map((t) => `The store page of ${t.name} in ${label(t.gl)} could not be read.`),
    ],
  };
  workspaceStorage(paths.workspace).putJson(countriesPlanKey(paths), plan);
  return plan;
}

export function readCountriesPlan(loaded: LoadedConfig): CountriesPlan | undefined {
  const paths = projectPaths(loaded);
  return workspaceStorage(paths.workspace).getJson(countriesPlanKey(paths)) as
    | CountriesPlan
    | undefined;
}

/** Plain reason why a saved countries check cannot be approved any more, or null. */
export function countriesPlanProblem(loaded: LoadedConfig, plan: CountriesPlan): string | null {
  const { config } = loaded;
  if (!plan.gls.every((gl) => config.markets.some((m) => m.gl === gl)))
    return "These countries are not in the project any more. Check the store again.";
  const p = planProblem(plan, countriesHash(config, plan.gls), config.download.metadataCacheHours);
  if (!p) return null;
  return p.startsWith("The config changed")
    ? "The project's countries or games changed since the store check. Check the store again."
    : `${p} Check the store again.`;
}

/** The approval numbers of a saved countries check (no network). */
export function countriesPreview(loaded: LoadedConfig, plan: CountriesPlan) {
  const { config } = loaded;
  const db = openImageDb(projectPaths(loaded));
  const ids = new Set<string>();
  for (const t of plan.targets) {
    const l = plan.listings[deckKey(t)];
    for (const s of l?.status === "ok" ? l.screenshots : []) ids.add(googleImageId(s));
  }
  const row = (gl: string, mine: typeof plan.targets) => {
    const ok = mine.filter((t) => plan.listings[deckKey(t)]?.status === "ok");
    const images = ok.reduce((n, t) => n + (plan.listings[deckKey(t)]?.screenshots.length ?? 0), 0);
    const label = config.markets.find((m) => m.gl === gl)?.label ?? gl.toUpperCase();
    return { gl, label, pages: mine.length, found: ok.length, images };
  };
  const countries = plan.gls.map((gl) =>
    row(
      gl,
      plan.targets.filter((t) => t.gl === gl),
    ),
  );
  // Chart games new to the project are also read in the main country, as the project download does.
  const others = [...new Set(plan.targets.map((t) => t.gl))].filter((gl) => !plan.gls.includes(gl));
  const alsoIn = others.map((gl) =>
    row(
      gl,
      plan.targets.filter((t) => t.gl === gl),
    ),
  );
  const inLibrary = [...ids].filter((g) => db.byGoogleId(g)).length;
  return {
    gls: plan.gls,
    planHash: plan.planHash,
    createdAt: plan.createdAt,
    countries,
    alsoIn,
    images: ids.size,
    inLibrary,
    toDownload: ids.size - inLibrary,
    // Original plus its small preview copy, as in the project's download preview.
    bytes: (ids.size - inLibrary) * (plan.bytesPerImage + 20_000),
    bytesSource: plan.bytesSource,
    aiCalls: 0,
    incomplete: plan.incomplete,
    problem: countriesPlanProblem(loaded, plan),
  };
}
