import type { Labeler } from "./labels.ts";
import type { ImageAnalysis } from "./schema.ts";

/**
 * The screen categories the reports compare, by code from the stored analyses (no re-analysis).
 *
 * User decision (2026-09-28): every full-screen picture with no game interface is ONE category,
 * "Title screen / full-screen art", whatever the model called it (title image, feature image,
 * key art or loading art) and whether or not it shows the logo. The logo and the line the art
 * carries are tags on top (image-tags.ts), never a category split.
 *
 * Every category and tag a report uses has a definition here; one without a definition never
 * drives a pattern, key point, recommendation or A/B gap (hasDefinition, enforced in
 * pattern-fit.ts and ab-candidates.ts).
 */
export const FULL_SCREEN_ART = "full_screen_art";
export const PROMO = "promo";
/**
 * Wide promotional artwork whose orientation differs from the game's play orientation (user,
 * 2026-10-30). Decided by code (banner.ts); a screen type in memory only, never saved.
 */
export const PROMO_BANNER = "promo_banner";

/** Categories with no game interface: one picture fills the image. */
export const isArtCategory = (c: string | null | undefined) =>
  c === FULL_SCREEN_ART || c === PROMO_BANNER;

/** Taxonomy screen types that describe art or promotion rather than one game screen. */
export const ART_TYPES: ReadonlySet<string> = new Set([
  "title_image",
  "loading_screen",
  "key_art",
  "feature_image",
  "promo",
]);

const ALWAYS_ART: ReadonlySet<string> = new Set(["title_image", "key_art", "loading_screen"]);

/**
 * The report category of one analysed image. A game screen keeps its own type (the marketing
 * text on top does not change it). Art types become full-screen art when one picture fills the
 * image, or promo when the art frames a smaller picture.
 *
 * mapTitleScreen (record-refresh.ts) turns a title image into one 100% in-game capture of type
 * title_image. Both its forms land here as full-screen art, and asCounted() below makes the
 * composition and capture statistics count them as art too (user, 2026-09-29: one category,
 * logo art is not treated differently).
 */
export function categoryOf(a: ImageAnalysis): string {
  const s = a.screenshot;
  if (s.screenType === PROMO_BANNER) return PROMO_BANNER;
  if (!ART_TYPES.has(s.screenType)) return s.screenType;
  // Title, key and loading art are always full-screen art; only feature and promo art can sit
  // on a real game capture.
  if (ALWAYS_ART.has(s.screenType)) return FULL_SCREEN_ART;
  if (s.composition === "pure_art" || !s.captures.length) return FULL_SCREEN_ART;
  const big = [...s.captures].sort((x, y) => y.areaPercent - x.areaPercent)[0];
  if (big && !ART_TYPES.has(big.screenType)) return big.screenType;
  if (
    s.composition === "single_full_capture" ||
    big?.screenType === "title_image" ||
    big?.screenType === "loading_screen"
  )
    return FULL_SCREEN_ART;
  return PROMO;
}

/**
 * An analysis as the composition and capture statistics count it: every image of the Title
 * screen / full-screen art category is full-screen art (no in-game capture), whichever form its
 * analysis has. Other images are returned as they are. In memory only: the stored record and its
 * data fingerprint do not change.
 */
export function asCounted(a: ImageAnalysis): ImageAnalysis {
  const s = a.screenshot;
  if (!isArtCategory(categoryOf(a))) return a;
  if (s.composition === "pure_art" && !s.captures.length && !s.captureAreaPercent) return a;
  return {
    ...a,
    screenshot: { ...s, composition: "pure_art", captures: [], captureAreaPercent: 0 },
  };
}

/** The category of a recommended slot, from its taxonomy screen type alone. */
export function categoryOfType(screenType: string): string {
  if (screenType === PROMO || screenType === PROMO_BANNER) return screenType;
  return ART_TYPES.has(screenType) ? FULL_SCREEN_ART : screenType;
}

export interface Definition {
  key: string;
  label: string;
  /** One plain line: what it is. */
  definition: string;
  /** What sets it apart from the nearest category. */
  unlike: string;
}

const def = (key: string, label: string, definition: string, unlike: string): Definition => ({
  key,
  label,
  definition,
  unlike,
});

