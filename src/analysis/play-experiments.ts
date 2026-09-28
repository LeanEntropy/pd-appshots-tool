import type { TrafficLevel } from "../settings/schema.ts";

/**
 * Google Play store listing experiments (plan-reports 3B.3), in one place so a change on
 * Google's side is one edit. Checked on 2026-09-28 against "Run A/B tests on your store listing"
 * (support.google.com/googleplay/android-developer/answer/6227309) and the store listing
 * experiments guide (answer/12053285). Older names seen elsewhere ("first-time installers",
 * "retained first-time installers") appear to be earlier names of these metrics.
 */
export const PLAY_SOURCE = {
  pages: [
    "https://support.google.com/googleplay/android-developer/answer/6227309",
    "https://support.google.com/googleplay/android-developer/answer/12053285",
  ],
  checked: "2026-09-28",
} as const;

export const PLAY_METRICS = {
  installs: {
    name: "Unique user install clicks",
    meaning:
      "The number of users who installed your app, who didn't have it installed on any other devices at the time.",
  },
  opens: {
    name: "Unique user open clicks",
    meaning: "The number of installed users who opened your app.",
  },
  preRegistration: {
    name: "Unique user pre-registration clicks",
    meaning: "Only for games in pre-registration.",
  },
} as const;
export type PlayMetric = keyof typeof PLAY_METRICS;

/**
 * The target metrics a test may use: install clicks, the primary metric of every test (listed
 * first); pre-registration clicks are offered only for a game in pre-registration.
 */
export const allowedMetrics = (preRegistration: boolean): PlayMetric[] =>
  preRegistration ? ["installs", "preRegistration"] : ["installs"];

/** The guardrail is a check for the user after the test; the tool never reads Play results. */
export const GUARDRAIL = `After the test, compare ${PLAY_METRICS.opens.name.toLowerCase()} as well as installs for the winning variant in Play Console: more installs with fewer opens suggests the images over-promise.`;

/** Up to 2 variants per experiment; localised experiments cover up to five languages. */
export const PLAY_LIMITS = { maxVariants: 2, maxLanguages: 5 } as const;

/** What one test changes: exactly one of these (Google also advises one asset at a time). */
export const TEST_VARIABLES = ["screenshot", "order", "text", "composition"] as const;
export type TestVariable = (typeof TEST_VARIABLES)[number];
export const VARIABLE_NAMES: Record<TestVariable, string> = {
  screenshot: "one screenshot",
  order: "the order of the set",
  text: "the text on the images",
  composition: "the composition (layout, orientation or colours)",
};

/**
 * Audience share (the percentage of visitors who see a variant, split equally across the
 * variants) by traffic: the tool's defaults, larger where traffic is low so a test can finish.
 */
const AUDIENCE: Record<TrafficLevel, number> = { low: 50, unknown: 50, medium: 40, high: 30 };
const RANK: Record<TrafficLevel, number> = { low: 0, unknown: 0, medium: 1, high: 2 };

export const isLowTraffic = (t: TrafficLevel) => RANK[t] === 0;

export interface MarketRef {
  gl: string;
  hl: string;
  label: string;
}

export interface PlaySetup {
  kind: "localised" | "custom";
  languages: string[];
  variants: 1 | 2;
  audiencePercent: number;
  /** The setup in one line, plain words. */
  line: string;
  notes: string[];
}

export function languageName(hl: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(hl) ?? hl;
  } catch {
    return hl;
  }
}

/**
 * Where a test runs in Play Console, resolved by code: a localised experiment for the test's
 * languages, or a custom store listing per country when a country of the report shares a
 * language with a test country but is not in the test. Custom listings are the user's setup
 * step (the tool cannot see them). The lowest traffic of the test's countries sets the variants
 * and the audience share.
 */
export function playSetup(
  targets: readonly MarketRef[],
  reportMarkets: readonly MarketRef[],
  projectMarkets: readonly MarketRef[],
  traffic: (gl: string) => TrafficLevel,
  wantsSecondVariant: boolean,
): PlaySetup {
  const langs = [...new Set(targets.map((m) => m.hl))];
  const inTest = new Set(targets.map((m) => m.gl));
  const shares = (list: readonly MarketRef[]) =>
    list.filter((m) => !inTest.has(m.gl) && langs.includes(m.hl));
  const custom = shares(reportMarkets).length > 0;
  const level = targets
    .map((m) => traffic(m.gl))
    .reduce<TrafficLevel>((a, b) => (RANK[b] < RANK[a] ? b : a), "high");
  const variants: 1 | 2 = wantsSecondVariant && !isLowTraffic(level) ? 2 : 1;
  const audiencePercent = AUDIENCE[level];
  const names = langs.map(languageName);
  const where = targets.map((m) => m.label).join(", ");
  const split = `${variants} ${variants === 1 ? "variant" : "variants"}, ${audiencePercent}% of visitors see ${variants === 1 ? "it" : "them"}`;
  const notes: string[] = [];
  let line: string;
  if (custom) {
    line = `Experiment on a custom store listing for ${where}; ${split}.`;
    notes.push(
      `Other countries in this report use the same language (${shares(reportMarkets)
        .map((m) => m.label)
        .join(
          ", ",
        )}), so a custom store listing per country is needed. Set it up in Play Console first; the tool cannot see whether you have one.`,
    );
  } else {
    line = `Localised experiment for ${names.join(", ")} (or a default graphics experiment, if ${names.length === 1 ? "that is" : "one of them is"} your default store listing language); ${split}.`;
    const also = shares(projectMarkets);
    if (also.length)
      notes.push(
        `Visitors in ${also.map((m) => m.label).join(", ")} see the same language, so they are in the test too, unless you run it on a custom store listing for ${where}.`,
      );
  }
  if (langs.length > PLAY_LIMITS.maxLanguages)
    notes.push(
      `A localised experiment covers up to ${PLAY_LIMITS.maxLanguages} languages: split this test into several experiments.`,
    );
  if (isLowTraffic(level))
    notes.push(
      `Traffic is ${level === "unknown" ? "not known (counted as low)" : "low"}: one variant and a larger audience; small differences will end as a draw.`,
    );
  notes.push(
    `Confidence level and minimum detectable effect: keep Play's defaults (advanced settings).`,
  );
  return {
    kind: custom ? "custom" : "localised",
    languages: names,
    variants,
    audiencePercent,
    line,
    notes,
  };
}
