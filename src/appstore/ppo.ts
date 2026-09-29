import type { TrafficLevel } from "../settings/schema.ts";

/**
 * Apple's Product Page Optimization (plan-app-store 7.3), in one place so a change on Apple's side
 * is one edit. Checked on 2026-09-29 against Apple's PPO pages (APPLE_SOURCE.ppo, ppoCreate,
 * ppoResults; knowledge-base entries ap-041 to ap-049). An A/B test on the App Store is written for
 * Apple, never copied from a Play experiment: up to 3 treatments against the original, one test at
 * a time, at most 90 days, per localisation, reviewed by App Review before it starts.
 */
export const PPO_LIMITS = { maxTreatments: 3, maxDays: 90, testsAtOnce: 1 } as const;

/** What a PPO test can change on the product page (text metadata cannot be tested). */
export const PPO_ELEMENTS = ["screenshots", "app previews", "app icon"] as const;
export type PpoElement = (typeof PPO_ELEMENTS)[number];

export const PPO_METRIC = {
  name: "Conversion rate",
  meaning:
    "First-time downloads per product page impression, per treatment against the original; a result needs at least 90% confidence to show Performing Better or Performing Worse.",
} as const;

export const PPO_GUARDRAIL =
  "Apply a treatment only once App Store Connect marks it Performing Better; applying it ends the test and shows it to everyone.";

/** The lowest traffic of a test's countries (unknown counts as low). */
export function lowestTraffic(levels: readonly TrafficLevel[]): TrafficLevel {
  if (levels.some((l) => l === "low" || l === "unknown")) return "low";
  return levels.includes("medium") ? "medium" : "high";
}

/** Traffic proportion: the share of visitors who see any treatment, split equally among them. */
const PROPORTION: Record<TrafficLevel, number> = { low: 50, unknown: 50, medium: 40, high: 30 };

export interface PpoSetup {
  kind: "ppo";
  languages: string[];
  /** Treatments besides the original (1 to 3). */
  variants: number;
  audiencePercent: number;
  line: string;
  notes: string[];
}

/**
 * The PPO setup of one test, by code: its localisations, 1 to 3 treatments, the traffic
 * proportion by the lowest traffic of the test's countries, and Apple's conditions.
 */
export function ppoSetup(
  localisations: readonly string[],
  treatments: number,
  traffic: TrafficLevel,
  element: PpoElement = "screenshots",
): PpoSetup {
  const n = Math.max(1, Math.min(PPO_LIMITS.maxTreatments, treatments));
  const low = traffic === "low" || traffic === "unknown";
  const variants = low ? 1 : n;
  const pct = PROPORTION[traffic];
  const each = Math.round(pct / variants);
  const where = localisations.length ? localisations.join(", ") : "every localisation of the page";
  const line = `Product Page Optimization test of the ${element} for ${where}; ${variants} ${variants === 1 ? "treatment" : "treatments"} against the original, ${pct}% of visitors (${each}% each).`;
  const notes = [
    `Up to ${PPO_LIMITS.maxTreatments} treatments; the test runs up to ${PPO_LIMITS.maxDays} days and only one test runs at a time, so start with the one with the most leverage.`,
    "App Review checks the treatments before the test starts, and a running test cannot be edited.",
    "Pick only these localisations: every localisation is included by default, and more of them take longer to reach a result.",
    ...(element === "app icon"
      ? ["An icon test needs every alternate icon in the app build first (the next app update)."]
      : []),
    ...(low
      ? [
          `Traffic is ${traffic === "low" ? "low" : "not known (counted as low)"}: one treatment and a larger share, so the test can finish within ${PPO_LIMITS.maxDays} days.`,
        ]
      : []),
  ];
  return {
    kind: "ppo",
    languages: [...localisations],
    variants,
    audiencePercent: pct,
    line,
    notes,
  };
}

/** Why an idea cannot run as a PPO test (it becomes a creative recommendation), or null. */
export function ppoProblem(x: { element: string; treatments: number }): string | null {
  if (!(PPO_ELEMENTS as readonly string[]).includes(x.element))
    return `PPO cannot test the ${x.element} (only screenshots, previews and the icon)`;
  if (x.treatments < 1) return "a test needs at least one treatment";
  if (x.treatments > PPO_LIMITS.maxTreatments)
    return `PPO allows up to ${PPO_LIMITS.maxTreatments} treatments`;
  return null;
}
