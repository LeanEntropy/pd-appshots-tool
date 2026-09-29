import { exampleRow, MAIN_DIMS, type MainDim, pageValues } from "./group-dims.ts";
import type { CountryShare, GroupFinding, GroupRules, Thumb } from "./group-types.ts";
import { type CountryPages, gamePages } from "./groups.ts";
import { countryName, theCountry } from "./names.ts";

/**
 * The competitor findings across countries (plan-cross-country 3.4), by code. The unit is a
 * competitor game; a game's value in a group is "yes" when yes on every one of its different
 * pages there, "no" when no on every one, else "mixed" (shown, never counted as yes). Unknown
 * values (positions not analysed) never count as "no".
 */
export interface GroupData {
  pages: CountryPages[];
  main: CountryPages | null;
  competitors: { appId: string; name: string }[];
}

type GameVal = "yes" | "no" | "mixed" | "unknown";

export function gameValue(
  pages: readonly CountryPages[],
  gls: readonly string[],
  appId: string,
  dim: MainDim,
): GameVal {
  const all = gamePages(pages, gls, appId).map((p) => pageValues(p.game)[dim]);
  // A page not analysed leaves the game unknown here: never counted either way.
  if (!all.length || all.some((v) => v === null)) return "unknown";
  const vals = all as boolean[];
  if (vals.every(Boolean)) return "yes";
  if (vals.every((v) => !v)) return "no";
  return "mixed";
}

const list = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/** Per country: competitors with a "yes" page, of those with a known value; ours too. */
export function shares(x: GroupData, pages: readonly CountryPages[], dim: MainDim): CountryShare[] {
  return pages.map((p) => {
    const vals = x.competitors.flatMap((c) => {
      const g = p.games.find((y) => y.appId === c.appId);
      const v = g ? pageValues(g)[dim] : null;
      return v === null ? [] : [{ name: c.name, v }];
    });
    const ours = p.games.find((g) => g.ours);
    return {
      gl: p.gl,
      label: p.label,
      isMain: p === x.main,
      yes: vals.filter((v) => v.v).length,
      of: vals.length,
      games: vals.filter((v) => v.v).map((v) => v.name),
      ours: ours ? pageValues(ours)[dim] : null,
    };
  });
}

/** Up to `n` thumbnails of competitor images showing it, one per game. */
export function examples(
  x: GroupData,
  pages: readonly CountryPages[],
  dim: MainDim,
  games: readonly string[],
  n = 6,
): Thumb[] {
  const out: Thumb[] = [];
  for (const name of games) {
    const c = x.competitors.find((y) => y.name === name);
    for (const p of pages) {
      const g = c && p.games.find((y) => y.appId === c.appId);
      const r = g && exampleRow(g, dim);
      if (!r?.thumb) continue;
      out.push({
        game: name,
        gl: p.gl,
        label: p.label,
        position: r.position,
        thumb: r.thumb,
        ours: false,
      });
      break;
    }
    if (out.length >= n) break;
  }
  return out;
}

const level = (b: number, c: number, holds: boolean, r: GroupRules) =>
  !holds ? 0 : b >= r.clearB && c === 0 ? 2 : b >= r.suggestiveB && c <= r.suggestiveC ? 1 : 0;

/**
 * Kind 3, different in this group: paired per game against `other` (the main country, or the
 * other compared countries). A finding, or a plain "no difference found" / "not enough" line.
 */
