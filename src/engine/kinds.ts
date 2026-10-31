import { categoryOf, isArtCategory, PROMO_BANNER } from "../analysis/categories.ts";
import type { DeckEntry } from "../analysis/patterns.ts";
import type { ImageAnalysis } from "../analysis/schema.ts";

/**
 * The comparison grain of the recommendation engine (plan-recommendation-engine 5.1): a family
 * between the report category and the subtype, decided by a code table. Victory and Board are
 * both "Gameplay" as a category, but different kinds (result_reward vs core_play).
 */
export type Kind =
  | "core_play"
  | "result_reward"
  | "progression"
  | "collection"
  | "social"
  | "map"
  | "title_art"
  | "promo_banner"
  | "content_showcase"
  | "lifestyle"
  | "shop"
  | "other";

export const KIND_LABEL: Record<Kind, string> = {
  core_play: "Gameplay screenshot",
  result_reward: "Result or reward screen",
  progression: "Progression or upgrade menu",
  collection: "Collection or roster",
  social: "Social screen",
  map: "Map or world",
  title_art: "Title screen / full-screen art",
  promo_banner: "Promotional banner",
  content_showcase: "Content showcase",
  lifestyle: "Lifestyle / in-context scene",
  shop: "Shop or offer",
  other: "Other",
};

/** Kinds with no definition never drive a directive (same rule as categories.ts). */
export const DEFINED = (k: Kind) => k !== "other";

/** Subtype to kind, per category. A subtype not listed takes its category's default. */
const BY_SUBTYPE: Record<string, Kind> = {
  victory: "result_reward",
  defeat: "result_reward",
  idle_rewards: "result_reward",
  reward_showcase: "result_reward",
  login_rewards: "result_reward",
  battle_pass: "result_reward",
  event: "result_reward",
  character_roster: "collection",
  pets: "collection",
  gacha_summon: "collection",
  character_showcase: "collection",
  player_profile: "social",
  base_town: "progression",
};

const BY_CATEGORY: Record<string, Kind> = {
  gameplay: "core_play",
  metagame: "progression",
  map_world: "map",
  social: "social",
  events_rewards: "result_reward",
  iap: "shop",
  promo: "content_showcase",
};

/** The screen category and, for a game screen, its subtype (the largest capture of it). */
export function categoryAndSubtype(a: ImageAnalysis): { category: string; subtype: string } {
  const category = categoryOf(a);
  const s = a.screenshot;
  if (isArtCategory(category)) return { category, subtype: s.subtype };
  if (s.screenType === category) return { category, subtype: s.subtype };
  const c = [...s.captures]
    .sort((x, y) => y.areaPercent - x.areaPercent)
    .find((x) => x.screenType === category);
  return { category, subtype: c?.subtype ?? "" };
}

/** Kind from the category and subtype alone (no pixel or attribute check). */
export function kindOfType(category: string, subtype: string): Kind {
  if (category === PROMO_BANNER) return "promo_banner";
  if (isArtCategory(category)) return "title_art";
  if (category !== "gameplay" && category !== "metagame" && BY_CATEGORY[category])
    return BY_CATEGORY[category] as Kind;
  return BY_SUBTYPE[subtype] ?? BY_CATEGORY[category] ?? "other";
}

export interface KindReading {
  kind: Kind;
  category: string;
  subtype: string;
  /** Why code changed the kind the analysis gives (a validator flag); empty when it did not. */
  flags: string[];
}

/**
 * One image's kind, with the logic validators of 5.1: people or a device in the scene make a
 * gameplay-labelled image a lifestyle scene; a banner whose focus is a collection of content
 * (new themes, tile sets) is a content showcase. A flagged image never drives a directive alone.
 */
export function kindOf(e: Pick<DeckEntry, "final" | "focus" | "attrs">): KindReading {
  const { category, subtype } = categoryAndSubtype(e.final);
  let kind = kindOfType(category, subtype);
  const flags: string[] = [];
  const a = e.attrs;
  if (
    (a?.people === "hands" || a?.people === "person" || a?.deviceInScene) &&
    kind !== "title_art"
  ) {
    flags.push(`read as ${kind.replace(/_/g, " ")}, but it shows people or a device in a scene`);
    kind = "lifestyle";
  } else if (kind === "promo_banner" && e.focus === "collection") kind = "content_showcase";
  return { kind, category, subtype, flags };
}

/** Our gameplay screenshot (D3): the only screen a DROP never removes. */
export const isGameplayShot = (k: KindReading) => k.kind === "core_play";

export type Source = "capture" | "capture_layer" | "marketing_art";

/** How the image is produced: an in-game capture, a capture with a layer on top, or art. */
export function sourceOf(e: Pick<DeckEntry, "final">, kind: Kind): Source {
  if (kind === "promo_banner" || kind === "content_showcase") return "marketing_art";
  // A title screen read as an in-game capture is captured from the game, not built as art.
  if (kind === "title_art") {
    const s = e.final.screenshot;
    const captured = s.composition !== "pure_art" && s.captures.length > 0;
    if (!captured) return "marketing_art";
  }
  if (kind === "lifestyle") return "marketing_art";
  return e.final.marketingLayer.present ? "capture_layer" : "capture";
}

export const SOURCE_LABEL: Record<Source, string> = {
  capture: "in-game capture, no layer",
  capture_layer: "in-game capture with a marketing layer",
  marketing_art: "marketing art built from our assets (no in-game capture)",
};
