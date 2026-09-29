import { isPreset, type ReportDef, type ReportScope } from "./types.ts";

/** Another report with exactly the same setup: a draft (never run) or a report with versions. */
export interface SameReport {
  id: string;
  name: string;
  draft: boolean;
}

const sorted = (xs: readonly string[]) => [...xs].sort().join(",");

/** The setup of a scope in one comparable string: kind, countries, games and left-out pairs. */
export function scopeKey(s: ReportScope): string {
  return [
    s.type,
    sorted(s.markets.map((m) => `${m.gl}|${m.hl}`)),
    sorted(s.competitors),
    sorted(s.includeCharts),
    sorted((s.leftOut ?? []).map((x) => `${x.appId}|${x.gl}`)),
  ].join(" / ");
}

/**
 * The other reports (not archived, not the Pilot or Full check) set up exactly like this scope,
 * drafts first, then oldest first. Code only; nothing is changed or merged.
 */
export function sameScope(
  defs: readonly ReportDef[],
  scope: ReportScope,
  exceptId = "",
): SameReport[] {
  if (isPreset(scope.type)) return [];
  const key = scopeKey(scope);
  return defs
    .filter((d) => d.id !== exceptId && !d.archived && !isPreset(d.type))
    .filter((d) => scopeKey(d.scope) === key)
    .sort(
      (a, b) =>
        Number(a.versions.length > 0) - Number(b.versions.length > 0) ||
        a.createdAt.localeCompare(b.createdAt),
    )
    .map((d) => ({ id: d.id, name: d.name, draft: d.versions.length === 0 }));
}
