import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { hasStoreText, saveStoreText } from "../library/store-text.ts";
import type { Listing } from "../play/client.ts";
import { type Storage, workspaceStorage } from "../storage/index.ts";
import { latestRun } from "../view/model.ts";

type Log = (s: string) => void;

/**
 * Saves the store text of every "ok" page to the shared library. Best effort: a storage problem
 * is reported, never thrown, so it cannot fail a preview or a download.
 */
export function saveListingTexts(
  storage: Storage,
  listings: Iterable<Listing>,
  log: Log,
): { saved: number; failed: number } {
  let saved = 0;
  let failed = 0;
  for (const l of listings) {
    if (l.status !== "ok" || !l.store) continue;
    try {
      saveStoreText(storage, { ...l, official: l.store });
      saved++;
    } catch (e) {
      failed++;
      if (failed <= 3)
        log(
          `  Warning: could not save the store text of ${l.appId} (${l.gl.toUpperCase()}): ${e instanceof Error ? e.message : String(e)}`,
        );
    }
  }
  return { saved, failed };
}

export interface BackfillPage {
  appId: string;
  name: string;
  gl: string;
  hl: string;
  label: string;
}

/** The store pages of the latest download that have no saved store text yet. */
export function backfillPages(
  loaded: LoadedConfig,
  storage: Storage,
): { pages: BackfillPage[]; already: number; games: number } | null {
  const paths = projectPaths(loaded);
  const run = latestRun(paths.runs);
  if (!run) return null;
  const label = (gl: string, hl: string) =>
    loaded.config.markets.find((m) => m.gl === gl && m.hl === hl)?.label ?? `${gl} (${hl})`;
  const pages: BackfillPage[] = [];
  let already = 0;
  const games = new Set<string>();
  // Only pages that had screenshots: "not sold in this country" pages have no store text.
  for (const d of run.decks) {
    if (d.status !== "ok") continue;
    games.add(d.appId);
    if (hasStoreText(storage, d.appId, d.gl, d.hl)) already++;
    else
      pages.push({
        appId: d.appId,
        name: d.title ?? d.name,
        gl: d.gl,
        hl: d.hl,
        label: label(d.gl, d.hl),
      });
  }
  return { pages, already, games: games.size };
}

const minutes = (ms: number) =>
  ms < 90_000
    ? `about ${Math.max(1, Math.round(ms / 1000))} seconds`
    : `about ${Math.round(ms / 60_000)} minutes`;

export interface BackfillResult {
  toRead: number;
  saved: number;
  notSold: number;
  failed: number;
  ran: boolean;
}

/**
 * npm run store-text: fills in the store text (category, tags, title, descriptions) of the data
 * already downloaded. Without --yes it only shows the count and reads nothing. With it, the pages
 * are read one at a time through the polite queue, each saved at once; running it again skips
 * what is saved. Free: Google Play pages only, no AI.
 */
export async function runStoreTextBackfill(
  loaded: LoadedConfig,
  o: {
    yes: boolean;
    log: Log;
    client: { listing(appId: string, gl: string, hl: string): Promise<Listing> };
    storage?: Storage;
  },
): Promise<BackfillResult> {
  const storage = o.storage ?? workspaceStorage(projectPaths(loaded).workspace);
  const found = backfillPages(loaded, storage);
  const result: BackfillResult = { toRead: 0, saved: 0, notSold: 0, failed: 0, ran: false };
  if (!found) {
    o.log(
      "There is no download yet, so there are no store pages to fill in. Run the download first.",
    );
    return result;
  }
  const { pages, already, games } = found;
  result.toRead = pages.length;
  const pace = loaded.config.download.requestDelayMs;
  o.log(
    `Store text and category (free, no AI), ${games} games: ${pages.length} store pages to read, ${already} already saved.`,
  );
  if (!pages.length) {
    o.log("Nothing to read: every downloaded store page has its store text.");
    return result;
  }
  o.log(`Reading them one at a time takes ${minutes(pages.length * (pace + 1200))}.`);
  if (!o.yes) {
    o.log("Nothing was read. To read them, run: npm run store-text -- --yes");
    return result;
  }
  result.ran = true;
  let i = 0;
  for (const p of pages) {
    i++;
    o.log(`Reading store page ${i} of ${pages.length}: ${p.name}, ${p.label}`);
    const l = await o.client.listing(p.appId, p.gl, p.hl);
    if (l.status === "unavailable") result.notSold++;
    else if (l.status !== "ok" || !l.store) result.failed++;
    else result.saved += saveListingTexts(storage, [l], o.log).saved;
  }
  o.log(
    `Done. Saved ${result.saved}. Not sold in that country any more: ${result.notSold}. Could not be read: ${result.failed}${result.failed ? " (run the command again to retry them)" : ""}.`,
  );
  return result;
}
