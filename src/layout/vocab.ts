/**
 * The layout breakdown's fixed vocabulary (docs/plan-layout-wireframes.md 2.1). Changing a role
 * list or the cap is a new layout contract (LAYOUT_CONTRACT), which makes saved layouts
 * "outdated", never the core analysis.
 */

/** What the layout asks for; part of every layout key. */
// v2 (2026-09-29): logo and badge elements may carry their own text; every band separately.
export const LAYOUT_CONTRACT = "layout.v2";
/** Shape of the saved layout; part of every layout key. */
export const LAYOUT_SCHEMA_VERSION = "layout-schema.v1";

/** At most this many boxes per layer (user decision D4, 2026-09-29). */
export const MAX_PER_LAYER = 8;

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
