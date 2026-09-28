import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { settingsOf } from "../settings/access.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";
import { type Coverage, coverage } from "./coverage.ts";
import { type Eligibility, eligibility } from "./eligibility.ts";
import { listReports, type ReportSummary } from "./list.ts";
import { planContext } from "./scope-plan.ts";
import { POINTS, type Signal } from "./suggest-points.ts";
import { signals } from "./suggest-signals.ts";

/** A ranked suggestion as the page shows it (plan-reports 5A.3). */
export interface Suggestion extends Omit<Signal, "key"> {
  id: string;
  score: number;
  /** "free", or "12 images, about $2.10 to $3.40". */
  costText: string;
  /** Why it ranks where it does, in words. */
  rankWhy: string;
}

export interface SuggestionsView {
  /** Why there are no suggestions yet (before the Pilot), else null. */
  note: string | null;
  suggestions: Suggestion[];
  dismissed: Suggestion[];
  coverage: Coverage;
  /** "How are these ranked?" */
  rules: string[];
}

const stateKey = (c: { projectId: string }) => projectKey(c, "state", "suggestions.json");
type Dismissed = Record<string, { category: string; at: string }>;

function readDismissed(loaded: LoadedConfig): Dismissed {
  const paths = projectPaths(loaded);
  try {
    const raw = workspaceStorage(paths.workspace).getJson(stateKey(paths)) as
      | { dismissed?: Dismissed }
      | undefined;
    return raw?.dismissed && typeof raw.dismissed === "object" ? raw.dismissed : {};
  } catch {
    return {};
  }
}

const money = (n: number) => `$${n.toFixed(2)}`;
const mid = (s: Signal) => (s.cost ? (s.cost.usd[0] + s.cost.usd[1]) / 2 : 0);

function ranked(list: readonly Signal[]): Suggestion[] {
  return list
    .map((s): Suggestion => {
      const { key, ...rest } = s;
      const m = mid(s);
      const score = s.value / (1 + m);
      const costText = s.cost
        ? `${s.cost.images ? `${s.cost.images} ${s.cost.images === 1 ? "image" : "images"}, ` : ""}about ${money(s.cost.usd[0])} to ${money(s.cost.usd[1])}`
        : "free";
      const value = s.value >= 6 ? "High value" : s.value >= 3 ? "Medium value" : "Some value";
      const cost = !s.cost ? "free" : m < 3 ? `low cost: ${money(m)}` : `cost about ${money(m)}`;
      const rankWhy = s.category === "same" ? "For information" : `${value}; ${cost}`;
      return { ...rest, id: `s-${stableHash(key).slice(0, 12)}`, score, costText, rankWhy };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(!!a.cost) - Number(!!b.cost) ||
        a.countryIndex - b.countryIndex ||
        a.competitorIndex - b.competitorIndex,
    );
}

/** The ranking rules in words (shown under "How are these ranked?"). */
export function rankingRules(loaded: LoadedConfig): string[] {
  const o = settingsOf(loaded.config).suggestions;
  return [
    "Each suggestion's score is its value divided by (1 + its cost in dollars, middle of the range). Free suggestions are divided by 1.",
    `Value: ${POINTS.pickGapPerDeck} per picked competitor not analysed yet; ${POINTS.noFullCheck} when there is no Full check yet; ${POINTS.weakPattern} per weak pattern (+${POINTS.weakPatternFirstThree} for the first three positions); ${POINTS.localiseBase} + ${POINTS.localiseShare} x the share of competitor images changed in a country; +${POINTS.defaultCountry} for the project's usual Asian countries; +${POINTS.chartTop10} where our game is in the top 10 grossing, +${POINTS.chartTop50} in the top 50.`,
    `A country where at least ${Math.round(o.reuseShare * 100)}% of the images are reused from the main country is shown as "skip". A position is weak with fewer than ${o.weakN} games, or when its most common screen is between ${Math.round(o.splitLow * 100)}% and ${Math.round(o.splitHigh * 100)}%. Store data older than ${o.staleDays} days is labelled as older data. These values are on the Settings page.`,
    "A report that is ready and has no newer data removes its suggestion. Ties: free first, then the project's country order.",
  ];
}

/**
 * Suggested next research (plan-reports 5A): code only, no AI and no cost to show. Nothing is
 * started from here: each suggestion opens the builder prefilled, which shows its numbers.
 */
export function suggestionsView(
  loaded: LoadedConfig,
  o: { reports?: ReportSummary[]; e?: Eligibility } = {},
): SuggestionsView {
  const reports = o.reports ?? listReports(loaded);
  const e = o.e ?? eligibility(loaded);
  const ctx = planContext(loaded);
  const map = coverage(loaded, reports, ctx.records);
  const rules = rankingRules(loaded);
  if (!e.pilotReady)
    return {
      note: "Suggestions appear once the Pilot is ready.",
      suggestions: [],
      dismissed: [],
      coverage: map,
      rules,
    };
  const all = ranked(signals(loaded, reports, e, ctx));
  const dismissed = readDismissed(loaded);
  const gone = (s: Suggestion) => dismissed[s.id]?.category === s.category;
  return {
    note: null,
    suggestions: all.filter((s) => !gone(s)),
    dismissed: all.filter(gone),
    coverage: map,
    rules,
  };
}

/** Dismiss or restore one suggestion (by its stable id); false when it is not listed now. */
export function setDismissed(loaded: LoadedConfig, id: string, dismiss: boolean): boolean {
  const v = suggestionsView(loaded);
  const s = [...v.suggestions, ...v.dismissed].find((x) => x.id === id);
  if (!s) return false;
  const paths = projectPaths(loaded);
  const d = readDismissed(loaded);
  if (dismiss) d[id] = { category: s.category, at: new Date().toISOString() };
  else delete d[id];
  workspaceStorage(paths.workspace).putJson(stateKey(paths), { dismissed: d });
  return true;
}

/** What a version keeps of the list at build time (so its markdown and PDF have it). */
export function researchSnapshot(loaded: LoadedConfig): { lines: string[]; saved: unknown } {
  const v = suggestionsView(loaded);
  const top = v.suggestions.filter((s) => s.category !== "same").slice(0, 5);
  const at = new Date().toISOString();
  const lines = [
    "## What to research next",
    "",
    ...(top.length
      ? top.map((s, i) => `${i + 1}. **${s.title}** (${s.costText}). ${s.why}`)
      : [v.note ?? "Nothing to suggest: every gap the tool can see is covered."]),
    "",
  ];
  return {
    lines,
    saved: {
      at,
      items: top.map((s) => ({
        id: s.id,
        title: s.title,
        why: s.why,
        costText: s.costText,
        older: s.older,
      })),
    },
  };
}
