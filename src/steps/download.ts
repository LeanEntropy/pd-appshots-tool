import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { computeStats, type RunStats } from "../core/stats.ts";
import { baselineMarket, deckKey } from "../core/targets.ts";
import { fullResUrl, googleImageId } from "../play/screenshots.ts";
import { ImageDb } from "../store/imagedb.ts";
import {
  type DeckManifest,
  type DeckSlot,
  newRunId,
  writeDeck,
  writeRunManifest,
} from "../store/manifest.ts";
import { runThrottled, sleep } from "../util/cli-io.ts";
import type { DownloadPlan } from "./preview.ts";

async function fetchImage(url: string): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 2) throw e;
      await sleep(2000 * (attempt + 1));
    }
  }
}

export interface DownloadResult {
  runId: string;
  manifestPath: string;
  downloaded: number;
  reused: number;
  failed: string[];
  stats: RunStats;
}

/** Downloads every screenshot of an approved plan into the project image database. */
export async function runDownload(
  loaded: LoadedConfig,
  plan: DownloadPlan,
  log: (s: string) => void,
): Promise<DownloadResult> {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  // Validate the taxonomy before writing anything, so a bad file cannot leave a partial run.
  const taxonomyHash = loadTaxonomy(loaded).hash;
  const db = ImageDb.open(paths.imageDb, paths.imagesOrig, paths.imagesThumb);

  // Unique Google images still missing from the database, in plan order, with where each is first seen.
  const wanted = new Map<string, string>();
  const where = new Map<string, string>();
  for (const t of plan.targets) {
    const l = plan.listings[deckKey(t)];
    if (l?.status !== "ok") continue;
    l.screenshots.forEach((url, i) => {
      const gid = googleImageId(url);
      if (db.byGoogleId(gid) || wanted.has(gid)) return;
      wanted.set(gid, url);
      where.set(gid, `${t.name}, ${t.gl.toUpperCase()}, position ${i + 1}`);
    });
  }
  const reused =
    new Set(
      plan.targets.flatMap((t) => plan.listings[deckKey(t)]?.screenshots ?? []).map(googleImageId),
    ).size - wanted.size;
  log(`Downloading ${wanted.size} images (${reused} already in the project image database)...`);

  const failed: string[] = [];
  let done = 0;
  await runThrottled(
    [...wanted.entries()],
    config.download.imageConcurrency,
    config.download.imageDelayMs,
    async ([gid, url]) => {
      try {
        await db.ingest(await fetchImage(fullResUrl(url)), undefined, gid);
      } catch (e) {
        failed.push(`${where.get(gid)} (${e instanceof Error ? e.message : String(e)})`);
      }
      if (++done % 50 === 0) {
        db.save();
        log(`  ${done} of ${wanted.size} images`);
      }
    },
  );
  db.save();

  const decks: DeckManifest[] = [];
  const deckHashes: Record<string, string> = {};
  for (const t of plan.targets) {
    const l = plan.listings[deckKey(t)];
    const slots: DeckSlot[] = (l?.status === "ok" ? l.screenshots : []).map((url, i) => {
      const gid = googleImageId(url);
      const rec = db.byGoogleId(gid);
      if (rec) db.addSource(rec.id, { appId: t.appId, gl: t.gl, hl: t.hl, position: i + 1 });
      return {
        position: i + 1,
        googleId: gid,
        imageId: rec?.id ?? null,
        width: rec?.width ?? 0,
        height: rec?.height ?? 0,
        deviceClass: rec?.deviceClass ?? "unknown",
        deviceConfidence: rec?.deviceConfidence ?? 0,
        orientation: rec?.orientation ?? "unknown",
      };
    });
    const deviceMix = { phone: 0, tablet: 0, unknown: 0 };
    for (const s of slots) deviceMix[s.deviceClass]++;
    const deck: DeckManifest = {
      ...t,
      status: l?.status ?? "error",
      ...(l?.title ? { title: l.title } : {}),
      rawCount: l?.rawCount ?? 0,
      deckLength: slots.length,
      deviceMix,
      slots,
      fetchedAt: l?.fetchedAt ?? plan.createdAt,
      ...(l?.error ? { error: l.error } : {}),
    };
    deckHashes[deckKey(t)] = writeDeck(paths.decks, deck);
    decks.push(deck);
  }
  db.save();

  const runId = newRunId("setup");
  const manifestPath = writeRunManifest(paths.runs, {
    runId,
    kind: "setup-download",
    createdAt: new Date().toISOString(),
    configPath: loaded.path,
    configHash: loaded.hash,
    taxonomyHash,
    planHash: plan.planHash,
    aiCalls: 0,
    imageCount: db.size,
    decks,
    deckHashes,
  });
  const b = baselineMarket(config);
  return {
    runId,
    manifestPath,
    downloaded: wanted.size - failed.length,
    reused,
    failed,
    stats: computeStats(decks, b),
  };
}