/** Screen categories. "other" has no definition on purpose: it never drives a finding. */
export const CATEGORIES: Record<string, Definition> = {
  [FULL_SCREEN_ART]: def(
    FULL_SCREEN_ART,
    "Title screen / full-screen art",
    "One full picture filling the image, usually in the game's own orientation and often its title screen with the logo; no game interface visible.",
    "Unlike a gameplay or menu screen: no buttons, HUD or game UI. Unlike a promotional banner: it has the game's play orientation and works as its opening screen.",
  ),
  [PROMO_BANNER]: def(
    PROMO_BANNER,
    "Promotional banner",
    "Wide promotional artwork (logo, slogan, product or tile art) whose orientation differs from the game's play orientation: a landscape banner in a portrait game; no game interface.",
    "Unlike title screen / full-screen art: it is not shaped like the game's own screens, so it reads as an advert rather than the game's opening screen.",
  ),
  gameplay: def(
    "gameplay",
    "Gameplay",
    "The game being played: a fight, a run, a board or a boss, with the game's own interface.",
    "Unlike a menu screen: the player is in the middle of play.",
  ),
  metagame: def(
    "metagame",
    "Menus and progression",
    "A menu outside of play: heroes, gear, pets, skills, upgrades, base or level progress.",
    "Unlike gameplay: nothing is being played; the player manages or upgrades.",
  ),
  map_world: def(
    "map_world",
    "Map / world",
    "An overview of places, chapters or stages the player picks between.",
    "Unlike gameplay: the player chooses where to go rather than plays there.",
  ),
  social: def(
    "social",
    "Social",
    "Screens about other players: guild, leaderboard, arena, co-op or chat.",
    "Unlike gameplay: the point is the other players.",
  ),
  events_rewards: def(
    "events_rewards",
    "Events and rewards",
    "An in-game event, login reward or battle pass screen.",
    "Unlike Shop / offers: the rewards are earned, not bought.",
  ),
  iap: def(
    "iap",
    "Shop / offers",
    "The in-game shop or a paid offer.",
    "Unlike Events and rewards: it sells something.",
  ),
  [PROMO]: def(
    PROMO,
    "Promo art around a screenshot",
    "Promotional art (a feature, reward or collaboration) around a smaller picture of the game.",
    "Unlike title screen / full-screen art: part of the image is a framed game picture.",
  ),
};

/** Tags on top of the category: the logo, and the line full-screen art carries. */
export const TAGS: Record<string, Definition> = {
  logo: def(
    "logo",
    "Game logo",
    "The game's own logo or name drawn on the image; publisher or partner logos don't count.",
    "Unlike a headline: it names the game rather than selling a feature.",
  ),
  logo_only: def(
    "logo_only",
    "Logo only",
    "The art carries the game's logo and no other line.",
    "Unlike a headline or benefit: nothing is said about the game.",
  ),
  headline: def(
    "headline",
    "Headline or benefit",
    'A line about the genre, the mood or a feature (e.g. "Ultra-casual idle RPG").',
    "Unlike an event or offer: it stays true all year.",
  ),
  event_offer: def(
    "event_offer",
    "Event or offer",
    'An anniversary, rewards, a gift code or a "Day n" line. Reported, never recommended to copy: it is time-limited.',
    "Unlike a headline or benefit: it expires.",
  ),
  showcase: def(
    "showcase",
    "Character or matchup showcase",
    "Heroes or a VS matchup are the subject; any text is only a label.",
    "Unlike a headline or benefit: the picture, not a line, carries the message.",
  ),
  picture_only: def(
    "picture_only",
    "Picture only",
    "A picture with neither the logo nor a line.",
    "Unlike logo only: the game is not named.",
  ),
};

/** Layer structure of an image (layer-structure.ts), each defined like a tag. */
export const LAYER_TAGS: Record<string, Definition> = {
  screenshot_layer: def(
    "screenshot_layer",
    "Screenshot + marketing layer",
    "A game screen with store additions (bands, headlines, badges, characters) on or around it.",
    "Unlike art + marketing layer: the picture underneath is a screen with the game's interface.",
  ),
  screenshot_only: def(
    "screenshot_only",
    "Screenshot only",
    "A game screen with nothing added for the store.",
    "Unlike screenshot + marketing layer: no band, headline or badge was added.",
  ),
  art_layer: def(
    "art_layer",
    "Art + marketing layer",
    "Full-screen art with a separate store addition on top: a band, badge or headline over the art.",
    "Unlike all marketing art: the art stands on its own and the store text sits on top of it.",
  ),
  all_art: def(
    "all_art",
    "All marketing art, no separate layer",
    "The whole image is one designed advert: logo, slogan and product art drawn together, with no band or badge on top.",
    "Unlike art + marketing layer: there is no separate layer to take off; the text is part of the artwork.",
  ),
  art_plain: def(
    "art_plain",
    "Clean art, no marketing layer",
    "Full-screen art with nothing added for the store.",
    "Unlike art + marketing layer: no band, badge or headline on top.",
  ),
};

export const definitionOf = (key: string): Definition | null =>
  CATEGORIES[key] ?? TAGS[key] ?? LAYER_TAGS[key] ?? null;
export const hasDefinition = (key: string) => !!definitionOf(key);

/** Report labels: category names first (also for art taxonomy types), the taxonomy otherwise. */
export function reportLabeler(base: Labeler): Labeler {
  return (code) => {
    const c = definitionOf(code);
    if (c) return c.label;
    if (ART_TYPES.has(code)) return (CATEGORIES[categoryOfType(code)] as Definition).label;
    return base(code);
  };
}

/** "How we sort images": the short part at the start of the patterns section. */
export const HOW_WE_SORT = [
  "Every store image gets one screen type from what fills it. An image that shows a game screen takes that screen's type; the marketing text on top does not change it.",
  "One full picture with no game interface is Title screen / full-screen art, whatever it says and whether or not it shows the logo: studios upload the title screen clean, and title, key, loading and feature art are not reliably told apart.",
  "Such a picture that is wide while the game plays in portrait (the image orientation is measured from the pixels; the play orientation comes from the game's own screens in its other images) is a Promotional banner instead: a landscape advert in a portrait game.",
  "Three tags describe an image further: whether it shows the game's logo, for art what its line says, and its layer structure (a screenshot or art with a separate marketing layer, or all marketing art with none). Findings compare the screen type first, then the orientation, size and tags.",
  "A screen type or tag without a definition below never drives a finding, a recommendation or an A/B test.",
];
