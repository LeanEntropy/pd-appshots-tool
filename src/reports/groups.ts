import { languageName } from "../analysis/play-experiments.ts";
import type { GameOrder } from "../analysis/report-data.ts";
import { countryName } from "./names.ts";

/**
 * Groups of compared countries (plan-cross-country 3.2): suggested by rule from the region table
 * (configs/countries.json, groupRegions) and shared listing language, edited by the user, never
 * formed from the data. "All compared countries" is always there. A group of countries that show
 * the same pages for most games is refused, with the reason.
 */
export interface GroupDef {
  name: string;
  countries: string[];
}

/** One country's pages: every game's saved position table there. */
export interface CountryPages {
  gl: string;
  hl: string;
  label: string;
  games: GameOrder[];
}

export const ALL_NAME = "All compared countries";
export const MAX_GROUPS = 4;

export function suggestGroups(
  markets: readonly { gl: string; hl: string; label: string }[],
  regions: readonly GroupDef[],
): GroupDef[] {
  if (markets.length < 2) return [];
  const all = markets.map((m) => m.gl);
  const out: GroupDef[] = [{ name: ALL_NAME, countries: all }];
  const key = (xs: readonly string[]) => [...xs].sort().join(",");
  const seen = new Set([key(all)]);
  const add = (name: string, countries: string[]) => {
    if (countries.length < 2 || seen.has(key(countries)) || out.length >= MAX_GROUPS) return;
    seen.add(key(countries));
    out.push({ name, countries });
  };
  for (const r of regions)
    add(
      r.name,
      all.filter((gl) => r.countries.includes(gl)),
    );
  for (const hl of [...new Set(markets.map((m) => m.hl))])
    add(
      `${languageName(hl)} listings`,
      markets.filter((m) => m.hl === hl).map((m) => m.gl),
    );
  return out;
}

/** A game's pages among these countries, merged when they are the same files in the same order. */
export function gamePages(
  pages: readonly CountryPages[],
  gls: readonly string[],
  appId: string,
): { countries: string[]; game: GameOrder }[] {
  const out: { countries: string[]; game: GameOrder; key: string }[] = [];
  for (const p of pages) {
    if (!gls.includes(p.gl)) continue;
    const g = p.games.find((x) => x.appId === appId);
    if (!g?.rows.length) continue;
    const k = g.rows.map((r) => r.imageId ?? `?${r.position}`).join(",");
    const same = out.find((x) => x.key === k);
    if (same) same.countries.push(p.gl);
    else out.push({ countries: [p.gl], game: g, key: k });
  }
  return out.map(({ countries, game }) => ({ countries, game }));
}

/** Why a group cannot be used, in plain words, or null. */
export function groupProblem(g: GroupDef, pages: readonly CountryPages[]): string | null {
  const known = g.countries.filter((gl) => pages.some((p) => p.gl === gl));
  if (known.length < 2) return "A group needs at least 2 of the compared countries.";
  const apps = [
    ...new Set(pages.flatMap((p) => p.games.filter((x) => !x.ours).map((x) => x.appId))),
  ];
  const inAll = apps.filter(
    (a) => gamePages(pages, known, a).reduce((n, x) => n + x.countries.length, 0) === known.length,
  );
  const one = inAll.filter((a) => gamePages(pages, known, a).length === 1).length;
  if (inAll.length && one * 2 > inAll.length) {
    const names = known.map((gl) => countryName(pages.find((p) => p.gl === gl)?.label ?? gl));
    return `${names.join(" and ")} show the same pages for ${one} of ${inAll.length} competitors, so as a group they would count the same pages twice. Add a country with its own pages.`;
  }
  return null;
}

/** The groups to use: the user's (kept only when valid) or the suggested ones. */
export function effectiveGroups(
  saved: readonly GroupDef[] | undefined,
  suggested: readonly GroupDef[],
  pages: readonly CountryPages[],
): { group: GroupDef; problem: string | null; suggested: boolean }[] {
  const key = (g: GroupDef) => [...new Set(g.countries)].sort().join(",");
  const all = suggested.find((g) => g.name === ALL_NAME);
  // "All compared countries" is always there, also next to the user's own groups.
  const own = saved?.length
    ? saved.map((g) => ({ ...g, countries: [...new Set(g.countries)] }))
    : null;
  const list = own
    ? [...(all && !own.some((g) => key(g) === key(all)) ? [all] : []), ...own]
    : suggested;
  return list.slice(0, MAX_GROUPS + 1).map((group) => ({
    group: {
      name: group.name,
      countries: group.countries.filter((gl) => pages.some((p) => p.gl === gl)),
    },
    problem: groupProblem(group, pages),
    suggested: !saved?.length,
  }));
}

/**
 * The same pages note per country: the earlier compared country whose pages are the same files
 * for every game (Hong Kong and Taiwan today), or none.
 */
export function samePagesNotes(pages: readonly CountryPages[]): Map<string, string> {
  const out = new Map<string, string>();
  pages.forEach((p, i) => {
    for (const q of pages.slice(0, i)) {
      const all = p.games.every((g) => gamePages([p, q], [p.gl, q.gl], g.appId).length === 1);
      if (all && p.games.length && !out.has(p.gl)) out.set(p.gl, q.gl);
    }
  });
  return out;
}
