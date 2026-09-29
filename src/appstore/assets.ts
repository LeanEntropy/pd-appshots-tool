import { libraryKey } from "../storage/index.ts";
import { sha256 } from "../util/hash.ts";

/**
 * Apple image URLs (mzstatic). A screenshot URL is "<asset path>/<w>x<h>bb.<ext>": the asset path
 * names the uploaded file, the last segment asks for a rendition. Asking for a bounding box
 * larger than the original returns the original size (probed 2026-09-29), so every download asks
 * for one fixed box in the original file's own format: the same asset always gives the same
 * bytes, and a PNG original is never re-encoded as JPEG.
 */
const FULL_BOX = "9999x9999bb";

/** The asset path: the URL without its rendition segment (and without query or host case). */
export function assetPath(url: string): string {
  const u = new URL(url);
  const path = u.pathname.replace(/\/[^/]*$/, "");
  return path;
}

/** The original file's format from its name in the asset path ("…/A.png" → png), else jpg. */
export function originalExt(url: string): "png" | "jpg" {
  const name = assetPath(url).split("/").pop() ?? "";
  return /\.png$/i.test(name) ? "png" : "jpg";
}

/** The full-size rendition URL. */
export function fullSizeUrl(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}${assetPath(url)}/${FULL_BOX}.${originalExt(url)}`;
}

/** library/apple/<hash>.json: Apple asset path → the image hashes fetched under it (append-only). */
export const appleAliasKey = (path: string) =>
  libraryKey("apple", `${sha256(path).slice(0, 40)}.json`);
