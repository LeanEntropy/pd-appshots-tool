import sharp from "sharp";
import type { Fetcher } from "../../src/play/icon.ts";
import { PlayLookup, type Scraper } from "../../src/play/lookup.ts";
import { PlayQueue } from "../../src/play/queue.ts";
import type { Storage } from "../../src/storage/index.ts";

export const ICON = "https://play-lh.googleusercontent.com/abc";

export function app(appId: string, title: string, genreId = "GAME_ROLE_PLAYING") {
  return {
    appId,
    title,
    developer: `${title} Studio`,
    genre: genreId === "TOOLS" ? "Tools" : "Role Playing",
    genreId,
    icon: ICON,
    installs: "1,000,000+",
    score: 4.4,
    url: `https://play.google.com/store/apps/details?id=${appId}`,
    screenshots: [],
  };
}

/** A scriptable Google Play: known apps, search hits, and failures to throw first. */
export function fakeScraper(apps: ReturnType<typeof app>[], hits: unknown[] = []) {
  const calls = { app: 0, search: 0 };
  const fail: unknown[] = [];
  const scraper: Scraper = {
    app: async ({ appId }) => {
      calls.app++;
      if (fail.length) throw fail.shift();
      const a = apps.find((x) => x.appId === appId);
      if (!a) throw Object.assign(new Error("App not found (404)"), { status: 404 });
      return a;
    },
    search: async () => {
      calls.search++;
      if (fail.length) throw fail.shift();
      return hits;
    },
  };
  return { scraper, calls, fail };
}

export function lookup(storage: Storage, scraper: Scraper, now?: () => number): PlayLookup {
  return new PlayLookup(storage, { scraper, queue: new PlayQueue(0), retryMs: 0, now });
}

/** Icon downloads answered locally with a small PNG. */
export async function fakeFetcher(): Promise<{ fetcher: Fetcher; calls: string[] }> {
  const png = await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 200, g: 40, b: 40 } },
  })
    .png()
    .toBuffer();
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    return new Response(new Uint8Array(png), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  };
  return { fetcher, calls };
}
