import { findRepeats, runOffsets, sameCheck } from "../analysis/deck-repeats.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { analysedSlots } from "../core/selection.ts";
import { workspaceStorage } from "../storage/index.ts";
import { type ImageDb, type ImageRecord, openImageDb } from "../store/imagedb.ts";
import { readDeck } from "../store/manifest.ts";
import { cachedGrey, type GreyReader, greyPixels } from "../store/pixel-diff.ts";
import {
  readSameScreen,
  sameScreenCandidate,
  sameScreenFiles,
  sameScreenKey,
} from "../store/same-screen.ts";
import { chartGames } from "./scope-plan.ts";

/** Every saved deck of the project (ours, the named competitors, chart games), every country. */
export function projectDecks(loaded: LoadedConfig) {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const apps = new Set([
    config.ourApp.id,
    ...config.competitors.map((c) => c.id),
    ...chartGames(loaded).map((g) => g.appId),
  ]);
  return [...apps].flatMap((appId) =>
    config.markets.flatMap((m) => {
      const d = readDeck(paths.decks, { appId, gl: m.gl, hl: m.hl });
      return d?.status === "ok" ? [d] : [];
    }),
  );
}

/** The analysed slots of a deck with their image facts (the images the checks read). */
export function deckImages(
  loaded: LoadedConfig,
  db: Pick<ImageDb, "get">,
  appId: string,
  gl: string,
  hl: string,
) {
  const d = readDeck(projectPaths(loaded).decks, { appId, gl, hl });
  if (d?.status !== "ok") return [];
  return analysedSlots(loaded.config, d).flatMap((s) => {
    const rec = s.imageId ? db.get(s.imageId) : undefined;
    return rec
      ? [{ position: s.position, imageId: rec.id, width: rec.width, height: rec.height, rec }]
      : [];
  });
}

/**
 * Runs the "same screen uploaded twice" pixel check (free, code only) for every candidate pair
 * inside each deck of the project that has none yet: same orientation and a fingerprint within
 * 22 bits; then, where at least two confirmed pairs share a distance (copy = original + k) and
 * sizes, the other pairs at that distance and sizes too (a doubled set whose fingerprints moved
 * further). Cached per pair (write-once, shared in the library), so later calls only read. The
 * planner and the reports read the cache. Returns how many pairs were computed.
 */
export function ensureSameScreens(
  loaded: LoadedConfig,
  read: GreyReader = greyPixels,
): Promise<number> {
  // One pass per project at a time: a second request waits for the running one.
  const id = projectPaths(loaded).projectId;
  const running = inFlight.get(id);
  if (running) return running;
  const p = checkAll(loaded, read).finally(() => inFlight.delete(id));
  inFlight.set(id, p);
  return p;
}

const inFlight = new Map<string, Promise<number>>();

async function checkAll(loaded: LoadedConfig, read: GreyReader): Promise<number> {
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const db = openImageDb(paths);
  let computed = 0;
  for (const d of projectDecks(loaded)) {
    // Decoded pictures are kept for one deck only.
    const grey = cachedGrey(read);
    const slots = deckImages(loaded, db, d.appId, d.gl, d.hl);
    const check = async (a: ImageRecord, b: ImageRecord) => {
      const key = sameScreenKey(paths, a.id, b.id);
      if (a.id === b.id || readSameScreen(storage, key)) return;
      try {
        const r = await sameScreenFiles(
          { ...a, file: db.abs(a.file) },
          { ...b, file: db.abs(b.file) },
          grey,
        );
        storage.putJsonOnce(key, r);
        computed++;
      } catch {
        // A missing or unreadable file: that pair is not a repeat.
      }
    };
    for (const [i, a] of slots.entries())
      for (const b of slots.slice(i + 1))
        if (sameScreenCandidate(a.rec, b.rec)) await check(a.rec, b.rec);
    const confirmed = findRepeats(slots, sameCheck(paths))?.pairs ?? [];
    const at = (n: number) => slots.find((s) => s.position === n);
    for (const run of runOffsets(confirmed, at))
      for (const b of slots) {
        const a = at(b.position - run.k);
        if (!a || !run.sizes.has(`${a.width}x${a.height}>${b.width}x${b.height}`)) continue;
        await check(a.rec, b.rec);
      }
  }
  return computed;
}
