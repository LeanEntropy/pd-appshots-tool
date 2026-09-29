import type { LayerPixel } from "../analysis/layer-diff.ts";
import { pairPixel, readPairPixel } from "../analysis/layer-pixel.ts";
import { type AnalysisRecord, isUsable, readRecords } from "../analysis/records.ts";
import type { ImageAnalysis } from "../analysis/schema.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import type { Config } from "../config/schema.ts";
import { analysedSlots } from "../core/selection.ts";
import { settingsOf } from "../settings/access.ts";
import { type ImageDb, openImageDb } from "../store/imagedb.ts";
import { readDeck } from "../store/manifest.ts";
import {
  type Box,
  cachedGrey,
  type GreyReader,
  greyPixels,
  type PixelResult,
  type PixelThresholds,
  type PixelVerdict,
  pixelCandidate,
  pixelVerdict,
} from "../store/pixel-diff.ts";
import type { PixelInput } from "./anchors.ts";

/** The pixel check part of the Settings page. */
export interface PixelSettings extends PixelThresholds {
  mode: "off" | "suggest" | "automatic";
}

export function pixelSettings(config: Config): PixelSettings {
  const p = config.options.pixelCheck;
  return {
    mode: p.mode,
    sameMaxOutside: p.sameMaxOutside,
    differentMinOutside: p.differentMinOutside,
  };
}

/** What a doubtful-match card shows of the pixel check: verdict, shares, the areas to outline. */
export interface PairPixel {
  verdict: PixelVerdict;
  /** Shares of all pixels changed (0 to 1): in total, inside and outside the text and band. */
  changed: number;
  inside: number;
  outside: number;
  /** The changed areas (percent boxes of the country image), to outline. */
  areas: Box[];
}

export const pairPixelOf = (r: PixelResult, verdict: PixelVerdict): PairPixel => ({
  verdict,
  changed: r.changed,
  inside: r.inside,
  outside: r.outside,
  areas: r.areas,
});

/** Looks up the cached pixel check of an image against an analysed anchor (never computes). */
export function pixelLookup(
  loaded: LoadedConfig,
  records: ReadonlyMap<string, AnalysisRecord>,
): (imageId: string, anchorId: string) => PixelResult | undefined {
  const paths = projectPaths(loaded);
  const memo = new Map<string, PixelResult | undefined>();
  return (imageId, anchorId) => {
    const k = `${imageId}|${anchorId}`;
    if (memo.has(k)) return memo.get(k);
    const anchor = records.get(anchorId);
    const r = isUsable(anchor) ? readPairPixel(paths, imageId, anchor) : undefined;
    memo.set(k, r);
    return r;
  };
}

/**
 * The planner's pixel input (tierScope), or undefined when the check is off (fingerprint only,
 * exactly as before). `same` holds the pairs the user answered "same screen".
 */
export function pixelInput(
  loaded: LoadedConfig,
  records: ReadonlyMap<string, AnalysisRecord>,
  same: ReadonlySet<string>,
): PixelInput | undefined {
  const s = pixelSettings(loaded.config);
  if (s.mode === "off") return undefined;
  const look = pixelLookup(loaded, records);
  return {
    mode: s.mode,
    same,
    verdict: (imageId, anchorId): PixelVerdict | undefined => {
      const r = look(imageId, anchorId);
      return r ? pixelVerdict(r, s) : undefined;
    },
  };
}

/**
 * Runs the pixel check (free, code only) for every candidate pair of the project that has none
 * yet: each country image of every game against each analysed picture of the same game (same
 * shape within 3%, fingerprint within 14 bits). Cached per pair, so later calls are cheap; the
 * planner and the doubtful-match lists only read the cache. Returns how many were computed.
 */
export async function ensurePixelChecks(
  loaded: LoadedConfig,
  read: GreyReader = greyPixels,
): Promise<number> {
  const { config } = loaded;
  if (pixelSettings(config).mode === "off") return 0;
  const paths = projectPaths(loaded);
  const db = openImageDb(paths);
  const records = readRecords(paths);
  const main = settingsOf(config).mainMarket;
  const anchorsOf = new Map<string, AnalysisRecord[]>();
  for (const r of records.values()) {
    if (!isUsable(r)) continue;
    anchorsOf.set(r.appId, [...(anchorsOf.get(r.appId) ?? []), r]);
  }
  const grey = cachedGrey(read);
  let computed = 0;
  for (const [appId, anchors] of anchorsOf)
    for (const m of config.markets) {
      if (m.gl === main.gl && m.hl === main.hl) continue;
      const d = readDeck(paths.decks, { appId, gl: m.gl, hl: m.hl });
      for (const s of d?.status === "ok" ? analysedSlots(config, d) : []) {
        const img = s.imageId ? db.get(s.imageId) : undefined;
        if (!img) continue;
        for (const a of anchors) {
          const anc = db.get(a.imageId);
          if (!isUsable(a) || !anc || anc.id === img.id || !pixelCandidate(img, anc)) continue;
          if (readPairPixel(paths, img.id, a)) continue;
          try {
            if (await pairPixel(paths, db, img.id, a, grey)) computed++;
          } catch {
            // A missing or unreadable file: that pair keeps the fingerprint rule.
          }
        }
      }
    }
  return computed;
}

/** The text comparisons' pixel check (computed when missing), or undefined when it is off. */
export function layerPixelFor(
  loaded: LoadedConfig,
  db: Pick<ImageDb, "get" | "abs">,
):
  | ((
      imageId: string,
      anchor: { imageId: string; final: ImageAnalysis },
    ) => Promise<LayerPixel | null>)
  | undefined {
  const s = pixelSettings(loaded.config);
  if (s.mode === "off") return undefined;
  const paths = projectPaths(loaded);
  return async (imageId, anchor) => {
    const r = await pairPixel(paths, db, imageId, anchor);
    return r ? { result: r, verdict: pixelVerdict(r, s) } : null;
  };
}
