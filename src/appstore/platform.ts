import { join } from "node:path";
import type { DeckManifest } from "../store/manifest.ts";
import { readJsonIfExists, safeName } from "../util/fsx.ts";
import { type AppleDeck, AppleDeckSchema, type Platform, platformOf } from "./data.ts";
import { appleLangFor } from "./lang.ts";

/**
 * The platform view of a project (plan-app-store 7.1): a report on the App Store reads the same
 * code paths as one on Google Play, with the deck and order folders of the App Store and the
 * project's App Store images next to its Play ones. Analyses stay per picture (never per store).
 */
export const APPLE_DECKS_DIR = "decks-appstore";
export const APPLE_ORDERS_DIR = "orders-appstore";

export const PLATFORM_NAMES: Record<Platform, string> = {
  play: "Google Play",
  appstore: "App Store",
};

/** The project seen through one store (missing: Google Play, the project as it always was). */
export function forPlatform<T extends { platform?: Platform }>(loaded: T, platform: unknown): T {
  const p = platformOf(platform);
  if (p === platformOf(loaded.platform)) return loaded;
  return { ...loaded, platform: p };
}

export const isAppleDecksDir = (dir: string) =>
  dir
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() === APPLE_DECKS_DIR;

/** The file of an App Store deck: the Play language of the country maps to Apple's locale. */
export function appleDeckPath(dir: string, t: { appId: string; gl: string; hl: string }): string {
  return join(dir, safeName(t.appId), `${t.gl}-${appleLangFor(t.gl, t.hl)}.json`);
}

/**
 * An App Store deck in the shape every report reads: the iPhone screenshots in store order (the
 * only media the Lookup API gives), each a phone slot. Not sold in the storefront reads as
 * "unavailable"; a changed identity or a failed fetch as an error (never used).
 */
export function appleManifest(d: AppleDeck): DeckManifest {
  const slots = d.media
    .filter((m) => m.kind === "screenshot")
    .map((m) => ({
      position: m.position,
      googleId: m.appleAsset,
      imageId: m.imageId,
      width: m.width,
      height: m.height,
      deviceClass: "phone" as const,
      deviceConfidence: 1,
      orientation: m.orientation,
    }));
  return {
    appId: d.appId,
    name: d.title,
    group: "named",
    tier: "same_audience",
    gl: d.gl,
    hl: d.hl,
    chartRanks: {},
    status: d.status === "ok" ? "ok" : d.status === "not_sold" ? "unavailable" : "error",
    title: d.title,
    rawCount: d.media.length,
    deckLength: slots.length,
    deviceMix: { phone: slots.length, tablet: 0, unknown: 0 },
    slots,
    fetchedAt: d.fetchedAt,
    ...(d.error ? { error: d.error } : {}),
  };
}

export function readAppleDeckFile(
  dir: string,
  t: { appId: string; gl: string; hl: string },
): AppleDeck | undefined {
  const p = AppleDeckSchema.safeParse(readJsonIfExists(appleDeckPath(dir, t)));
  return p.success ? p.data : undefined;
}
