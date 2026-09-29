import { type RepeatOf, repeatReason } from "../analysis/deck-repeats.ts";
import type { CostTier } from "../analysis/tiers.ts";
import { hamming, NEAR_IDENTICAL_BITS } from "../store/identity.ts";
import { PIXEL_MAX_BITS, type PixelVerdict } from "../store/pixel-diff.ts";
import { type CrossStore, crossMatch } from "./cross-store.ts";
import { theCountry } from "./names.ts";

/** One store image a report needs: a game's phone screenshot at one position in one country. */
export interface ScopeInput {
  appId: string;
  gl: string;
  hl: string;
  /** Plain country name. */
  country: string;
  /** True for the main country (the reference of every "what changed"). */
  main: boolean;
  position: number;
  imageId: string;
  phash: string;
  width: number;
  height: number;
  /** The same screen as an earlier position of this deck (uploaded twice). */
  repeatOf?: RepeatOf;
  /** An App Store image (plan-app-store 4); missing: Google Play. */
  platform?: "appstore";
  /** App Store: the Play picture this one equals apart from file compression (strict check). */
  sameAs?: string;
}

/** An image that can anchor a text-layer comparison (the same picture, analysed once). */
export interface AnchorCandidate {
  appId: string;
  gl: string;
  hl: string;
  country: string;
  position: number;
  imageId: string;
  phash: string;
  width: number;
  height: number;
  analysed: boolean;
  /** Its store, for the plain reason ("Google Play", "App Store"). */
  store?: string;
}

export interface ScopeItem extends ScopeInput {
  /** App Store: a text comparison against a picture of another shape (whole image sent). */
  reshaped?: boolean;
  tier: CostTier;
  /** identical: the image reused; layer-diff: the anchor its text is compared with. */
  basedOn: string | null;
  /** Why, in plain words (shown in the list of images). */
  reason: string;
  /** A main-country image added to this plan only to anchor other countries (decision D2). */
  anchorAdded?: boolean;
  /** The game has no main-country version of this picture. */
  noMainVersion?: boolean;
  /**
   * Suggest mode: a full analysis the pixel check would turn into a text comparison against
   * this anchor (same picture, new text); it moves only once the user confirms the pair.
   */
  pixelSuggested?: string;
}

/**
 * The pixel check as one more input of the planner (plan-analysis-speed item 8). In suggest mode
 * only pairs the user confirmed change anything; in automatic mode the verdict decides. The
 * user's saved answer wins in both modes. Without it (check off): fingerprint only.
 */
export interface PixelInput {
  mode: "suggest" | "automatic";
  /** The verdict of a pair whose anchor is analysed; undefined: not checked (fingerprint rule). */
  verdict: (imageId: string, anchorId: string) => PixelVerdict | undefined;
  /** Pairs the user answered "same screen". */
  same: ReadonlySet<string>;
}

