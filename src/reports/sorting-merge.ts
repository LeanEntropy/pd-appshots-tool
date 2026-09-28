import type { ReportData } from "../analysis/report-data.ts";
import type { SortingPart } from "../analysis/report-sorting.ts";

/**
 * "How we sort images" once for a report of several countries: every category and tag seen in
 * any country, each with its definition and the first example found (user rule: explain every
 * classification where it is used).
 */
export function mergedSorting(data: readonly ReportData[]): SortingPart | null {
  const parts = data.flatMap((d) => (d.sorting ? [d.sorting] : []));
  const first = parts[0];
  if (!first) return null;
  const items = new Map<string, SortingPart["items"][number]>();
  for (const p of parts)
    for (const i of p.items) {
      const had = items.get(i.key);
      if (!had || (!had.example && i.example)) items.set(i.key, i);
    }
  return { ...first, items: [...items.values()] };
}
