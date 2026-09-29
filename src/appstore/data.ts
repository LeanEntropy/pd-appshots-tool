import { z } from "zod";
import { libraryKey, type ProjectContext, projectKey, type Storage } from "../storage/index.ts";

/**
 * App Store data of a project (plan-app-store 3). Kept in its own files next to the Google Play
 * ones, so nothing existing changes and an older copy of the tool that rewrites project.json or
 * refs.json can never drop or misread Apple data:
 *   projects/<id>/appstore.json                    opt-in switch, pair list, matches per country
 *   projects/<id>/refs-appstore.json               library images the App Store decks use
 *   projects/<id>/decks-appstore/<app>/<gl>-<lang>.json  one App Store deck
 *   library/apple/<hash>.json                      Apple asset path → image hashes (append-only)
 *   library/same-picture/<sha>.json                an Apple image that is a Play picture's twin
 *   library/store-text-appstore/<trackId>/<gl>-<lang>/<date>.json  store text from the API
 * A game stays its Google Play package; a platform is "play" (also when missing) or "appstore".
 */
export type Platform = "play" | "appstore";

/** The one reader of a stored platform: missing (every file written before it) is Google Play. */
export function platformOf(v: unknown): Platform {
  return v === "appstore" || v === "apple" ? "appstore" : "play";
}

export const CandidateSchema = z.object({
  trackId: z.number().int(),
  bundleId: z.string(),
  trackName: z.string(),
  sellerName: z.string(),
  iconUrl: z.string(),
  firstScreenshot: z.string(),
  signals: z.array(z.string()),
  sellerMatch: z.boolean(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const MatchSchema = z.object({
  status: z.enum(["matched", "needs_confirmation", "confirmed_none", "not_found", "fetch_failed"]),
  trackId: z.number().int().optional(),
  bundleId: z.string().optional(),
  sellerName: z.string().optional(),
  trackName: z.string().optional(),
  confidence: z.enum(["high", "medium", "low", "none"]),
  /** The signals that matched, or why nothing did. */
  evidence: z.array(z.string()),
  candidates: z.array(CandidateSchema),
  source: z.enum(["bundle", "search", "user"]),
  /** Accepted by code (exact bundle id and developer), not by the user. */
  auto: z.boolean().optional(),
  checkedAt: z.string(),
  confirmedAt: z.string().optional(),
});
export type Match = z.infer<typeof MatchSchema>;

export const AppStoreProjectSchema = z.object({
  version: z.literal(1),
  /** The project's explicit App Store opt-in (Settings); off means nothing Apple is fetched. */
  enabled: z.boolean(),
  /** The one list of (game, country) pairs that may be fetched (plan 5). */
  pairs: z.array(z.object({ game: z.string(), gl: z.string() })),
  /** Per game (Play package) and storefront. */
  games: z.record(z.string(), z.object({ byCountry: z.record(z.string(), MatchSchema) })),
  updatedAt: z.string(),
});
export type AppStoreProject = z.infer<typeof AppStoreProjectSchema>;

export const appStoreKey = (ctx: ProjectContext) => projectKey(ctx, "appstore.json");
/** Held while App Store data of a project is written (the fetch job, or one save from the page). */
export const appStoreLock = (ctx: ProjectContext) => `locks/appstore-${ctx.projectId}.lock`;
export const appleRefsKey = (ctx: ProjectContext) => projectKey(ctx, "refs-appstore.json");
export const appleDeckKey = (ctx: ProjectContext, appId: string, gl: string, lang: string) =>
  projectKey(ctx, "decks-appstore", appId, `${gl}-${lang}.json`);
export const samePictureKey = (sha: string) => libraryKey("same-picture", `${sha}.json`);
export const appleTextKey = (trackId: number, gl: string, lang: string, date: string) =>
  libraryKey("store-text-appstore", String(trackId), `${gl}-${lang}`, `${date}.json`);

export function emptyAppStore(now: string): AppStoreProject {
  return { version: 1, enabled: false, pairs: [], games: {}, updatedAt: now };
}

/** The project's App Store file; missing means "off, nothing matched" (every existing project). */
export function readAppStore(storage: Storage, ctx: ProjectContext): AppStoreProject {
  const raw = storage.getJson(appStoreKey(ctx));
  if (raw === undefined) return emptyAppStore("");
  const p = AppStoreProjectSchema.safeParse(raw);
  if (!p.success) throw new Error(`The App Store settings of "${ctx.projectId}" cannot be read.`);
  return p.data;
}

export function writeAppStore(storage: Storage, ctx: ProjectContext, a: AppStoreProject): void {
  storage.putJson(
    appStoreKey(ctx),
    AppStoreProjectSchema.parse({ ...a, updatedAt: new Date().toISOString() }),
  );
}

/** One ordered item of an App Store deck (only screenshots: the API never lists videos). */
export const AppleSlotSchema = z.object({
  kind: z.literal("screenshot"),
  position: z.number().int().min(1),
  imageId: z.string().nullable(),
  appleAsset: z.string(),
  width: z.number(),
  height: z.number(),
  orientation: z.string(),
  mediaType: z.literal("iphone"),
  /** same-file: these exact bytes were in the library before; same-picture: a Play twin. */
  reuse: z.enum(["same-file", "same-picture", "new"]).nullable(),
  sameAs: z.string().optional(),
  error: z.string().optional(),
});
export type AppleSlot = z.infer<typeof AppleSlotSchema>;

export const AppleDeckSchema = z.object({
  schemaVersion: z.literal(1),
  platform: z.literal("appstore"),
  appId: z.string(),
  gl: z.string(),
  hl: z.string(),
  appleLang: z.string(),
  trackId: z.number().int(),
  bundleId: z.string(),
  title: z.string(),
  sellerName: z.string(),
  /** Always "api" while page reading is not allowed; the set is then not verified. */
  source: z.literal("api"),
  setVerified: z.boolean(),
  status: z.enum(["ok", "not_sold", "identity_changed", "error"]),
  media: z.array(AppleSlotSchema),
  /** iPad screenshots are ignored like Play tablets; only their count is kept. */
  ipadCount: z.number().int(),
  fetchedAt: z.string(),
  error: z.string().optional(),
});
export type AppleDeck = z.infer<typeof AppleDeckSchema>;

export function readAppleDeck(storage: Storage, key: string): AppleDeck | undefined {
  const raw = storage.getJson(key);
  if (raw === undefined) return undefined;
  const p = AppleDeckSchema.safeParse(raw);
  return p.success ? p.data : undefined;
}

export const AppleAliasSchema = z.object({
  version: z.literal(1),
  assetPath: z.string(),
  entries: z.array(z.object({ sha256: z.string(), firstSeen: z.string() })),
});
export type AppleAlias = z.infer<typeof AppleAliasSchema>;

export const SamePictureSchema = z.object({
  version: z.literal(1),
  /** The Play image whose analysis this picture can reuse. */
  sameAs: z.string(),
  method: z.literal("strict-pixels.v1"),
  width: z.number(),
  height: z.number(),
  /** Share of pixels with a channel difference above the noise level. */
  changedShare: z.number(),
  meanDiff: z.number(),
  checkedAt: z.string(),
});
export type SamePicture = z.infer<typeof SamePictureSchema>;