/** Same picture: same shape (within 3%) and a perceptual hash within the near-identical bits. */
export function samePicture(
  a: { phash: string; width: number; height: number },
  b: { phash: string; width: number; height: number },
  maxBits = NEAR_IDENTICAL_BITS,
): boolean {
  if (!a.phash || a.phash.length !== b.phash.length || !a.height || !b.height) return false;
  const ra = a.width / a.height;
  const rb = b.width / b.height;
  if (Math.abs(ra - rb) / Math.max(ra, rb) > 0.03) return false;
  return hamming(a.phash, b.phash) <= maxBits;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export { pairKey };

/**
 * Cost tier per image with the anchor rules of plan-reports 2.1 (code only). Inputs come main
 * country first, then the other countries in the project's order. Cheapest first:
 * 1. identical: the same file already has a usable analysis, or appears earlier in this plan;
 * 2. text layer only: the same picture as an anchor. When the game has that picture in the main
 *    country, that image is always the anchor (added to this plan as a full analysis when it is
 *    not analysed yet); only without a main-country version, the first other country's copy is;
 * 3. full: everything else ("no main-country version" when that is the case).
 * `different` holds image pairs the user marked as different screens: they never match.
 * `pixel` (item 8) widens "same picture" to 14 bits for pairs the user confirmed, and in
 * automatic mode for pairs the pixel check calls the same picture.
 */
export function tierScope(
  inputs: readonly ScopeInput[],
  mainCandidates: ReadonlyMap<string, readonly AnchorCandidate[]>,
  abroadAnalysed: ReadonlyMap<string, readonly AnchorCandidate[]>,
  analysedIds: ReadonlySet<string>,
  mainCountry: string,
  different: ReadonlySet<string> = new Set(),
  pixel?: PixelInput,
  /** App Store images: the other store's pictures as anchors (plan-app-store 4). */
  cross?: CrossStore,
): ScopeItem[] {
  const planned = new Set<string>();
  // Images planned as text comparisons: never an anchor of another (they are not analysed).
  const layered = new Set<string>();
  const out: ScopeItem[] = [];
  const abroad = new Map<string, AnchorCandidate[]>();
  for (const [app, list] of abroadAnalysed) abroad.set(app, [...list]);
  const sameAs = (c: AnchorCandidate, it: ScopeInput): boolean => {
    if (!pixel) return samePicture(c, it);
    if (!samePicture(c, it, PIXEL_MAX_BITS)) return false;
    if (pixel.same.has(pairKey(c.imageId, it.imageId))) return true;
    const v = pixel.mode === "automatic" ? pixel.verdict(it.imageId, c.imageId) : undefined;
    return v ? v !== "different" : samePicture(c, it);
  };
  // A repeated copy (reused, never analysed on its own) cannot anchor others unless analysed.
  const copies = new Set(inputs.filter((i) => i.repeatOf).map((i) => i.imageId));
  const open = (it: ScopeInput, list: readonly AnchorCandidate[] | undefined) =>
    (list ?? []).filter(
      (c) =>
        c.imageId !== it.imageId &&
        !layered.has(c.imageId) &&
        !different.has(pairKey(c.imageId, it.imageId)) &&
        (c.analysed || !copies.has(c.imageId)),
    );
  const suggested = (it: ScopeInput): string | undefined => {
    if (pixel?.mode !== "suggest" || it.main) return undefined;
    return [...open(it, mainCandidates.get(it.appId)), ...open(it, abroad.get(it.appId))]
      .filter((c) => samePicture(c, it, PIXEL_MAX_BITS))
      .filter((c) => pixel.verdict(it.imageId, c.imageId) === "same-new-text")
      .sort((a, b) => hamming(a.phash, it.phash) - hamming(b.phash, it.phash))[0]?.imageId;
  };
  const match = (it: ScopeInput, list: readonly AnchorCandidate[] | undefined) =>
    open(it, list)
      .filter((c) => sameAs(c, it))
      .sort(
        (a, b) =>
          Number(b.analysed || planned.has(b.imageId)) -
            Number(a.analysed || planned.has(a.imageId)) ||
          hamming(a.phash, it.phash) - hamming(b.phash, it.phash),
      )[0];
  for (const it of inputs) {
    // App Store: the same picture as an analysed Play image, apart from file compression.
    if (it.sameAs && (analysedIds.has(it.sameAs) || planned.has(it.sameAs))) {
      const reason = "the same picture as a Google Play image (only file compression differs)";
      out.push({ ...it, tier: "identical", basedOn: it.sameAs, reason });
      continue;
    }
    if (analysedIds.has(it.imageId)) {
      out.push({ ...it, tier: "identical", basedOn: it.imageId, reason: "already analysed" });
      continue;
    }
    // The same screen in another size in this deck: its earlier copy's reading is reused.
    if (it.repeatOf) {
      const reason = repeatReason(it.repeatOf.position);
      out.push({ ...it, tier: "identical", basedOn: it.repeatOf.imageId, reason });
      continue;
    }
    if (planned.has(it.imageId)) {
      out.push({
        ...it,
        tier: "identical",
        basedOn: it.imageId,
        reason: "the same image appears earlier in this report",
      });
      continue;
    }
    if (!it.main) {
      const anchor = match(it, mainCandidates.get(it.appId));
      if (anchor) {
        if (!anchor.analysed && !planned.has(anchor.imageId)) {
          planned.add(anchor.imageId);
          const { analysed: _analysed, ...a } = anchor;
          out.push({
            ...a,
            main: true,
            tier: "full",
            basedOn: null,
            anchorAdded: true,
            reason: `analysed once in ${mainCountry}, so the other countries only need their text compared`,
          });
        }
        layered.add(it.imageId);
        out.push({
          ...it,
          tier: "layer-diff",
          basedOn: anchor.imageId,
          reason: `same picture as ${anchor.analysed ? "the analysed" : "the"} image in ${mainCountry}, new text`,
        });
        continue;
      }
      const other = match(it, abroad.get(it.appId));
      if (other) {
        layered.add(it.imageId);
        out.push({
          ...it,
          tier: "layer-diff",
          basedOn: other.imageId,
          noMainVersion: true,
          reason: `same picture as the image in ${theCountry(other.country)} (no main-country version), new text`,
        });
        continue;
      }
    }
    const other =
      cross && it.platform === "appstore"
        ? crossMatch(it, { samePicture: sameAs, ...cross }, open, planned)
        : null;
    if (other?.tier === "layer-diff") {
      layered.add(it.imageId);
      out.push(other);
      continue;
    }
    planned.add(it.imageId);
    const noMain = !it.main && !other;
    const pixelSuggested = other?.pixelSuggested ?? suggested(it);
    out.push({
      ...it,
      tier: "full",
      basedOn: null,
      ...(noMain ? { noMainVersion: true } : {}),
      ...(pixelSuggested ? { pixelSuggested } : {}),
      reason: other
        ? other.reason
        : noMain
          ? "no main-country version: full analysis"
          : "not analysed before",
    });
    if (noMain) abroad.set(it.appId, [...(abroad.get(it.appId) ?? []), { ...it, analysed: false }]);
  }
  return out;
}
