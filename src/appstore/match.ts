import type { AppleApp } from "./api.ts";
import type { Candidate, Match } from "./data.ts";

/**
 * Google Play game → App Store app, per storefront (plan-app-store 1.3), code only:
 * 1. the Play package as a bundle id. Exactly the same id (letter case included) with a seller
 *    that matches the Play developer is accepted automatically. Anything weaker (only the case
 *    differs, or another seller) waits for the user's confirmation.
 * 2. otherwise a name search: candidates scored on name and seller; they always wait for the
 *    user, never guessed. No candidate at all is "not found" (checked again next time).
 */
const LEGAL =
  /\b(co|company|corp|corporation|inc|incorporated|llc|ltd|limited|pte|pty|gmbh|sa|sas|bv|ab|oy|kk|plc|srl|jsc|holdings?)\b/g;

export function normaliseSeller(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[.,'’"()&+/\\_-]/g, " ")
    .replace(LEGAL, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One normalised name contains the other as whole words (both at least 3 letters). */
export function sellerMatches(
  playDeveloper: string,
  app: Pick<AppleApp, "sellerName" | "artistName">,
): boolean {
  const p = normaliseSeller(playDeveloper);
  if (p.length < 3) return false;
  return [app.sellerName, app.artistName].some((s) => {
    const a = normaliseSeller(s);
    if (a.length < 3) return false;
    // Whole words only: "habby" is in "habby games", "hab" is not in "habby".
    const [short, long] = a.length <= p.length ? [a, p] : [p, a];
    return ` ${long} `.includes(` ${short} `);
  });
}

/** The first part of a two-part store title ("Name - ASO words" → "Name"), normalised. */
export function normaliseName(s: string): string {
  const first = s.split(/\s[-–—:|]\s|[:：|]/)[0] ?? s;
  return first
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function nameMatches(playName: string, appName: string): boolean {
  const a = normaliseName(playName);
  const b = normaliseName(appName);
  return a.length >= 3 && b.length >= 3 && (a === b || a.includes(b) || b.includes(a));
}

export interface PlayGame {
  appId: string;
  name: string;
  developer: string;
}

export function candidateOf(app: AppleApp, play: PlayGame, signals: string[]): Candidate {
  return {
    trackId: app.trackId,
    bundleId: app.bundleId,
    trackName: app.trackName,
    sellerName: app.sellerName || app.artistName,
    iconUrl: app.iconUrl,
    firstScreenshot: app.screenshotUrls[0] ?? "",
    signals,
    sellerMatch: sellerMatches(play.developer, app),
  };
}

const base = (now: string): Pick<Match, "checkedAt" | "candidates" | "evidence"> => ({
  checkedAt: now,
  candidates: [],
  evidence: [],
});

/** Step 1: the result of the bundle-id lookup in this storefront, or null to go on to search. */
export function matchByBundle(
  play: PlayGame,
  found: readonly AppleApp[],
  now: string,
): Match | null {
  const hit = found.find((a) => a.bundleId.toLowerCase() === play.appId.toLowerCase());
  if (!hit) return null;
  const exact = hit.bundleId === play.appId;
  const seller = sellerMatches(play.developer, hit);
  const signals = [exact ? "same bundle id" : "same bundle id apart from letter case"];
  if (seller) signals.push("same developer");
  const c = candidateOf(hit, play, signals);
  if (exact && seller)
    return {
      ...base(now),
      status: "matched",
      trackId: hit.trackId,
      bundleId: hit.bundleId,
      sellerName: c.sellerName,
      trackName: hit.trackName,
      confidence: "high",
      evidence: signals,
      candidates: [c],
      source: "bundle",
      auto: true,
    };
  return {
    ...base(now),
    status: "needs_confirmation",
    confidence: seller ? "high" : "medium",
    evidence: signals,
    candidates: [c],
    source: "bundle",
  };
}

/** Step 2: name-search results → candidates for the user (never accepted automatically). */
export function matchBySearch(play: PlayGame, found: readonly AppleApp[], now: string): Match {
  const scored = found
    .map((a) => {
      const signals: string[] = [];
      if (nameMatches(play.name, a.trackName)) signals.push("same name");
      if (sellerMatches(play.developer, a)) signals.push("same developer");
      return { a, signals };
    })
    .filter((x) => x.signals.length > 0)
    .sort((x, y) => y.signals.length - x.signals.length)
    .slice(0, 5);
  if (!scored.length)
    return { ...base(now), status: "not_found", confidence: "none", source: "search" };
  const best = scored[0] as (typeof scored)[number];
  return {
    ...base(now),
    status: "needs_confirmation",
    confidence: best.signals.length >= 2 ? "medium" : "low",
    evidence: best.signals,
    candidates: scored.map((x) => candidateOf(x.a, play, x.signals)),
    source: "search",
  };
}

/** A storefront where the game's known app (matched elsewhere by its bundle id) is not sold. */
export function notSoldHere(now: string, where: string): Match {
  return {
    ...base(now),
    status: "not_found",
    confidence: "none",
    evidence: [`its App Store app (matched in ${where}) is not sold in this country`],
    source: "bundle",
  };
}

export function fetchFailed(now: string, error: string): Match {
  return {
    ...base(now),
    status: "fetch_failed",
    confidence: "none",
    evidence: [error],
    source: "bundle",
  };
}
