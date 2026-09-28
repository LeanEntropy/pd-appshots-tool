import { createHash } from "node:crypto";
import gplay from "google-play-scraper";
import { z } from "zod";
import { key, type Storage } from "../storage/index.ts";
import { PACKAGE_ID } from "./input.ts";
import { type PlayQueue, type Priority, sharedPlayQueue } from "./queue.ts";

/** A game's store details, as the wizard shows them on the confirmation card. */
export interface PlayDetails {
  appId: string;
  title: string;
  developer: string;
  genre: string;
  genreId: string;
  icon: string;
  installs: string;
  score: number | null;
  url: string;
  /** In a game category (charts need one). */
  isGame: boolean;
}

/** One search result: only what Google Play's search returns. */
export interface PlayHit {
  appId: string;
  title: string;
  developer: string;
  icon: string;
  score: number | null;
}

/** A failure the user can read (plan 3.5). */
export class PlayProblem extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "no-answer" | "unexpected" | "no-hits",
  ) {
    super(message);
  }
}

/** The scraper calls we use; tests inject a fake. */
export interface Scraper {
  app(o: { appId: string; lang: string; country: string }): Promise<unknown>;
  search(o: { term: string; num: number; lang: string; country: string }): Promise<unknown>;
}

// External boundary: only the fields we use, checked (plan 3.2).
const score = z.number().nullish().catch(null);
const DetailsRaw = z.object({
  appId: z.string().min(1),
  title: z.string().min(1),
  developer: z.string().default(""),
  genre: z.string().default(""),
  genreId: z.string().default(""),
  icon: z.string().default(""),
  installs: z.string().default(""),
  score,
  url: z.string().default(""),
});
const HitRaw = z.object({
  appId: z.string().min(1),
  title: z.string().min(1),
  developer: z.string().default(""),
  icon: z.string().default(""),
  score,
});
const Cached = z.object({ fetchedAt: z.string(), value: z.unknown() });

/** A package ID as one storage key segment (package IDs use only letters, digits, "." and "_"). */
export const appSegment = (appId: string) => appId.replace(/_/g, "@");

export const DETAILS_HOURS = 24;
export const SEARCH_HOURS = 6;
const NO_ANSWER = "Google Play did not answer. Try again in a minute.";
const UNEXPECTED = "Google Play answered in an unexpected way. Paste the game's link instead.";

function status(e: unknown): number | undefined {
  return e && typeof e === "object" && "status" in e && typeof e.status === "number"
    ? e.status
    : undefined;
}

/** Logs what Google Play sent when it does not match (for the terminal, never the page). */
function unexpected(what: string, raw: unknown, issues: z.core.$ZodIssue[]): PlayProblem {
  const shape = Array.isArray(raw)
    ? `array of ${raw.length}, first item keys: ${Object.keys(raw[0] ?? {}).join(", ")}`
    : raw && typeof raw === "object"
      ? `keys: ${Object.keys(raw).slice(0, 40).join(", ")}`
      : typeof raw;
  const where = issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  console.warn(`Google Play ${what} answer did not match (${where}). Shape: ${shape}`);
  return new PlayProblem(UNEXPECTED, "unexpected");
}

