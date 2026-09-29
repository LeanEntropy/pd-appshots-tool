import { appleRulesPrompt, titleArtProblems, variantTitleArtProblems } from "./apple-rules.ts";
import { PPO_LIMITS, PPO_METRIC } from "./ppo.ts";

/**
 * The App Store's part of the written steps (plan-app-store 7.1): Apple's rules as facts for the
 * recommendations and A/B tests (hard rules as constraints, review risks avoided), and the code
 * checks that refuse an answer breaking Guideline 2.3.3. Google Play reports get nothing here, so
 * their prompts, checks and cached answers stay exactly as before.
 */
export type Store = "play" | "appstore" | undefined;

export const storeFacts = (store: Store): string[] =>
  store === "appstore" ? [appleRulesPrompt()] : [];

export const storeProblems = (
  store: Store,
  positions: readonly { position: number; screenType: string }[],
): string[] => (store === "appstore" ? titleArtProblems(positions) : []);

export const storeVariantProblems = (
  store: Store,
  slots: readonly { position: number; screen: string }[],
): string[] => (store === "appstore" ? variantTitleArtProblems(slots) : []);

/** The A/B tests task on the App Store: Product Page Optimization instead of Play experiments. */
export function abStoreLines(store: Store): string[] {
  if (store !== "appstore") return [];
  return [
    `These tests run on the App Store as Product Page Optimization tests: up to ${PPO_LIMITS.maxTreatments} treatments against the original (write a variant and at most one second variant), one test at a time for up to ${PPO_LIMITS.maxDays} days, per localisation, reviewed by App Review before the start. The metric is Apple's ${PPO_METRIC.name.toLowerCase()} (answer "installs" in the metric field).`,
    appleRulesPrompt(),
  ];
}
