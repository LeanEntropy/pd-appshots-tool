import type { CostTier } from "../analysis/tiers.ts";
import { hamming, NEAR_IDENTICAL_BITS } from "../store/identity.ts";
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
}

export interface ScopeItem extends ScopeInput {
  tier: CostTier;
  /** identical: the image reused; layer-diff: the anchor its text is compared with. */
  basedOn: string | null;
  /** Why, in plain words (shown in the list of images). */
  reason: string;
  /** A main-country image added to this plan only to anchor other countries (decision D2). */
  anchorAdded?: boolean;
  /** The game has no main-country version of this picture. */
  noMainVersion?: boolean;
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
 */
export function tierScope(
  inputs: readonly ScopeInput[],
  mainCandidates: ReadonlyMap<string, readonly AnchorCandidate[]>,
  abroadAnalysed: ReadonlyMap<string, readonly AnchorCandidate[]>,
  analysedIds: ReadonlySet<string>,
  mainCountry: string,
  different: ReadonlySet<string> = new Set(),
): ScopeItem[] {
  const planned = new Set<string>();
  const out: ScopeItem[] = [];
  const abroad = new Map<string, AnchorCandidate[]>();
  for (const [app, list] of abroadAnalysed) abroad.set(app, [...list]);
  const match = (it: ScopeInput, list: readonly AnchorCandidate[] | undefined) =>
    (list ?? [])
      .filter((c) => c.imageId !== it.imageId && !different.has(pairKey(c.imageId, it.imageId)))
      .filter((c) => samePicture(c, it))
      .sort(
        (a, b) =>
          Number(b.analysed || planned.has(b.imageId)) -
            Number(a.analysed || planned.has(a.imageId)) ||
          hamming(a.phash, it.phash) - hamming(b.phash, it.phash),
      )[0];
  for (const it of inputs) {
    if (analysedIds.has(it.imageId)) {
      out.push({ ...it, tier: "identical", basedOn: it.imageId, reason: "already analysed" });
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
    planned.add(it.imageId);
    const noMain = !it.main;
    out.push({
      ...it,
      tier: "full",
      basedOn: null,
      ...(noMain ? { noMainVersion: true } : {}),
      reason: noMain ? "no main-country version: full analysis" : "not analysed before",
    });
    if (noMain) abroad.set(it.appId, [...(abroad.get(it.appId) ?? []), { ...it, analysed: false }]);
  }
  return out;
}
