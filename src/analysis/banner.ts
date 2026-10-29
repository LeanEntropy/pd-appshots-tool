import { ART_TYPES, categoryOf, FULL_SCREEN_ART, PROMO_BANNER } from "./categories.ts";
import type { AnalysisRecord } from "./records.ts";
import type { ImageAnalysis } from "./schema.ts";

/**
 * Promotional banners (user, 2026-10-30), by code: wide full-screen art with no game interface
 * in a game whose play orientation is portrait, i.e. a landscape advert in a portrait game. The
 * play orientation comes from the game's own screens in its other analysed images (the capture
 * orientation of every gameplay, menu or other game screen). Applied in memory only: the saved
 * record and the model's description never change.
 */
export const BANNER_RULE = "promo-banner.v1";

type Orientation = "portrait" | "landscape";

/** A future analysis prompt asks the model to say this in notes for a banner (wording only). */
const SAYS_BANNER = /\bpromotional banner\b/i;

export interface BannerMark {
  rule: string;
  /** The game's play orientation, or null when its other images do not show it. */
  playOrientation: Orientation | null;
  imageOrientation: string;
  /** The model's own screen type and subtype before the banner mapping. */
  from: { screenType: string; subtype: string };
}

const usable = (r: AnalysisRecord): r is AnalysisRecord & { final: ImageAnalysis } => !!r.final;

/** The orientation of the largest game screen (not art) in one image, or null. */
function screenOrientation(a: ImageAnalysis): Orientation | null {
  if (categoryOf(a) === FULL_SCREEN_ART || a.screenshot.screenType === PROMO_BANNER) return null;
  const big = [...a.screenshot.captures]
    .filter((c) => !ART_TYPES.has(c.screenType))
    .sort((x, y) => y.areaPercent - x.areaPercent)[0];
  return big && big.orientation !== "square" ? big.orientation : null;
}

/** Each game's play orientation: the majority of its game screens; null on a tie or none. */
export function playOrientations(
  records: Iterable<AnalysisRecord>,
): Map<string, Orientation | null> {
  const votes = new Map<string, { portrait: number; landscape: number }>();
  for (const r of records) {
    if (!usable(r)) continue;
    const o = screenOrientation(r.final);
    if (!o) continue;
    const v = votes.get(r.appId) ?? { portrait: 0, landscape: 0 };
    v[o]++;
    votes.set(r.appId, v);
  }
  return new Map(
    [...votes].map(([id, v]) => [
      id,
      v.portrait > v.landscape ? "portrait" : v.landscape > v.portrait ? "landscape" : null,
    ]),
  );
}

/** Whether one record is a promotional banner, given its game's play orientation. */
export function bannerOf(r: AnalysisRecord, play: Orientation | null): BannerMark | null {
  if (!usable(r) || categoryOf(r.final) !== FULL_SCREEN_ART) return null;
  const image = r.identity?.image?.orientation ?? null;
  // Wide artwork only: a landscape picture in a portrait game. The model's note counts only
  // when the game's other images do not show its play orientation; the pixels decide otherwise.
  if (image !== "landscape") return null;
  if (play ? play !== "portrait" : !SAYS_BANNER.test(r.final.notes)) return null;
  const s = r.final.screenshot;
  // The title-screen mapping (record-refresh.ts) renames the model's subtype; keep the model's.
  const subtype = s.subtype === "title_screen" ? (r.mappedFrom?.subtype ?? "") : s.subtype;
  return {
    rule: BANNER_RULE,
    playOrientation: play,
    imageOrientation: image,
    from: { screenType: s.screenType, subtype },
  };
}

/** The record read as a banner: art with no capture, the model's words kept. */
function asBanner(r: AnalysisRecord & { final: ImageAnalysis }, mark: BannerMark): AnalysisRecord {
  const s = r.final.screenshot;
  return {
    ...r,
    banner: mark,
    final: {
      ...r.final,
      screenshot: {
        ...s,
        screenType: PROMO_BANNER,
        subtype: mark.from.subtype,
        composition: "pure_art",
        captures: [],
        captureAreaPercent: 0,
      },
    },
  };
}

/** Records with every promotional banner marked, in memory (other records are the same objects). */
export function withBanners(
  records: ReadonlyMap<string, AnalysisRecord>,
): Map<string, AnalysisRecord> {
  const play = playOrientations(records.values());
  return new Map(
    [...records].map(([id, r]) => {
      const mark = usable(r) ? bannerOf(r, play.get(r.appId) ?? null) : null;
      return [id, mark && usable(r) ? asBanner(r, mark) : r];
    }),
  );
}
