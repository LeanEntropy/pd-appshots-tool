import type { StoreOfficial } from "../play/store-text.ts";
import type { Level } from "./directives.ts";
import type { Leaders } from "./leaders.ts";
import { type Evidence, type Game, isDirective, strengthOf } from "./strength.ts";

/**
 * Store listing directives (plan 5.7), per country and language, by code at no cost. Tags and
 * category are app-level (the same chips in every country, translated): counted once per game,
 * matched by their English name. Title, short and long description are per country-language.
 * Tag directives are "candidates" until the Play Console tag limit is confirmed (D9). A category
 * switch is RECOMMENDED when ours differs from the majority and from the leaders (D4).
 */
export const LIMITS = { title: 30, short: 80, description: 4000 } as const;
/** Assumed until confirmed in Play Console (D9). */
export const TAG_LIMIT = 5;

export type MetaField = "tags" | "category" | "title" | "short" | "description";

export interface MetaDirective {
  id: string;
  field: MetaField;
  level: Level;
  /** Tags: shown as candidates until D9 is confirmed. */
  candidate: boolean;
  evidence: Evidence;
  title: string;
  text: string;
  /** Concrete values: tag names, terms, themes (local name, then the English one). */
  values: string[];
  notes: string[];
}

export interface MetaGroup {
  hl: string;
  /** "United States, Australia, ... (English)" */
  label: string;
  markets: string[];
  directives: MetaDirective[];
}

export interface MetaResult {
  appLevel: MetaDirective[];
  groups: MetaGroup[];
  notes: string[];
}

export interface MetaInput {
  markets: readonly { gl: string; hl: string; label: string }[];
  ours: Game;
  competitors: readonly Game[];
  text: (appId: string, gl: string, hl: string) => StoreOfficial | null;
  leaders: Leaders;
}

const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
/** Characters as the store counts them (graphemes, whitespace normalised). */
export const chars = (s: string) => [...seg.segment(s.replace(/\s+/g, " ").trim())].length;

/** The tag chips (the first chip with an id is a category, not a tag). */
export const tagsOf = (o: StoreOfficial) =>
  o.chips.slice(o.chips[0]?.id ? 1 : 0).map((c) => c.name);

export const levelFor = (e: Evidence): Level => {
  const s = strengthOf(e);
  return s === "consider"
    ? "consider"
    : isDirective(s)
      ? s === "provisional"
        ? "provisional"
        : "directive"
      : "test";
};
