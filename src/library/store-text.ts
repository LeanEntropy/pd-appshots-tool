import { z } from "zod";
import { deriveKeywords, KEYWORDS_VERSION, type Keyword } from "../analysis/keywords.ts";
import { appSegment } from "../play/answers.ts";
import type { StoreOfficial } from "../play/store-text.ts";
import { libraryKey, type Storage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";

/**
 * Store text snapshots in the shared library (shared by all projects, like the images):
 *   library/store-text/<app>/<gl>-<hl>/<YYYY-MM-DD>.json
 * One per game, country-language and day the page was READ; a second read on the same day
 * replaces it. A later day is a new file, so the store history can compare them.
 */
export interface StoreSnapshot {
  appId: string;
  gl: string;
  hl: string;
  /** The day the page was read (from fetchedAt), not the day it was saved. */
  date: string;
  fetchedAt: string;
  official: StoreOfficial;
  /** Hash of the official text, to spot identical pages and changes cheaply. */
  textHash: string;
  /** Keywords derived from the store text by code. Google Play has no official keywords. */
  derived: { version: number; keywords: Keyword[] };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function storeTextDir(appId: string, gl: string, hl: string): string {
  return libraryKey("store-text", appSegment(appId), `${gl}-${hl}`);
}

/** Hash of what the user reads on the page (the content rating is country-only, so left out). */
export function textHash(o: StoreOfficial): string {
  return stableHash({
    title: o.title,
    short: o.shortDescription,
    description: o.description,
    genre: o.genre,
    chips: o.chips.map((c) => c.name),
  });
}

/** Saves one page's store text under the day it was read; returns the snapshot. */
export function saveStoreText(
  storage: Storage,
  page: { appId: string; gl: string; hl: string; fetchedAt: string; official: StoreOfficial },
): StoreSnapshot {
  const date = page.fetchedAt.slice(0, 10);
  if (!DATE.test(date)) throw new Error(`Bad read date "${page.fetchedAt}"`);
  const snap: StoreSnapshot = {
    appId: page.appId,
    gl: page.gl,
    hl: page.hl,
    date,
    fetchedAt: page.fetchedAt,
    official: page.official,
    textHash: textHash(page.official),
    derived: { version: KEYWORDS_VERSION, keywords: deriveKeywords(page.official, page.hl) },
  };
  storage.putJson(`${storeTextDir(page.appId, page.gl, page.hl)}/${date}.json`, snap);
  return snap;
}

function snapshotDates(storage: Storage, dir: string): string[] {
  const dates: string[] = [];
  // One folder read (the snapshots sit directly in it).
  for (const name of storage.children(dir)) {
    if (name.endsWith(".json") && DATE.test(name.slice(0, -5))) dates.push(name.slice(0, -5));
  }
  return dates.sort();
}

/** Saved and readable (a damaged file does not count, so the backfill reads the page again). */
export function hasStoreText(storage: Storage, appId: string, gl: string, hl: string): boolean {
  return latestStoreText(storage, appId, gl, hl) !== undefined;
}

const text = z.string().nullable();
const Official = z.object({
  title: text,
  shortDescription: text,
  description: text,
  recentChanges: text,
  genre: z.object({ id: text, name: text }),
  chips: z.array(z.object({ id: text, name: z.string() })),
  contentRating: text,
});
const Keywords = z.array(
  z.object({
    key: z.string(),
    term: z.string(),
    score: z.number(),
    fields: z.array(z.enum(["title", "tags", "short", "description"])),
  }),
);
const Snapshot = z.object({
  appId: z.string(),
  gl: z.string(),
  hl: z.string(),
  date: z.string().regex(DATE),
  fetchedAt: z.string(),
  official: Official,
  textHash: z.string(),
  derived: z.object({ version: z.unknown(), keywords: z.unknown() }).nullish().catch(null),
});

/**
 * The newest snapshot of one page, or undefined. Keywords saved by an older method are derived
 * again from the saved text (in memory; nothing is read from Google Play).
 */
export function latestStoreText(
  storage: Storage,
  appId: string,
  gl: string,
  hl: string,
): StoreSnapshot | undefined {
  const dir = storeTextDir(appId, gl, hl);
  const dates = snapshotDates(storage, dir);
  for (const date of dates.reverse()) {
    let raw: unknown;
    try {
      raw = storage.getJson(`${dir}/${date}.json`);
    } catch {
      continue;
    }
    const snap = Snapshot.safeParse(raw);
    if (!snap.success) continue;
    const d = snap.data.derived;
    const kept = d?.version === KEYWORDS_VERSION ? Keywords.safeParse(d.keywords) : null;
    return {
      ...snap.data,
      derived: {
        version: KEYWORDS_VERSION,
        keywords: kept?.success ? kept.data : deriveKeywords(snap.data.official, hl),
      },
    };
  }
  return undefined;
}
