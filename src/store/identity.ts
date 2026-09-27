import { createRequire } from "node:module";
import sharp from "sharp";
import { sha256 } from "../util/hash.ts";

// sharp-phash is CommonJS (module.exports = fn) while its typings declare an ES default export.
const require = createRequire(import.meta.url);
const phash = require("sharp-phash") as (image: Buffer) => Promise<string>;
const phashDistance = require("sharp-phash/distance") as (a: string, b: string) => number;

export interface ImageFacts {
  sha256: string;
  /** 64-bit DCT perceptual hash as a 64-character 0/1 string. */
  phash: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

export async function describeImage(buf: Buffer): Promise<ImageFacts> {
  const meta = await sharp(buf).metadata();
  return {
    sha256: sha256(buf),
    phash: await phash(buf),
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? "unknown",
    bytes: buf.length,
  };
}

export function hamming(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("perceptual hashes differ in length");
  return phashDistance(a, b);
}

export type Identity = "identical" | "near-identical" | "different";

/** Default: at most 6 of 64 bits differ counts as the same picture at another size or encoding. */
export const NEAR_IDENTICAL_BITS = 6;

/**
 * Identical = same bytes. Near-identical = same picture by perceptual hash (e.g. resized or
 * re-encoded). Anything else is different. Near-identical is a hint, never a reason to skip
 * analysis on its own; the cost-tier step decides that later.
 */
export function classifyPair(
  a: Pick<ImageFacts, "sha256" | "phash">,
  b: Pick<ImageFacts, "sha256" | "phash">,
  maxBits = NEAR_IDENTICAL_BITS,
): Identity {
  if (a.sha256 === b.sha256) return "identical";
  return hamming(a.phash, b.phash) <= maxBits ? "near-identical" : "different";
}
