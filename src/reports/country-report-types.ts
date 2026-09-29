import type { CountryAdvice } from "../analysis/country-advice-schema.ts";
import type { ReportData } from "../analysis/report-data.ts";
import type { SortingPart } from "../analysis/report-sorting.ts";
import type { Review } from "../analysis/synthesis-schema.ts";
import type { AbTestsPart } from "./ab-section.ts";
import type { BottomPoints } from "./bottom-points.ts";
import type { LocalisationData } from "./localisation.ts";
import type { crossCountryTerms, TerminologyCountry } from "./terminology.ts";
import type { MarketRef } from "./types.ts";

/**
 * The saved data of a One country or Compare countries version (country-report.json): the page
 * and the markdown render only this. Bottom line first (plan-reports 3C), then per country, how
 * each game localises, our habits vs the competitors', words used, recommendations per country,
 * the A/B tests, and the per-country details.
 */
export interface CountryVerdict {
  gl: string;
  label: string;
  isMain: boolean;
  /** optimised, on par, slightly / relatively / very different, not enough data (by code). */
  verdict: string;
  points: { fit: number; total: number } | null;
  competitors: number;
  /** The most important computed gap here, or null. */
  keyPoint: string | null;
  /** One line on localisation here (against the main country), or "". */
  localisation: string;
  /** The country advice's short answer (AI), when written. */
  shortAnswer: string;
}

export interface KeyAction {
  gl: string;
  label: string;
  text: string;
  why: string;
  impact: "small" | "medium" | "large" | null;
  /** "ai": from the country advice; "code": from the computed gaps. */
  source: "ai" | "code";
}

export interface AdvicePart {
  gl: string;
  label: string;
  state: "current" | "missing";
  advice: CountryAdvice | null;
  review: Review | null;
  revised: boolean;
  /** Why it is missing, or how it was made. */
  note: string;
}

/** A One country version made by code from a comparison's version (derive-country.ts). */
export interface DerivedInfo {
  projection: "projection.v1";
  from: { reportId: string; versionId: string; name: string; generatedAt: string };
  gl: string;
  /** The other countries of the comparison. */
  others: { gl: string; label: string }[];
  /** Every game shows exactly the same images here as in this earlier compared country. */
  samePagesAs: { gl: string; label: string } | null;
  /** Items not kept because they name another compared country, with the reason. */
  dropped: string[];
}

export interface CountryReport {
  kind: "countries";
  version: 1;
  type: "country" | "compare";
  name: string;
  generatedAt: string;
  main: MarketRef;
  base: { stage: "pilot" | "core" | null; competitors: number };
  /** Banners at the top ("Built on the Pilot only", partial versions). */
  banners: string[];
  /** AI parts not written in this version, each with how to get them. */
  missing: { what: string; how: string }[];
  summary: {
    shortAnswer: string;
    /** The short answer as points (bottom-points-of.ts), added when the version is shown. */
    points?: BottomPoints;
    verdicts: CountryVerdict[];
    keyActions: KeyAction[];
    dates: {
      generated: string;
      storeFrom: string | null;
      storeTo: string | null;
      analyses: string | null;
    };
  };
  countries: { gl: string; label: string; hl: string; isMain: boolean; data: ReportData }[];
  localisation: LocalisationData | null;
  terminology: TerminologyCountry[];
  crossTerms: ReturnType<typeof crossCountryTerms>;
  advice: AdvicePart[];
  abTests: AbTestsPart;
  sorting: SortingPart | null;
  /** Set on a One country version made from a comparison (no AI call). */
  derived?: DerivedInfo;
}
