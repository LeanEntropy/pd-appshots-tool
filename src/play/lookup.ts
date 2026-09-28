import { createHash } from "node:crypto";
import gplay from "google-play-scraper";
import { key, type Storage } from "../storage/index.ts";
import {
  appSegment,
  Cached,
  DETAILS_HOURS,
  NO_ANSWER,
  notSoldThere,
  type PlayDetails,
  type PlayHit,
  PlayProblem,
  type Reference,
  type Scraper,
  SEARCH_HOURS,
  status,
  toDetails,
  toHits,
} from "./answers.ts";
import { PACKAGE_ID } from "./input.ts";
import { type PlayQueue, type Priority, sharedPlayQueue } from "./queue.ts";

export type { PlayDetails, PlayHit, Reference, Scraper } from "./answers.ts";
export {
  appSegment,
  DETAILS_HOURS,
  PlayProblem,
  SEARCH_HOURS,
  toDetails,
  toHits,
} from "./answers.ts";

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

  /**
   * Store details in the United States (English) by default, or in another country; a
   * PlayProblem with a plain message when the game is not there.
   */
  async details(
    appId: string,
    priority: Priority = "interactive",
    at: { gl: string; hl: string } = { gl: "us", hl: "en" },
  ): Promise<PlayDetails> {
    if (!PACKAGE_ID.test(appId)) throw notOnPlay();
    // v2: entries from before the "available: false" check are not trusted (read again).
    const file = `${at.gl}-${at.hl}.v2.json`;
    const k = key("shared", "cache", "play", "details", appSegment(appId), file);
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
      raw = await this.call(
        () => this.scraper.app({ appId, lang: at.hl, country: at.gl }),
        priority,
      );
    } catch (e) {
      if (status(e) === 404) {
        this.remember(k, null);
        throw notOnPlay();
      }
      throw e;
    }
    // Google Play still shows the page of a game that is not sold in that country, marked
    // "available: false" (checked live: a Japan-only game read with country=us).
    if (notSoldThere(raw)) {
      this.remember(k, null);
      throw notOnPlay();
    }
    const d = toDetails(raw);
    // Only the fields we use are kept (the full answer holds the whole store page).
    this.remember(k, d);
    return d;
  }

  /**
   * A competitor's details: in the United States, else in the first of the project's other
   * countries where it exists (its reference). `reference` is null when it is in the US.
   */
  async detailsAnywhere(
    appId: string,
    markets: readonly Reference[],
    priority: Priority = "interactive",
  ): Promise<{ app: PlayDetails; reference: Reference | null }> {
    try {
      return { app: await this.details(appId, priority), reference: null };
    } catch (e) {
      if (!(e instanceof PlayProblem && e.kind === "unavailable")) throw e;
    }
    for (const m of markets) {
      if (m.gl === "us") continue;
      try {
        return { app: await this.details(appId, priority, m), reference: m };
      } catch (e) {
        if (!(e instanceof PlayProblem && e.kind === "unavailable")) throw e;
      }
    }
    throw new PlayProblem(
      markets.some((m) => m.gl !== "us")
        ? "No game with this ID on Google Play in the United States or in this project's other countries. Check the link, or paste it again from the game's Google Play page."
        : notOnPlay().message,
      "unavailable",
    );
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
