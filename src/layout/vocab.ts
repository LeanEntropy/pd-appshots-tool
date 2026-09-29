/**
 * The layout breakdown's fixed vocabulary (docs/plan-layout-wireframes.md 2.1). Changing a role
 * list or the cap is a new layout contract (LAYOUT_CONTRACT), which makes saved layouts
 * "outdated", never the core analysis.
 */

/** What the layout asks for; part of every layout key. */
// v2 (2026-09-29): logo and badge elements may carry their own text; every band separately.
// v3 (2026-09-29): only what defines the composition, one shape per subject and per repeated
// card/slot/row; notes carry who it is and its look; caps 16 in-game, 10 marketing.
export const LAYOUT_CONTRACT = "layout.v3";
/** Shape of the saved layout; part of every layout key. */
// v2 (2026-09-29): composition.focus, marketingCovers, focusMatch and reinforcement.
export const LAYOUT_SCHEMA_VERSION = "layout-schema.v2";

/**
 * Cost of one layout call per newly analysed image, low and high (benchmark 2026-09-29 for
 * layout.v2: $0.09 to $0.14 with a warm prompt cache; the first call of a batch also writes the
 * prompt, about $0.07). layout.v3 may ask for more boxes and longer notes: about 100 output
 * tokens (~$0.005) per extra box, so the high end is raised; not benchmarked yet.
 */
export const LAYOUT_USD_PER_IMAGE: readonly [number, number] = [0.09, 0.2];

/**
 * At most this many boxes per layer (D4 was 8 per layer; raised 2026-09-29 so a grid screen can
 * give one box per card and one shape per character).
 */
export const MAX_IN_GAME = 16;
export const MAX_MARKETING = 10;
/** Longest note: who or what the element is, its colours, expression, costume and pose. */
export const MAX_NOTE = 160;

/**
 * What a screenshot was chosen to highlight (its focus): the input for "image 2 focuses on
 * progression for 4 of 8 competitors" patterns.
 */
export const FOCUS_KINDS = [
  "battle",
  "progression",
  "character roster",
  "character showcase",
  "gear / upgrade",
  "rewards",
  "collection",
  "map / world",
  "social",
  "shop / offer",
  "story / art",
  "other",
] as const;

/**
 * Whether the marketing layer (headline first) says what the screenshot shows. A mismatch on
 * our own image is an improvement point in the report; on competitors' images only a count.
 */
export const FOCUS_MATCH = ["match", "partial", "mismatch", "no marketing layer"] as const;

export const IN_GAME_ROLES = [
  "hud",
  "nav-bar",
  "main-scene",
  "character",
  "panel",
  "dialog",
  "game-text",
  "other",
] as const;

export const MARKETING_ROLES = [
  "band",
  "headline",
  "subline",
  "logo",
  "badge",
  "cut-out",
  "frame",
  "callout",
  "backdrop",
  "other",
] as const;

export type InGameRole = (typeof IN_GAME_ROLES)[number];
export type MarketingRole = (typeof MARKETING_ROLES)[number];
export type LayoutRole = InGameRole | MarketingRole;

/** Plain words for a role (wireframe labels, the (i) popover). */
export const ROLE_LABEL: Record<LayoutRole, string> = {
  hud: "HUD",
  "nav-bar": "Navigation bar",
  "main-scene": "Main scene",
  character: "Character",
  panel: "Panel",
  dialog: "Dialog",
  "game-text": "Game text",
  other: "Other",
  band: "Band",
  headline: "Headline",
  subline: "Subline",
  logo: "Logo",
  badge: "Badge",
  "cut-out": "Character cut-out",
  frame: "Frame",
  callout: "Callout",
  backdrop: "Backdrop",
};

/** Roles drawn and measured as rectangles (snapped to strong edges by the measuring tool). */
export const RECT_ROLES: ReadonlySet<LayoutRole> = new Set([
  "band",
  "frame",
  "dialog",
  "panel",
  "nav-bar",
]);

/** Marketing roles whose text the core reading already transcribed (textRef). */
export const TEXT_ROLES: ReadonlySet<LayoutRole> = new Set([
  "headline",
  "subline",
  "badge",
  "logo",
]);