export function toDetails(raw: unknown): PlayDetails {
  const r = DetailsRaw.safeParse(raw);
  if (!r.success) throw unexpected("details", raw, r.error.issues);
  const d = r.data;
  return {
    appId: d.appId,
    title: d.title,
    developer: d.developer,
    genre: d.genre,
    genreId: d.genreId,
    icon: d.icon,
    installs: d.installs,
    score: d.score ?? null,
    url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(d.appId)}`,
    isGame: d.genreId.startsWith("GAME"),
  };
}

export function toHits(raw: unknown): PlayHit[] {
  const r = z.array(HitRaw).safeParse(raw);
  if (!r.success) throw unexpected("search", raw, r.error.issues);
  return r.data.map((h) => ({ ...h, score: h.score ?? null }));
}

export interface LookupOptions {
  queue?: PlayQueue;
  delayMs?: number;
  scraper?: Scraper;
  /** Wait before the one retry (plan 3.5: 3 s). */
  retryMs?: number;
  now?: () => number;
}

/**
 * Game details by package ID and name search on Google Play (plan section 3), through the one
 * polite queue, with a cache shared by all projects in shared/cache/play/. Errors are never
 * cached; "not on Google Play" is (it is a real answer).
 */
export class PlayLookup {
  private readonly queue: PlayQueue;
  private readonly scraper: Scraper;
  private readonly retryMs: number;
  private readonly now: () => number;

  constructor(
    private readonly storage: Storage,
    o: LookupOptions = {},
  ) {
    this.queue = o.queue ?? sharedPlayQueue(o.delayMs ?? 800);
    this.scraper = o.scraper ?? (gplay as unknown as Scraper);
    this.retryMs = o.retryMs ?? 3000;
    this.now = o.now ?? Date.now;
  }

  /** An unreadable cache entry is kept aside (never silently lost) and read again from Play. */
  private quarantine(k: string): void {
    try {
      const bytes = this.storage.getBytes(k);
      const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, "-");
      if (bytes) this.storage.putBlob(`${k}.bad-${stamp}`, bytes);
    } catch {}
  }

  private cached(k: string, hours: number): { value: unknown } | null {
    let raw: unknown;
    try {
      raw = this.storage.getJson(k);
    } catch {
      this.quarantine(k);
      return null;
    }
    if (raw === undefined) return null;
    const c = Cached.safeParse(raw);
    if (!c.success) {
      this.quarantine(k);
      return null;
    }
    const age = this.now() - Date.parse(c.data.fetchedAt);
    return age >= 0 && age < hours * 3_600_000 ? { value: c.data.value } : null;
  }

  private remember(k: string, value: unknown): void {
    this.storage.putJson(k, { fetchedAt: new Date(this.now()).toISOString(), value });
  }

  /** One call through the queue, retried once after a pause unless Google said "not found". */
  private async call(fn: () => Promise<unknown>, priority: Priority): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.queue.run(fn, priority);
      } catch (e) {
        if (status(e) === 404) throw e;
        if (attempt >= 1) throw new PlayProblem(NO_ANSWER, "no-answer");
        await new Promise((r) => setTimeout(r, this.retryMs));
      }
    }
  }

  /** Store details in the United States (English), or a PlayProblem with a plain message. */
  async details(appId: string, priority: Priority = "interactive"): Promise<PlayDetails> {
    if (!PACKAGE_ID.test(appId)) throw notOnPlay();
    const k = key("shared", "cache", "play", "details", appSegment(appId), "us-en.json");
    const hit = this.cached(k, DETAILS_HOURS);
    if (hit) {
      if (hit.value === null) throw notOnPlay();
      try {
        return toDetails(hit.value);
      } catch {
        this.quarantine(k);
      }
    }
    let raw: unknown;
    try {
      raw = await this.call(() => this.scraper.app({ appId, lang: "en", country: "us" }), priority);
    } catch (e) {
      if (status(e) === 404) {
        this.remember(k, null);
        throw notOnPlay();
      }
      throw e;
    }
    const d = toDetails(raw);
    // Only the fields we use are kept (the full answer holds the whole store page).
    this.remember(k, d);
    return d;
  }

  /** Top matches for a name, in store order; nothing is picked automatically. */
  async search(term: string, num = 8): Promise<PlayHit[]> {
    const norm = term.trim().toLowerCase().replace(/\s+/g, " ");
    const sha = createHash("sha256").update(`${norm}|us|en|${num}`).digest("hex");
    const k = key("shared", "cache", "play", "search", `${sha}.json`);
    const hit = this.cached(k, SEARCH_HOURS);
    let hits: PlayHit[] | null = null;
    if (hit) {
      try {
        hits = toHits(hit.value);
      } catch {
        this.quarantine(k);
      }
    }
    if (!hits) {
      const raw = await this.call(
        () => this.scraper.search({ term: norm, num, lang: "en", country: "us" }),
        "interactive",
      );
      hits = toHits(raw).slice(0, num);
      this.remember(k, hits);
    }
    if (!hits.length)
      throw new PlayProblem(
        `No games found for "${term.trim()}". Try the exact name, or paste the game's link.`,
        "no-hits",
      );
    return hits;
  }
}

function notOnPlay(): PlayProblem {
  return new PlayProblem(
    "No game with this ID on Google Play in the United States. Check the link, or paste it again from the game's Google Play page.",
    "unavailable",
  );
}
