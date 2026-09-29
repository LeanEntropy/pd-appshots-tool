import type { ProjectContext, Storage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";
import { type AppleApp, lookupTrackIds } from "./api.ts";
import { assetPath } from "./assets.ts";
import {
  type AppleDeck,
  AppleDeckSchema,
  type AppleSlot,
  type AppStoreProject,
  appleDeckKey,
  appleTextKey,
} from "./data.ts";
import type { AppleImages } from "./ingest.ts";
import { appleLangFor } from "./lang.ts";
import { candidateOf } from "./match.ts";
import type { AppleQueue } from "./queue.ts";

export interface FetchPair {
  appId: string;
  name: string;
  gl: string;
  hl: string;
}

export interface CountryTally {
  gl: string;
  decks: number;
  notSold: number;
  identityChanged: number;
  screenshots: number;
  sameFile: number;
  samePicture: number;
  fresh: number;
  bytes: number;
  failed: string[];
}

const tally = (gl: string): CountryTally => ({
  gl,
  decks: 0,
  notSold: 0,
  identityChanged: 0,
  screenshots: 0,
  sameFile: 0,
  samePicture: 0,
  fresh: 0,
  bytes: 0,
  failed: [],
});

function saveText(storage: Storage, app: AppleApp, gl: string, lang: string, at: string): void {
  const text = {
    trackName: app.trackName,
    sellerName: app.sellerName,
    description: app.description,
    releaseNotes: app.releaseNotes,
    version: app.version,
    genres: app.genres,
    languages: app.languages,
    contentRating: app.contentRating,
  };
  storage.putJson(appleTextKey(app.trackId, gl, lang, at.slice(0, 10)), {
    version: 1,
    platform: "appstore",
    source: "api",
    trackId: app.trackId,
    bundleId: app.bundleId,
    gl,
    appleLang: lang,
    date: at.slice(0, 10),
    fetchedAt: at,
    official: text,
    ratings: { average: app.averageUserRating, count: app.userRatingCount },
    textHash: stableHash(text).slice(0, 16),
  });
}

export interface FetchDeps {
  storage: Storage;
  ctx: ProjectContext;
  api: AppleQueue;
  images: AppleImages;
  log: (s: string) => void;
  /** Throws when the project lock was lost: nothing more is written. */
  check: () => void;
}

/**
 * Reads the App Store decks of the matched pairs, country by country in the given order (one
 * API lookup per country, in its local language), downloads new screenshots into the library
 * and writes one deck per pair. The identity check runs on every read: a changed bundle id
 * blocks the deck and sends the match back to the user. Returns the tallies and the matches
 * to update.
 */
export async function runFetch(
  deps: FetchDeps,
  pairs: readonly FetchPair[],
  store: AppStoreProject,
): Promise<CountryTally[]> {
  const { storage, ctx, log } = deps;
  const out: CountryTally[] = [];
  const countries = [...new Set(pairs.map((p) => p.gl))];
  for (const gl of countries) {
    const t = tally(gl);
    out.push(t);
    const mine = pairs.filter((p) => p.gl === gl);
    const hl = mine[0]?.hl ?? "en";
    const lang = appleLangFor(gl, hl);
    const ids = mine.map((p) => store.games[p.appId]?.byCountry[gl]?.trackId ?? 0).filter(Boolean);
    let found: AppleApp[];
    try {
      found = await lookupTrackIds(deps.api, { gl, lang }, ids);
    } catch (e) {
      t.failed.push(`${gl.toUpperCase()} lookup: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const p of mine) {
      const m = store.games[p.appId]?.byCountry[gl];
      if (!m?.trackId || !m.bundleId) continue;
      const at = new Date().toISOString();
      const app = found.find((a) => a.trackId === m.trackId);
      const head = {
        schemaVersion: 1 as const,
        platform: "appstore" as const,
        appId: p.appId,
        gl,
        hl: p.hl,
        appleLang: lang,
        trackId: m.trackId,
        bundleId: m.bundleId,
        title: app?.trackName ?? m.trackName ?? p.name,
        sellerName: app?.sellerName ?? m.sellerName ?? "",
        source: "api" as const,
        setVerified: false,
        ipadCount: app?.ipadCount ?? 0,
        fetchedAt: at,
      };
      const key = appleDeckKey(ctx, p.appId, gl, lang);
      if (!app) {
        t.notSold++;
        deps.check();
        storage.putJson(key, { ...head, status: "not_sold", media: [] } satisfies AppleDeck);
        continue;
      }
      if (app.bundleId !== m.bundleId) {
        t.identityChanged++;
        // A fresh question for the user (also for a match they confirmed): the old answer
        // was about another bundle id, so it is not kept as theirs.
        const evidence = [`the app's bundle id changed from ${m.bundleId} to ${app.bundleId}`];
        const byCountry = store.games[p.appId]?.byCountry;
        if (byCountry)
          byCountry[gl] = {
            status: "needs_confirmation",
            confidence: "low",
            evidence,
            candidates: [
              candidateOf(app, { appId: p.appId, name: p.name, developer: "" }, evidence),
            ],
            source: "bundle",
            checkedAt: at,
          };
        deps.check();
        storage.putJson(key, {
          ...head,
          status: "identity_changed",
          media: [],
        } satisfies AppleDeck);
        continue;
      }
      const media: AppleSlot[] = [];
      for (const [i, url] of app.screenshotUrls.entries()) {
        const slot: AppleSlot = {
          kind: "screenshot",
          position: i + 1,
          imageId: null,
          appleAsset: assetPath(url),
          width: 0,
          height: 0,
          orientation: "unknown",
          mediaType: "iphone",
          reuse: null,
        };
        try {
          deps.check();
          const r = await deps.images.get(url, p.appId, {
            appId: p.appId,
            gl,
            hl: lang,
            position: i + 1,
            platform: "appstore",
          });
          Object.assign(slot, {
            imageId: r.sha,
            width: r.facts.width,
            height: r.facts.height,
            orientation: r.facts.orientation,
            reuse: r.reuse,
            ...(r.sameAs ? { sameAs: r.sameAs } : {}),
          });
          t.bytes += r.downloaded;
          if (r.reuse === "same-file") t.sameFile++;
          else if (r.reuse === "same-picture") t.samePicture++;
          else t.fresh++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          slot.error = msg;
          t.failed.push(`${p.name} ${gl.toUpperCase()} #${i + 1}: ${msg}`);
        }
        t.screenshots++;
        media.push(slot);
      }
      deps.check();
      deps.images.save();
      deps.check();
      saveText(storage, app, gl, lang, at);
      deps.check();
      storage.putJson(key, AppleDeckSchema.parse({ ...head, status: "ok", media }));
      t.decks++;
      log(`  ${gl.toUpperCase()} ${p.name}: ${media.length} screenshots`);
    }
  }
  return out;
}
