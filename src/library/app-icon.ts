import { z } from "zod";
import { appSegment } from "../play/answers.ts";
import { downloadIcon, type Fetcher } from "../play/icon.ts";
import { libraryKey, type Storage } from "../storage/index.ts";
import { sha256 } from "../util/hash.ts";

/**
 * Game icons in the shared library, reusable on any page (home cards now, a project header
 * later). Content-addressed like the other images:
 *   library/icons/<sha>.webp            the icon, 128 px WebP (write-once)
 *   library/icons/apps/<app>.json       app id -> the latest icon URL seen and the stored copy
 * Store reads record the icon URL (noteIconUrl); the copy is downloaded lazily, the first time a
 * page needs it, and again when a store read brings a different URL (a page that shows it checks
 * the store page, cached, once a week). Free: no AI.
 */
const SHA = /^[0-9a-f]{64}$/;
export const appIconKey = (sha: string) => libraryKey("icons", `${sha}.webp`);
const indexKey = (appId: string) => libraryKey("icons", "apps", `${appSegment(appId)}.json`);
const CHECK_MS = 7 * 24 * 3_600_000;

const Index = z.object({
  /** The icon URL of the latest store read. */
  url: z.string().default(""),
  /** The stored copy and the URL it was downloaded from. */
  sha: z.string().regex(SHA).optional(),
  from: z.string().optional(),
  /** When the stored copy was last checked against a store read. */
  checkedAt: z.string().optional(),
});
type Index = z.infer<typeof Index>;

function readIndex(storage: Storage, appId: string): Index | null {
  try {
    const r = Index.safeParse(storage.getJson(indexKey(appId)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** The local URL of a game's stored icon, or null (the page then shows its letter tile). */
export function appIconSrc(storage: Storage, appId: string): string | null {
  const i = readIndex(storage, appId);
  return i?.sha && storage.exists(appIconKey(i.sha)) ? `/app-icons/${i.sha}.webp` : null;
}

/**
 * True when the game has no stored icon yet, a newer store read brought a different one, or the
 * copy was not checked against the store page for a week.
 */
export function appIconStale(storage: Storage, appId: string, now = Date.now()): boolean {
  const i = readIndex(storage, appId);
  if (!i?.sha || !storage.exists(appIconKey(i.sha))) return true;
  if (i.url !== "" && i.url !== i.from) return true;
  return !(now - Date.parse(i.checkedAt ?? "") < CHECK_MS);
}

/** Called after each store read: remembers the icon URL (written only when it changed). */
export function noteIconUrl(storage: Storage, appId: string, url: string): void {
  if (!url) return;
  try {
    const i = readIndex(storage, appId);
    if (i?.url === url) return;
    storage.putJson(indexKey(appId), { ...(i ?? {}), url });
  } catch {}
}

/** The bytes of a stored icon by its hash, or undefined. */
export function appIconBytes(storage: Storage, sha: string): Buffer | undefined {
  return SHA.test(sha) ? storage.getBytes(appIconKey(sha)) : undefined;
}

export interface IconSources {
  /** A store read of the game (the Play lookup, cached): gives the icon URL when none is new. */
  details: (appId: string) => Promise<{ icon: string }>;
  fetcher?: Fetcher;
}

const RETRY_MS = 10 * 60_000;
const inflight = new Map<string, Promise<string | null>>();
const failedAt = new Map<string, number>();

async function fetchAppIcon(
  storage: Storage,
  appId: string,
  s: IconSources,
): Promise<string | null> {
  const was = readIndex(storage, appId);
  let url = was?.url && was.url !== was.from ? was.url : "";
  if (!url) {
    try {
      url = (await s.details(appId)).icon;
    } catch {
      return null;
    }
    noteIconUrl(storage, appId, url);
  }
  // Same URL as the stored copy: only the check date moves.
  const same = was?.sha && was.from === url && storage.exists(appIconKey(was.sha)) ? was.sha : "";
  const webp = same ? null : await downloadIcon(url, "webp", s.fetcher);
  if (!same && !webp) return null;
  const sha = webp ? sha256(webp) : same;
  if (webp) storage.putBlob(appIconKey(sha), webp, sha);
  const latest = readIndex(storage, appId);
  storage.putJson(indexKey(appId), {
    url: latest?.url || url,
    sha,
    from: url,
    checkedAt: new Date().toISOString(),
  });
  return `/app-icons/${sha}.webp`;
}

/**
 * The game's icon, downloaded into the library when it is missing or stale. A failure keeps any
 * older copy and is not retried for 10 minutes; one download per game at a time.
 */
export async function ensureAppIcon(
  storage: Storage,
  appId: string,
  s: IconSources,
  now = Date.now(),
): Promise<string | null> {
  if (!appIconStale(storage, appId, now)) return appIconSrc(storage, appId);
  if (now - (failedAt.get(appId) ?? Number.NEGATIVE_INFINITY) < RETRY_MS)
    return appIconSrc(storage, appId);
  let p = inflight.get(appId);
  if (!p) {
    p = fetchAppIcon(storage, appId, s)
      .catch(() => null)
      .finally(() => inflight.delete(appId));
    inflight.set(appId, p);
  }
  const src = await p;
  if (!src) failedAt.set(appId, now);
  return src ?? appIconSrc(storage, appId);
}

/** Tests: forget the in-process retry pauses. */
export function resetAppIconRetries(): void {
  failedAt.clear();
}
