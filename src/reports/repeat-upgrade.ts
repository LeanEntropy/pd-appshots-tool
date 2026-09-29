import { sameCheck } from "../analysis/deck-repeats.ts";
import { readRecords } from "../analysis/records.ts";
import { repeatsOfData, withRepeatFindings } from "../analysis/repeat-findings.ts";
import type { ReportData } from "../analysis/report-data.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { openImageDb } from "../store/imagedb.ts";
import { withCountryRepeats } from "./country-repeats.ts";
import type { CountryReport } from "./country-report-types.ts";

/**
 * Saved report versions get the "same screen uploaded twice" finding when they are opened (code
 * only, no AI, nothing rewritten on disk): from each game's saved store order and the cached pixel
 * checks. Their patterns keep the counts they were built with, and say so; a new version counts
 * each screen once. A version that already has the finding is returned as it is.
 */
export function repeatUpgrader(loaded: LoadedConfig) {
  const paths = projectPaths(loaded);
  const db = openImageDb(paths);
  const same = sameCheck(paths, readRecords(paths));
  const data = <T>(raw: T): T => {
    const d = raw as ReportData;
    if (d.repeats || !Array.isArray(d.games)) return raw;
    return withRepeatFindings(
      d,
      repeatsOfData(d, (id) => db.get(id), same),
      false,
    ) as T;
  };
  const country = <T>(raw: T): T => {
    const r = raw as CountryReport;
    return withCountryRepeats({
      ...r,
      countries: r.countries.map((c) => ({ ...c, data: data(c.data) })),
    }) as T;
  };
  return { data, country };
}

/** The upgrade, or the saved data unchanged when anything in it is unexpected. */
export function tryUpgrade<T>(raw: T, up: (x: T) => T): T {
  try {
    return up(raw);
  } catch {
    return raw;
  }
}
