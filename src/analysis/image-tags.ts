import { namesBrand } from "./brand.ts";
import { categoryOf, isArtCategory } from "./categories.ts";
import type { ImageAnalysis } from "./schema.ts";

/**
 * Tags on top of the screen category, from the stored analysis fields only (texts with their
 * roles, logo elements, subtypes): no re-analysis. `title` is the game's name or store title;
 * only its brand part (brand.ts) counts as the game's name.
 */
export type ArtMessage = "logo_only" | "headline" | "event_offer" | "showcase" | "picture_only";

const LOGO_SUBTYPES = new Set(["title_logo", "logo_with_art", "logo_only"]);
/** The model's own words for the game's logo (not a publisher's or partner's). */
const GAME_LOGO = /\bgame'?s? (?:logo|title|wordmark)\b|\btitle (?:logo|wordmark)\b/i;

/** The game's own logo or name is drawn on the image. */
export function showsLogo(a: ImageAnalysis, title: string): boolean {
  const s = a.screenshot;
  const m = a.marketingLayer;
  if (s.screenType === "title_image" || LOGO_SUBTYPES.has(s.subtype)) return true;
  if (
    m.elements.some(
      (e) => e.kind === "logo" && (namesBrand(e.what, title) || GAME_LOGO.test(e.what)),
    )
  )
    return true;
  return m.texts.some((t) => namesBrand(t.text, title));
}

/** Marketing texts other than the game's own name (the "line" the image carries). */
export function lines(a: ImageAnalysis, title: string): string[] {
  return a.marketingLayer.texts
    .filter((t) => t.role !== "legal" && !namesBrand(t.text, title))
    .map((t) => t.text.trim())
    .filter((t) => /[\p{L}\p{N}]/u.test(t));
}

/** Time-limited lines: reported, never recommended to copy. */
const EVENT =
  /\b(?:anniv\w*|celebrat\w*|\d+(?:st|nd|rd|th)? ?years?\b|years? together|gift ?codes?|codes?:|(?:new player|login|free|daily) rewards?|\d[\d,.]*k? ?(?:free )?(?:summons?|draws?|pulls?|diamonds?|gems?)|day ?\d+|limited[- ]time|event|pre-?regist\w*|collab\w*|new season)\b/i;
export const isEventLine = (text: string) => EVENT.test(text);
const VS = /(?:^|\s)vs\.?(?:\s|$)/i;
const HEROES = new Set(["character", "creature"]);

/** What the art's line says (for full-screen art; other screens get it too, for the stats). */
export function artMessage(a: ImageAnalysis, title: string): ArtMessage {
  const said = lines(a, title);
  const logo = showsLogo(a, title);
  if (said.some((t) => EVENT.test(t))) return "event_offer";
  if (said.some((t) => VS.test(` ${t} `))) return "showcase";
  const heroes =
    a.screenshot.subtype === "character_showcase" ||
    a.marketingLayer.elements.some((e) => HEROES.has(e.kind));
  // Heroes with only labels or badges (no headline) are a showcase: the text is a label.
  const selling = a.marketingLayer.texts.some(
    (t) => (t.role === "headline" || t.role === "subheadline") && !namesBrand(t.text, title),
  );
  if (said.length) return heroes && !selling ? "showcase" : "headline";
  if (logo) return "logo_only";
  return heroes ? "showcase" : "picture_only";
}

/** An image with its game's name, as the pattern code sees it. */
export interface Tagged {
  appId: string;
  name: string;
  position: number;
  final: ImageAnalysis;
}

export interface TagStats {
  /** Images showing the game logo per position (all screen types). */
  logoPerPosition: { position: number; n: number; of: number }[];
  /** Per competitor: images with the logo, and whether one of the first 3 has it. */
  logoPerGame: { name: string; n: number; of: number; firstThree: boolean }[];
  /** Full-screen art images: what their line says, and how many show the logo. */
  art: { n: number; withLogo: number; messages: { key: ArtMessage; n: number }[] };
}

export function tagStats(entries: readonly Tagged[]): TagStats {
  const maxPos = Math.max(0, ...entries.map((e) => e.position));
  const logo = (e: Tagged) => showsLogo(e.final, e.name);
  const logoPerPosition = [];
  for (let p = 1; p <= maxPos; p++) {
    const at = entries.filter((e) => e.position === p);
    if (at.length) logoPerPosition.push({ position: p, n: at.filter(logo).length, of: at.length });
  }
  const games = [...new Set(entries.map((e) => e.appId))];
  const logoPerGame = games.map((id) => {
    const mine = entries.filter((e) => e.appId === id);
    return {
      name: mine[0]?.name ?? id,
      n: mine.filter(logo).length,
      of: mine.length,
      firstThree: mine.some((e) => e.position <= 3 && logo(e)),
    };
  });
  const art = entries.filter((e) => isArtCategory(categoryOf(e.final)));
  const m = new Map<ArtMessage, number>();
  for (const e of art) {
    const k = artMessage(e.final, e.name);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return {
    logoPerPosition,
    logoPerGame,
    art: {
      n: art.length,
      withLogo: art.filter(logo).length,
      messages: [...m.entries()]
        .map(([key, n]) => ({ key, n }))
        .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)),
    },
  };
}
