import type { ProjectPaths } from "../config/load.ts";
import { LibraryImageDb } from "../library/imagedb.ts";
import type { DeviceClass } from "../play/screenshots.ts";
import type { ImageFacts } from "./identity.ts";
import { LegacyImageDb } from "./imagedb-legacy.ts";

export interface ImageSource {
  appId: string;
  gl: string;
  hl: string;
  /** 1-based store position. */
  position: number;
  /** Missing means Google Play (every source written before the App Store). */
  platform?: "appstore";
}

export interface ImageRecord extends ImageFacts {
  /** The image id is its sha256: identical bytes are stored and analysed once. */
  id: string;
  /** Relative to the images folder, e.g. "orig/<sha>.jpg". */
  file: string;
  thumb: string;
  deviceClass: DeviceClass;
  orientation: string;
  deviceConfidence: number;
  googleIds: string[];
  sources: ImageSource[];
  firstSeen: string;
}

export const EXT: Record<string, string> = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif" };

/**
 * A project's view of its images. Before the import it is the project's own database
 * (images/db.json); afterwards a facade over the shared library plus the project's refs.json.
 * `all()` and `get()` only return images this project uses.
 */
export interface ImageDb {
  readonly size: number;
  all(): ImageRecord[];
  get(id: string): ImageRecord | undefined;
  byGoogleId(googleId: string): ImageRecord | undefined;
  ingest(
    buf: Buffer,
    source?: ImageSource,
    googleId?: string,
  ): Promise<{ record: ImageRecord; isNew: boolean }>;
  linkGoogleId(id: string, googleId: string): void;
  addSource(id: string, s: ImageSource): void;
  save(): void;
  /** Absolute path of a record's stored file or thumbnail. */
  abs(relPath: string): string;
}

export function openImageDb(paths: ProjectPaths): ImageDb {
  return paths.library
    ? LibraryImageDb.open(paths.workspace, paths.library.refsKey, paths.projectId)
    : LegacyImageDb.open(paths.imageDb, paths.imagesOrig, paths.imagesThumb);
}
