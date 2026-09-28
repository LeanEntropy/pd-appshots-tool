import type { ReportScope } from "./types.ts";

/** One raw signal (plan-reports 5A.2), before ranking and dismissals. */
export interface Signal {
  /** Stable identity: the kind of signal plus its games and countries. */
  key: string;
  /** Kind of signal; a dismissed suggestion comes back only when this changes. */
  category: "full-check" | "regenerate" | "pick-gap" | "localise" | "same" | "weak" | "charts";
  title: string;
  why: string;
  what: string;
  value: number;
  /** Planner cost (code only): images to analyse and the cost range. Null: free. */
  cost: { images: number; usd: [number, number] } | null;
  action: { label: string; scope?: ReportScope; href?: string } | null;
  second: { label: string; scope: ReportScope } | null;
  older: boolean;
  countryIndex: number;
  competitorIndex: number;
}

export const POINTS = {
  version: "suggest-points.v1",
  pickGapPerDeck: 5,
  weakPattern: 3,
  weakPatternFirstThree: 1,
  localiseBase: 1,
  localiseShare: 4,
  defaultCountry: 1,
  noFullCheck: 8,
  chartTop10: 2,
  chartTop50: 1,
  regenerateFirst: 20,
} as const;
export const DEFAULT_COUNTRIES = ["jp", "kr", "tw", "hk", "th", "vn", "id", "ph"];

/** "A", "A and B", "A, B and C". */
export const list = (xs: readonly string[]) =>
  xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
