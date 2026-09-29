import { z } from "zod";
import type { AppleQueue } from "./queue.ts";

/**
 * The iTunes Search / Lookup API reader (plan-app-store 1.1): the only Apple source this tool
 * reads. Apple's website terms forbid page-scraping apps.apple.com (A0 terms check,
 * 2026-09-29), so the public page is not read: no video, events, subtitle or promotional text.
 */
export const API = "https://itunes.apple.com";

const Result = z.looseObject({
  wrapperType: z.string().optional(),
  kind: z.string().optional(),
  trackId: z.number().int(),
  bundleId: z.string(),
  trackName: z.string(),
  sellerName: z.string().default(""),
  artistName: z.string().default(""),
  screenshotUrls: z.array(z.string()).default([]),
  ipadScreenshotUrls: z.array(z.string()).default([]),
  artworkUrl512: z.string().optional(),
  artworkUrl100: z.string().optional(),
  description: z.string().default(""),
  releaseNotes: z.string().optional(),
  version: z.string().optional(),
  genres: z.array(z.string()).default([]),
  primaryGenreName: z.string().optional(),
  languageCodesISO2A: z.array(z.string()).default([]),
  contentAdvisoryRating: z.string().optional(),
  averageUserRating: z.number().optional(),
  userRatingCount: z.number().optional(),
  currentVersionReleaseDate: z.string().optional(),
  trackViewUrl: z.string().optional(),
});

const Answer = z.object({ resultCount: z.number().int(), results: z.array(z.unknown()) });

export interface AppleApp {
  trackId: number;
  bundleId: string;
  trackName: string;
  sellerName: string;
  artistName: string;
  /** iPhone screenshots in the API's order (the page is not read; see the module note). */
  screenshotUrls: string[];
  ipadCount: number;
  iconUrl: string;
  description: string;
  releaseNotes: string;
  version: string;
  genres: string[];
  languages: string[];
  contentRating: string;
  averageUserRating: number | null;
  userRatingCount: number | null;
  updatedAt: string;
}

/**
 * The software results of one API answer. A malformed answer throws a readable error (never an
 * empty list, which would read as "not on the App Store"); a non-software row is skipped.
 */
export function parseLookup(raw: unknown): AppleApp[] {
  const a = Answer.safeParse(raw);
  if (!a.success) throw new Error("The App Store API answer has an unexpected shape.");
  const out: AppleApp[] = [];
  for (const row of a.data.results) {
    const o = (row ?? {}) as { kind?: unknown; wrapperType?: unknown };
    // Only rows that say they are something else (an artist, a song) are skipped; an app row
    // that no longer parses fails the read, so it can never turn into "not on the App Store".
    const other =
      (o.kind !== undefined && o.kind !== "software") ||
      (o.wrapperType !== undefined && o.wrapperType !== "software");
    if (other) continue;
    const r = Result.safeParse(row);
    if (!r.success) throw new Error("An App Store API result has an unexpected shape.");
    const x = r.data;
    out.push({
      trackId: x.trackId,
      bundleId: x.bundleId,
      trackName: x.trackName,
      sellerName: x.sellerName,
      artistName: x.artistName,
      screenshotUrls: x.screenshotUrls,
      ipadCount: x.ipadScreenshotUrls.length,
      iconUrl: x.artworkUrl512 ?? x.artworkUrl100 ?? "",
      description: x.description,
      releaseNotes: x.releaseNotes ?? "",
      version: x.version ?? "",
      genres: x.genres,
      languages: x.languageCodesISO2A,
      contentRating: x.contentAdvisoryRating ?? "",
      averageUserRating: x.averageUserRating ?? null,
      userRatingCount: x.userRatingCount ?? null,
      updatedAt: x.currentVersionReleaseDate ?? "",
    });
  }
  return out;
}

export interface Storefront {
  gl: string;
  lang: string;
}

const q = (p: Record<string, string>) => new URLSearchParams(p).toString();

/** One request for many bundle ids in one storefront (the lookup ignores letter case). */
export async function lookupBundleIds(
  queue: AppleQueue,
  sf: Storefront,
  bundleIds: readonly string[],
): Promise<AppleApp[]> {
  if (!bundleIds.length) return [];
  const url = `${API}/lookup?${q({ bundleId: bundleIds.join(","), country: sf.gl, lang: sf.lang, entity: "software" })}`;
  return parseLookup(await queue.json(url));
}

/** One request for many track ids in one storefront; a missing id is not sold there. */
export async function lookupTrackIds(
  queue: AppleQueue,
  sf: Storefront,
  trackIds: readonly number[],
): Promise<AppleApp[]> {
  if (!trackIds.length) return [];
  const url = `${API}/lookup?${q({ id: trackIds.join(","), country: sf.gl, lang: sf.lang, entity: "software" })}`;
  return parseLookup(await queue.json(url));
}

/** Name search in one storefront (iPhone software only). */
export async function searchApps(
  queue: AppleQueue,
  sf: Storefront,
  term: string,
  limit = 10,
): Promise<AppleApp[]> {
  const url = `${API}/search?${q({ term, country: sf.gl, lang: sf.lang, entity: "software", limit: String(limit) })}`;
  return parseLookup(await queue.json(url));
}
