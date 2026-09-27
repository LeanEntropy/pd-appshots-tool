import { join } from "node:path";
import { type LoadedConfig, type ProjectPaths, projectPaths } from "../config/load.ts";
import { type PreviewSummary, summarize } from "../core/summary.ts";
import { baselineMarket, buildTargets, type DeckTarget, deckKey } from "../core/targets.ts";
import { type ChartResult, type Listing, PlayClient } from "../play/client.ts";
import { fullResUrl } from "../play/screenshots.ts";
import { readJsonIfExists, writeJsonAtomic } from "../util/fsx.ts";
import { stableHash } from "../util/hash.ts";

export interface DownloadPlan {
  createdAt: string;
  configHash: string;
  planHash: string;
  category: string;
  bytesPerImage: number;
  bytesSource: "measured" | "config";
  targets: DeckTarget[];
  listings: Record<string, Listing>;
  charts: ChartResult[];
  summary: PreviewSummary;
  /** Plain-language notes on anything the preview could not read (charts or store pages). */
  incomplete: string[];
}

/** Hash over exactly what would be downloaded; recomputed before download to detect edits. */
export function computePlanHash(
  configHash: string,
  targets: readonly DeckTarget[],
  listings: Readonly<Record<string, Listing>>,
): string {
  const shots = targets.map((t) => {
    const l = listings[deckKey(t)];
    return [deckKey(t), t.group, l?.status ?? "missing", l?.screenshots ?? []];
  });
  return stableHash({ configHash, shots });
}

/** Turns "GAME_ROLE_PLAYING" into "Role Playing". */
export function humanCategory(id: string): string {
  return id
    .replace(/^GAME_/, "")
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function planPath(paths: ProjectPaths): string {
  return join(paths.pending, "download-plan.json");
}

export function readPlan(paths: ProjectPaths): DownloadPlan | undefined {
  return readJsonIfExists(planPath(paths)) as DownloadPlan | undefined;
}

export function newClient(loaded: LoadedConfig, paths: ProjectPaths): PlayClient {
  const d = loaded.config.download;
  return new PlayClient(join(paths.cache, "play"), d.requestDelayMs, d.metadataCacheHours);
}

/** Average full-resolution size from a few HEAD requests; falls back to the config value. */
async function measureBytes(
  listings: Listing[],
  fallback: number,
): Promise<{ bytes: number; source: "measured" | "config" }> {
  const urls = listings
    .filter((l) => l.status === "ok" && l.screenshots[0])
    .slice(0, 8)
    .map((l) => fullResUrl(l.screenshots[0] as string));
  const sizes: number[] = [];
  for (const u of urls) {
    try {
      const res = await fetch(u, { method: "HEAD" });
      const n = Number(res.headers.get("content-length"));
      if (res.ok && n > 0) sizes.push(n);
    } catch {
      // sampling only; ignore
    }
  }
  if (sizes.length === 0) return { bytes: fallback, source: "config" };
  return { bytes: Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length), source: "measured" };
}

export async function buildPlan(
  loaded: LoadedConfig,
  log: (s: string) => void,
): Promise<DownloadPlan> {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const client = newClient(loaded, paths);
  const base = baselineMarket(config);

  let category = config.category;
  if (category === "auto") {
    const ours = await client.listing(config.ourApp.id, base.gl, base.hl);
    if (ours.status !== "ok" || !ours.genreId)
      throw new Error('Could not read our game\'s store category. Set "category" in the config.');
    category = ours.genreId;
  }
  log(
    `Store category: ${humanCategory(category)}. Reading the top ${config.charts.depth} ${config.charts.collection.toLowerCase()} chart in ${config.markets.length} countries...`,
  );
  const charts: ChartResult[] = [];
  for (const m of config.markets) {
    charts.push(
      await client.chart(config.charts.collection, category, m.gl, m.hl, config.charts.depth),
    );
  }

  const targets = buildTargets(config, charts);
  log(`Checking ${targets.length} store pages (no images downloaded yet)...`);
  const listings: Record<string, Listing> = {};
  let done = 0;
  for (const t of targets) {
    listings[deckKey(t)] = await client.listing(t.appId, t.gl, t.hl);
    if (++done % 25 === 0) log(`  ${done} of ${targets.length} store pages checked`);
  }
  log(
    `  ${targets.length} store pages checked (${client.requests} requests, ${client.cacheHits} from cache).`,
  );

  const measured = await measureBytes(
    Object.values(listings),
    config.download.estimatedBytesPerImage,
  );
  const labelOf = (gl: string) => config.markets.find((m) => m.gl === gl)?.label ?? gl;
  const incomplete = [
    ...charts
      .filter((c) => c.status !== "ok")
      .map((c) => `The chart for ${labelOf(c.gl)} could not be read.`),
    ...targets
      .filter((t) => listings[deckKey(t)]?.status === "error")
      .map((t) => `The store page of ${t.name} in ${labelOf(t.gl)} could not be read.`),
  ];
  const summary = summarize(targets, new Map(Object.entries(listings)), charts, measured.bytes);
  const planHash = computePlanHash(loaded.hash, targets, listings);
  const plan: DownloadPlan = {
    createdAt: new Date().toISOString(),
    configHash: loaded.hash,
    planHash,
    category,
    bytesPerImage: measured.bytes,
    bytesSource: measured.source,
    targets,
    listings,
    charts,
    summary,
    incomplete,
  };
  writeJsonAtomic(planPath(paths), plan);
  // Resolved package ids: config name vs the store's own title, so the user can spot a wrong id.
  writeJsonAtomic(
    join(paths.pending, "resolved-ids.json"),
    [config.ourApp, ...config.competitors].map((a) => {
      const l = listings[deckKey({ appId: a.id, gl: base.gl, hl: base.hl })];
      return {
        id: a.id,
        name: a.name,
        storeTitle: l?.title ?? null,
        developer: l?.developer ?? null,
        status: l?.status ?? "missing",
      };
    }),
  );
  return plan;
}

/** Returns a plain-language reason why a saved plan must not be used, or null if it is fine. */
export function planProblem(
  plan: DownloadPlan,
  configHash: string,
  maxAgeHours: number,
  now = Date.now(),
): string | null {
  if (plan.configHash !== configHash) return "The config changed since the preview.";
  if (computePlanHash(plan.configHash, plan.targets, plan.listings) !== plan.planHash) {
    return "The saved preview was changed after it was made.";
  }
  const ageHours = (now - Date.parse(plan.createdAt)) / 3_600_000;
  if (!(ageHours <= maxAgeHours)) return `The preview is ${Math.round(ageHours)} hours old.`;
  return null;
}
