import { statSync } from "node:fs";
import { join } from "node:path";
import gplay, { type IAppItem, type IAppItemFullDetail } from "google-play-scraper";
import { sleep } from "../util/cli-io.ts";
import { readJsonIfExists, safeName, writeJsonAtomic } from "../util/fsx.ts";
import { notSoldThere } from "./answers.ts";
import { sharedPlayQueue } from "./queue.ts";
import { dedupScreenshots } from "./screenshots.ts";
import { officialFromApp, type StoreOfficial } from "./store-text.ts";

export interface Listing {
  appId: string;
  gl: string;
  hl: string;
  status: "ok" | "unavailable" | "error";
  title?: string;
  genreId?: string;
  developer?: string;
  /** Length of the scraper's raw screenshot array, before removing repeats. */
  rawCount: number;
  /** Deduped base URLs in store order. */
  screenshots: string[];
  /** Official store text and category ("ok" pages read since this was added). */
  store?: StoreOfficial | null;
  error?: string;
  fetchedAt: string;
}

export interface ChartEntry {
  rank: number;
  appId: string;
  title: string;
  developer: string;
}

export interface ChartResult {
  gl: string;
  hl: string;
  collection: string;
  category: string;
  status: "ok" | "error";
  entries: ChartEntry[];
  error?: string;
  fetchedAt: string;
}

// The library's .d.ts declares its enums as types only; the runtime accepts plain strings.
type ListFn = (o: {
  collection: string;
  category: string;
  num: number;
  lang: string;
  country: string;
}) => Promise<IAppItem[]>;
const listFn = gplay.list as unknown as ListFn;

function errorStatus(e: unknown): number | undefined {
  if (e && typeof e === "object" && "status" in e && typeof e.status === "number") return e.status;
  return undefined;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Google Play metadata with a polite delay between requests and an on-disk cache. */
export class PlayClient {
  public requests = 0;
  public cacheHits = 0;

  constructor(
    private readonly cacheDir: string,
    private readonly delayMs: number,
    private readonly cacheHours: number,
  ) {}

  private fresh(path: string): boolean {
    try {
      return Date.now() - statSync(path).mtimeMs < this.cacheHours * 3_600_000;
    } catch {
      return false;
    }
  }

  /** Through the process-wide queue, so store checks and the wizard's lookups share one pace. */
  private politely<T>(fn: () => Promise<T>): Promise<T> {
    this.requests++;
    return sharedPlayQueue(this.delayMs).run(fn, "background");
  }

  async listing(appId: string, gl: string, hl: string): Promise<Listing> {
    const path = join(this.cacheDir, "listing", safeName(appId), `${gl}-${safeName(hl)}.json`);
    const cached = readJsonIfExists(path) as Listing | undefined;
    // A page cached before the store text was kept is read again (once).
    const complete = cached?.status !== "ok" || cached.store !== undefined;
    if (cached && cached.status !== "error" && complete && this.fresh(path)) {
      this.cacheHits++;
      return cached;
    }
    const base = { appId, gl, hl, fetchedAt: new Date().toISOString() };
    let result: Listing | undefined;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        const app: IAppItemFullDetail = await this.politely(() =>
          gplay.app({ appId, lang: hl, country: gl }),
        );
        const raw = app.screenshots ?? [];
        // Google Play still shows a game that is not sold in this country, marked unavailable:
        // it has no store page there (its screenshots belong to another country).
        if (notSoldThere(app)) {
          result = {
            ...base,
            status: "unavailable",
            title: app.title,
            rawCount: 0,
            screenshots: [],
          };
          break;
        }
        result = {
          ...base,
          status: "ok",
          title: app.title,
          genreId: app.genreId,
          developer: app.developer,
          rawCount: raw.length,
          screenshots: dedupScreenshots(raw),
          store: officialFromApp(app),
        };
      } catch (e) {
        if (errorStatus(e) === 404) {
          result = { ...base, status: "unavailable", rawCount: 0, screenshots: [] };
        } else if (attempt === 1) {
          result = {
            ...base,
            status: "error",
            rawCount: 0,
            screenshots: [],
            error: errorMessage(e),
          };
        } else {
          await sleep(3000);
        }
      }
    }
    const final = result as Listing;
    if (final.status !== "error") writeJsonAtomic(path, final);
    return final;
  }

  async chart(
    collection: string,
    category: string,
    gl: string,
    hl: string,
    depth: number,
  ): Promise<ChartResult> {
    const name = `${collection}-${category}-${gl}-${safeName(hl)}-${depth}.json`;
    const path = join(this.cacheDir, "chart", name);
    const cached = readJsonIfExists(path) as ChartResult | undefined;
    if (cached && cached.status === "ok" && this.fresh(path)) {
      this.cacheHits++;
      return cached;
    }
    const base = { gl, hl, collection, category, fetchedAt: new Date().toISOString() };
    try {
      const items = await this.politely(() =>
        listFn({ collection, category, num: depth, lang: hl, country: gl }),
      );
      const entries = items.slice(0, depth).map((it, i) => ({
        rank: i + 1,
        appId: it.appId,
        title: it.title,
        developer: it.developer,
      }));
      const result: ChartResult = { ...base, status: "ok", entries };
      writeJsonAtomic(path, result);
      return result;
    } catch (e) {
      return { ...base, status: "error", entries: [], error: errorMessage(e) };
    }
  }
}
