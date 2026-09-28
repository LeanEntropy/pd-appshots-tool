import type { MarketRef, ReportScope } from "./types.ts";

/** "Hong Kong (Traditional Chinese)" -> "Hong Kong"; "United States (English)" -> "United States". */
export const countryName = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, "") || label;

/** The country name as used inside a sentence: "the United States", "the Philippines", "Japan". */
export function theCountry(label: string): string {
  const n = countryName(label);
  return /^(United |Philippines|Netherlands|Czech Republic|Dominican Republic)/.test(n)
    ? `the ${n}`
    : n;
}

const count = (n: number) => `${n} ${n === 1 ? "competitor" : "competitors"}`;

/**
 * The name the builder suggests (plan-reports 1.2), from the type, countries and competitor
 * count: "Japan, South Korea, Taiwan vs 3 competitors"; a main-country One country report is
 * "United States with 9 competitors". The user can change it.
 */
export function suggestName(scope: ReportScope, main: MarketRef): string {
  const n = scope.competitors.length + scope.includeCharts.length;
  const names = scope.markets.map((m) => countryName(m.label));
  if (scope.type === "pilot") return "Pilot";
  if (scope.type === "core") return "Full check";
  if (!names.length) return scope.type === "compare" ? "Compare countries" : "One country";
  const isMain = scope.markets.length === 1 && scope.markets[0]?.gl === main.gl;
  if (scope.type === "country" && isMain) return `${names[0]} with ${count(n)}`;
  return `${names.join(", ")} vs ${count(n)}`;
}
