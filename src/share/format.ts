import { z } from "zod";
import { key, PROJECT_ID } from "../storage/index.ts";

/**
 * The shared-project package (plan 12C, C2): one zip file with manifest.json and the files of
 * one project, below two fixed top folders:
 *   project/<path in the project folder>   settings, refs, decks, orders, reports, runs ...
 *   library/<path in the shared library>   the images, facts and analyses those refs use
 * Entry names are never used as paths: each one maps to a storage key through the allow-lists
 * below (zip-slip protection), and must be listed in the manifest with its hash.
 */
export const FORMAT = "store-screenshot-recipe/project";
export const FORMAT_VERSION = 1;
export const MANIFEST = "manifest.json";

export const LIMITS = {
  /** The upload (and so the zip) as a whole. */
  uploadBytes: 20 * 1024 ** 3,
  /** Kept free on the disk after an import. */
  reserveBytes: 2 * 1024 ** 3,
  manifestBytes: 50 * 1024 ** 2,
  imageBytes: 100 * 1024 ** 2,
  jsonBytes: 30 * 1024 ** 2,
  entries: 200_000,
  /** Deflated entries that grow more than this are refused (zip bomb). */
  ratio: 100,
};

export const KindSchema = z.enum(["light", "full"]);
export type ShareKind = z.infer<typeof KindSchema>;

const SHA = z.string().regex(/^[0-9a-f]{64}$/);

export const FileEntrySchema = z.strictObject({
  path: z.string().min(1).max(400),
  sha256: SHA,
  bytes: z.number().int().nonnegative(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

export const ManifestSchema = z.strictObject({
  format: z.literal(FORMAT),
  formatVersion: z.number().int().positive(),
  tool: z.strictObject({ version: z.string().max(40) }),
  createdAt: z.string().max(40),
  packageId: z.string().regex(/^[0-9a-f]{16,64}$/),
  kind: KindSchema,
  project: z.strictObject({
    id: z.string().regex(PROJECT_ID),
    name: z.string().min(1).max(200),
    ourAppId: z.string().min(1).max(200),
  }),
  counts: z.strictObject({
    images: z.number().int().nonnegative(),
    fullSize: z.number().int().nonnegative(),
    analyses: z.number().int().nonnegative(),
    reports: z.number().int().nonnegative(),
    competitors: z.number().int().nonnegative(),
    countries: z.number().int().nonnegative(),
  }),
  reports: z.array(z.string().max(200)).max(2000),
  files: z.array(FileEntrySchema).max(LIMITS.entries),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** Project files a package may carry (paths inside the project folder). */
const PROJECT_TOP_FILES = new Set([
  "project.json",
  "refs.json",
  "run-config.json",
  "selection.json",
]);
const PROJECT_DIRS = new Set([
  "decks",
  "orders",
  "own",
  "objects",
  "reports",
  "runs",
  "icons",
  "state",
]);

/** Library folders a package may carry. */
const LIBRARY_DIRS = new Set([
  "images",
  "google",
  "analysis",
  "attempts",
  "objects",
  "layer-diff",
  "pixel-check",
  "same-screen",
  "layout",
  "store-text",
  "concept-maps",
  "icons",
  "english",
]);
const IMAGE_DIRS = new Set(["orig", "thumb", "model", "crops", "facts", "pixels"]);

/** Only data files: nothing that a browser or the tool could run. */
const DATA_EXT = /\.(json|md|jpg|jpeg|png|webp|gif|bin)$/i;

export type Area = "project" | "library";

/**
 * The storage key an entry name maps to (a project file of `projectId`, or a library file), or
 * null when the name is not allowed. Names with "..", backslashes, drive letters, empty or odd
 * segments are refused by key() as well.
 */
export function entryKey(
  name: string,
  projectId: string,
  projectRoot?: string,
): { area: Area; rel: string; key: string } | null {
  if (name.length > 400 || /[\\:]/.test(name) || name.startsWith("/")) return null;
  const [top, ...rest] = name.split("/");
  const rel = rest.join("/");
  if (!rest.length || !DATA_EXT.test(name)) return null;
  const first = rest[0] ?? "";
  try {
    if (top === "project") {
      const ok = rest.length === 1 ? PROJECT_TOP_FILES.has(first) : PROJECT_DIRS.has(first);
      if (!ok) return null;
      const k = projectRoot ? key(projectRoot, rel) : key("projects", projectId, rel);
      return { area: "project", rel, key: k };
    }
    if (top === "library") {
      if (!LIBRARY_DIRS.has(first) || rest.length < 2) return null;
      if (first === "images" && !IMAGE_DIRS.has(rest[1] ?? "")) return null;
      return { area: "library", rel, key: key("library", rel) };
    }
  } catch {
    return null;
  }
  return null;
}

/** Pictures are stored as they are (already compressed); JSON and text are deflated. */
export const isPicture = (name: string) => /\.(jpg|jpeg|png|webp|gif|bin)$/i.test(name);

/** "1.2 GB", "28 MB", "640 KB". */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
