import { reshapedPair } from "../analysis/layer-crops.ts";
import { hamming } from "../store/identity.ts";
import type { AnchorCandidate, ScopeInput, ScopeItem } from "./anchors.ts";
import { pairKey, samePicture } from "./anchors.ts";
import { theCountry } from "./names.ts";

/**
 * App Store images against the other store's pictures (plan-app-store 4, step 3). The perceptual
 * hash only finds candidates; it never decides:
 * - the same shape and the same picture by the planner's own rule (fingerprint, or the pixel
 *   check and the user's answers): a text comparison;
 * - another shape (the App Store's taller format) within `bits`: a text comparison only once the
 *   user confirmed the pair ("Same screen"); until then a full analysis, with the pair offered
 *   for confirmation in the approval (never costed as a text comparison while doubtful).
 */
export interface CrossStore {
  /** Per game: analysed images of either store and any country, and the Play images planned. */
  candidates: ReadonlyMap<string, readonly AnchorCandidate[]>;
  /** Pairs the user answered "same screen". */
  same: ReadonlySet<string>;
  /** Fingerprint distance of a reshaped candidate (calibrated: 20 bits, plan-app-store 6). */
  bits: number;
  /** The planner's own "same picture" (with the pixel check when it is on). */
  samePicture?: (c: AnchorCandidate, it: ScopeInput) => boolean;
}

/** The App Store's 20-bit line for "same capture, new shape" candidates (plan-app-store 6). */
export const RESHAPED_BITS = 20;

const reshaped = (a: AnchorCandidate, b: ScopeInput) => reshapedPair(a, b);

export function crossMatch(
  it: ScopeInput,
  cross: CrossStore,
  open: (it: ScopeInput, list: readonly AnchorCandidate[] | undefined) => AnchorCandidate[],
  planned: ReadonlySet<string>,
): ScopeItem | null {
  const usable = open(it, cross.candidates.get(it.appId))
    .filter((c) => c.analysed || planned.has(c.imageId))
    .filter((c) => c.phash.length === it.phash.length)
    .map((c) => ({ c, bits: hamming(c.phash, it.phash) }))
    .sort(
      (a, b) =>
        Number(b.c.gl === it.gl && b.c.hl === it.hl) -
          Number(a.c.gl === it.gl && a.c.hl === it.hl) ||
        Number(b.c.analysed) - Number(a.c.analysed) ||
        a.bits - b.bits,
    );
  const where = (c: AnchorCandidate) => `${c.store ?? "Google Play"} in ${theCountry(c.country)}`;
  const same = cross.samePicture ?? ((c: AnchorCandidate, x: ScopeInput) => samePicture(c, x));
  const strict = usable.find((x) => !reshaped(x.c, it) && same(x.c, it));
  if (strict)
    return {
      ...it,
      tier: "layer-diff",
      basedOn: strict.c.imageId,
      reason: `same picture as the image on ${where(strict.c)}, new text`,
    };
  const near = usable.filter((x) => reshaped(x.c, it) && x.bits <= cross.bits);
  const confirmed = near.find((x) => cross.same.has(pairKey(x.c.imageId, it.imageId)));
  if (confirmed)
    return {
      ...it,
      tier: "layer-diff",
      basedOn: confirmed.c.imageId,
      reshaped: true,
      reason: `same screen as the image on ${where(confirmed.c)} in another shape (you confirmed it): only the text is compared`,
    };
  const first = near[0];
  if (!first) return null;
  return {
    ...it,
    tier: "full",
    basedOn: null,
    pixelSuggested: first.c.imageId,
    reason: `new picture, or the screen on ${where(first.c)} in another shape: answer Same screen to compare only its text`,
  };
}