export function groupDifference(
  x: GroupData,
  group: { name: string; gls: string[] },
  other: { pages: CountryPages[]; name: string },
  dim: MainDim,
  r: GroupRules,
): { finding: GroupFinding | null; line: string } {
  const d = MAIN_DIMS.find((m) => m.id === dim);
  const inGroup = x.pages.filter((p) => group.gls.includes(p.gl));
  const otherGls = other.pages.map((p) => p.gl);
  const rows = x.competitors.map((c) => ({
    name: c.name,
    g: gameValue(inGroup, group.gls, c.appId, dim),
    o: gameValue(other.pages, otherGls, c.appId, dim),
  }));
  const withValue = rows.filter((y) => y.g !== "unknown").length;
  const what = d?.label.toLowerCase() ?? dim;
  if (withValue < r.minGames)
    return {
      finding: null,
      line: `${d?.label}: not enough games here (${withValue} with a known value).`,
    };
  const toYes = rows.filter((y) => y.g === "yes" && y.o === "no").map((y) => y.name);
  const toNo = rows.filter((y) => y.g === "no" && y.o === "yes").map((y) => y.name);
  const more = toYes.length >= toNo.length;
  const [changed, back] = more ? [toYes, toNo] : [toNo, toYes];
  const known = rows.filter(
    (y) => (y.g === "yes" || y.g === "no") && (y.o === "yes" || y.o === "no"),
  ).length;
  const mixed = rows.filter((y) => y.g === "mixed").length;
  const per = shares(x, [...(other.pages[0] === x.main ? other.pages : []), ...inGroup], dim);
  const inG = per.filter((p) => group.gls.includes(p.gl));
  const hit = (p: CountryShare) => (more ? p.yes : p.of - p.yes);
  const holds = inG.every((p) => p.of > 0 && hit(p) * 2 >= p.of);
  const lv = level(changed.length, back.length, holds, r);
  const counts = `${changed.length} of ${x.competitors.length} competitors changed this way, ${back.length} the other way`;
  if (!lv)
    return {
      finding: null,
      line: `${d?.label}: no difference found against ${other.name} (${counts}${mixed ? `, ${mixed} mixed` : ""}).`,
    };
  const weakest = [...inG].sort((a, b) => hit(a) / (a.of || 1) - hit(b) / (b.of || 1))[0];
  const fewGames = level(changed.length - 1, back.length, holds, r) < lv;
  const doesText = more ? d?.does : `not ${d?.does}`;
  const strength = lv === 2 ? "clear" : "suggestive";
  return {
    line: "",
    finding: {
      kind: "group",
      dim,
      dimLabel: d?.label ?? dim,
      group: group.name,
      title: `${group.name}: competitors ${more ? "" : "do not "}${d?.does ?? what} here more than in ${other.name}`,
      text: `${strength === "clear" ? "Clear" : "Worth testing"}: in ${group.name} (${list(inG.map((p) => countryName(p.label)))}), ${changed.length} of ${x.competitors.length} competitors ${doesText} where they do not in ${other.name} (${list(changed)}); ${back.length} changed the other way${mixed ? `; ${mixed} mixed` : ""}.${weakest ? ` Lowest: ${countryName(weakest.label)}, ${hit(weakest)} of ${weakest.of}.` : ""}${fewGames ? " It rests on few games." : ""}`,
      strength,
      fewGames,
      counts: { b: changed.length, c: back.length, known, mixed, changed, against: other.name },
      perCountry: per,
      weakest: weakest ? `${countryName(weakest.label)}, ${hit(weakest)} of ${weakest.of}` : null,
      examples: more ? examples(x, inGroup, dim, changed) : [],
      sketch: null,
    },
  };
}

/**
 * Kind 2, common in every country (the main one included): at least the share and number of
 * competitors in each; else, when the same games do it everywhere, the descriptive fact.
 */
export function commonFinding(x: GroupData, dim: MainDim, r: GroupRules): GroupFinding | null {
  const d = MAIN_DIMS.find((m) => m.id === dim);
  const all = [...(x.main ? [x.main] : []), ...x.pages];
  const per = shares(x, all, dim);
  if (!per.length || per.some((p) => !p.of)) return null;
  const common = per.every((p) => p.yes >= r.commonGames && p.yes >= r.commonShare * p.of);
  const lo = Math.min(...per.map((p) => p.yes));
  const hi = Math.max(...per.map((p) => p.yes));
  const n = x.competitors.length;
  const oursNot = per.filter((p) => p.ours === false).map((p) => countryName(p.label));
  const base = {
    dim,
    dimLabel: d?.label ?? dim,
    group: "",
    strength: null,
    fewGames: false,
    counts: null,
    perCountry: per,
    weakest: null,
    sketch: null,
  } as const;
  if (common) {
    const games = [...new Set(per.flatMap((p) => p.games))];
    return {
      ...base,
      kind: "common",
      title: `In every country: competitors ${d?.does}`,
      text: `In all ${per.length} countries, ${lo === hi ? lo : `${lo} to ${hi}`} of ${n} competitors ${d?.does}.${oursNot.length ? ` Our page does not in ${list(oursNot)}.` : " Our page does too, everywhere."}`,
      weakest: (() => {
        const w = [...per].sort((a, b) => a.yes / a.of - b.yes / b.of)[0];
        return w ? `${countryName(w.label)}, ${w.yes} of ${w.of}` : null;
      })(),
      examples: examples(x, all, dim, games),
    };
  }
  const sets = per.map((p) => [...p.games].sort().join(","));
  if (hi > 0 && sets.every((s) => s === sets[0]))
    return {
      ...base,
      kind: "descriptive",
      title: `The same competitors ${d?.does} everywhere`,
      text: `The same ${hi} of ${n} competitors (${list(per[0]?.games ?? [])}) ${d?.does} in ${x.main ? `${theCountry(x.main.label)} and in ` : ""}all ${x.pages.length} compared countries; the others do not anywhere. No group difference.`,
      examples: examples(x, all, dim, per[0]?.games ?? [], 3),
    };
  return null;
}
