import type { PlaySetup } from "../analysis/play-experiments.ts";
import type { PpoSetup } from "../appstore/ppo.ts";
import type { MainDim } from "./group-dims.ts";

/**
 * The "Across countries" group part of a Compare countries report (plan-cross-country 3), all
 * computed by code from the saved position tables; never an AI call. Three kinds of finding:
 * ours (our own pages differ between countries), common (a competitor habit in every country,
 * the main one included) and group (the same competitor games do something in this group that
 * they do not do elsewhere). "descriptive" states the same games doing the same everywhere.
 */
export type FindingKind = "ours" | "common" | "group" | "descriptive";

/** Evidence rules (plan-cross-country 3.4, decision D6). */
export interface GroupRules {
  /** Suggestive: at least this many games changed this way... */
  suggestiveB: number;
  /** ...and at most this many the other way. */
  suggestiveC: number;
  /** Clear: at least this many changed, none the other way. */
  clearB: number;
  /** Common in every country: at least this share of the games with a known value... */
  commonShare: number;
  /** ...and at least this many games, in every country. */
  commonGames: number;
  /** Fewer games with a known value in a group: "not enough games here". */
  minGames: number;
  maxFindings: number;
}

export const DEFAULT_RULES: GroupRules = {
  suggestiveB: 3,
  suggestiveC: 1,
  clearB: 5,
  commonShare: 0.6,
  commonGames: 3,
  minGames: 5,
  maxFindings: 5,
};

export interface CountryShare {
  gl: string;
  label: string;
  isMain: boolean;
  /** Competitors with a "yes" page here, of the competitors with a known value here. */
  yes: number;
  of: number;
  games: string[];
  /** Our page here: yes, no or unknown. */
  ours: boolean | null;
}

export interface Thumb {
  game: string;
  gl: string;
  label: string;
  position: number;
  thumb: string;
  ours: boolean;
}

export interface GroupFinding {
  kind: FindingKind;
  dim: MainDim | "deckLength";
  dimLabel: string;
  /** The group it belongs to ("" for our pages and common findings). */
  group: string;
  title: string;
  text: string;
  strength: "suggestive" | "clear" | null;
  /** Removing one game would weaken it. */
  fewGames: boolean;
  counts: {
    b: number;
    c: number;
    known: number;
    mixed: number;
    changed: string[];
    against: string;
  } | null;
  perCountry: CountryShare[];
  weakest: string | null;
  examples: Thumb[];
  /** Code-drawn schematic (inline SVG), "not measured". */
  sketch: string | null;
}

export interface GroupRecommendation {
  title: string;
  kind: FindingKind;
  /** Plain wording by kind (plan 3.7). */
  text: string;
  countries: string[];
  evidence: string[];
  variable: "screenshot" | "order" | "composition" | "text";
  variableName: string;
  positions: number[];
  hypothesis: string;
  setup: PlaySetup | PpoSetup;
  /** A country's advice that goes the other way (both shown for the user to decide). */
  conflicts: string[];
  sketch: string | null;
}

export interface GroupSection {
  name: string;
  countries: { gl: string; label: string }[];
  suggested: boolean;
  problem: string | null;
  findings: GroupFinding[];
  /** Below the thresholds: one plain line each ("no difference found", "not enough games"). */
  notAPattern: string[];
  exploratory: {
    label: string;
    definition: string;
    perCountry: { label: string; value: string }[];
  }[];
  /** Play Console: how this group gets its own page and test. */
  setup: string;
}

export interface GroupsPart {
  version: "groups.v1";
  main: { gl: string; label: string; note: string };
  bottomLine: string;
  ours: GroupFinding[];
  common: GroupFinding[];
  descriptive: GroupFinding[];
  groups: GroupSection[];
  recommendations: GroupRecommendation[];
  /** The suggested groups (the editor starts from them) and the saved ones. */
  suggested: { name: string; countries: string[] }[];
  saved: { name: string; countries: string[] }[] | null;
  samePages: { gl: string; label: string; as: string }[];
  hint: string | null;
  terms: { term: string; definition: string }[];
  rules: GroupRules;
}
