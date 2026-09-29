import type { Entry } from "./schema.ts";

/**
 * What each AI step asks of the knowledge base (plan section 3 and 4.1): the facets it needs,
 * each with a minimum and maximum share of its token budget, the tags it always asks for, and the
 * mandatory material (enforced store rules, the country's regulation notes) that uses a reserved
 * part of the budget. Budgets are in tokens at the "normal" preset.
 */
export const KB_STEPS = ["patterns", "recommend", "abTests", "countryAdvice"] as const;
export type KbStep = (typeof KB_STEPS)[number];

export const FACETS = [
  "store_rules",
  "heuristics",
  "genre",
  "market",
  "regulation",
  "cases",
  "glossary",
] as const;
export type Facet = (typeof FACETS)[number];

export interface FacetShare {
  facet: Facet;
  min: number;
  max: number;
}

export interface StepSpec {
  budget: number;
  facets: FacetShare[];
  baseTags: string[];
  /** Enforced store rules always go in (reserved part). */
  enforced: boolean;
  /** The step country's regulation notes always go in (reserved part). */
  regulation: boolean;
  reserved: number;
  /** Plain name for the approval and the "how we built this" note. */
  label: string;
}

export const REGULATION_TAGS = new Set([
  "regulation",
  "advertising_law",
  "loot_box_disclosure",
  "age_rating",
]);

export function facetOf(e: Entry): Facet {
  switch (e.kind) {
    case "store_fact":
      return "store_rules";
    case "heuristic":
      return "heuristics";
    case "genre_note":
      return "genre";
    case "ab_case":
      return "cases";
    case "glossary":
      return "glossary";
    default:
      return e.tags.some((t) => REGULATION_TAGS.has(t)) ? "regulation" : "market";
  }
}

export const STEP_SPECS: Record<KbStep, StepSpec> = {
  patterns: {
    label: "Pattern wording",
    budget: 1500,
    facets: [
      { facet: "heuristics", min: 0.3, max: 0.8 },
      { facet: "genre", min: 0.2, max: 0.7 },
    ],
    baseTags: ["genre_convention", "screenshots", "order", "first_images"],
    enforced: false,
    regulation: false,
    reserved: 0,
  },
  recommend: {
    label: "Recommendations and their check",
    budget: 4000,
    facets: [
      { facet: "store_rules", min: 0.2, max: 0.5 },
      { facet: "heuristics", min: 0.2, max: 0.5 },
      { facet: "market", min: 0.05, max: 0.3 },
      { facet: "genre", min: 0.05, max: 0.25 },
    ],
    baseTags: [
      "screenshots",
      "first_images",
      "order",
      "captions",
      "policy_graphics",
      "orientation",
      "legibility",
    ],
    enforced: true,
    regulation: false,
    reserved: 1200,
  },
  abTests: {
    label: "A/B tests",
    budget: 3000,
    facets: [
      { facet: "store_rules", min: 0.2, max: 0.5 },
      { facet: "cases", min: 0.15, max: 0.5 },
      { facet: "heuristics", min: 0.1, max: 0.4 },
    ],
    baseTags: [
      "experiments",
      "test_duration",
      "test_power",
      "test_win_rate",
      "ppo",
      "custom_listing",
    ],
    enforced: true,
    regulation: false,
    reserved: 800,
  },
  countryAdvice: {
    label: "Country advice and its check",
    budget: 3000,
    facets: [
      { facet: "market", min: 0.3, max: 0.7 },
      { facet: "glossary", min: 0, max: 0.2 },
      { facet: "store_rules", min: 0, max: 0.3 },
    ],
    baseTags: [
      "localisation",
      "script",
      "typography",
      "lingo",
      "cultural_adaptation",
      "events",
      "seasonal",
      "text_density",
      "social_proof",
    ],
    enforced: true,
    regulation: true,
    reserved: 800,
  },
};

export const PRESETS = { small: 0.6, normal: 1, large: 1.5 } as const;
export type Preset = keyof typeof PRESETS;

/** A step's token budget and reserved part at a preset. */
export function budgetOf(step: KbStep, preset: Preset): { budget: number; reserved: number } {
  const s = STEP_SPECS[step];
  const k = PRESETS[preset];
  return { budget: Math.round(s.budget * k), reserved: Math.round(s.reserved * k) };
}

/** Rough token count of a text (about 4 characters per token; CJK counts more). */
export function tokensOf(text: string): number {
  let wide = 0;
  for (const ch of text) if ((ch.codePointAt(0) ?? 0) > 0x2e80) wide++;
  return Math.ceil((text.length - wide) / 4 + wide);
}
