import type { PlayContext } from "./ab-section.ts";
import type { AdvicePart, CountryReport, DerivedInfo } from "./country-report-types.ts";
import { dates, keyActions, shortAnswer, verdicts } from "./country-summary.ts";
import { derivedAbTests, namesOther } from "./derive-ab.ts";

export { namesOther };

import { countryName } from "./names.ts";
import { mergedSorting } from "./sorting-merge.ts";

/**
 * A One country report from a comparison's saved data (plan-cross-country 2.2, projection.v1),
 * code only, never an AI call. Built field by field, not sliced:
 * - kept as saved: that country's report data, localisation rows and habits, words used, advice
 *   and its second opinion;
 * - recomputed: the summary (verdict, key actions, short answer, dates), the sorting part and
 *   the A/B tests (derive-ab.ts);
 * - dropped: the cross-country words, the across-countries habits and every comparison-level
 *   line;
 * - checked: kept text never names another compared country (a hit is dropped with the reason).
 */
export const PROJECTION = "projection.v1" as const;

export interface DeriveMeta {
  reportId: string;
  versionId: string;
  name: string;
  generatedAt: string;
}

/** Each game's images in store order, per country (the same pages check). */
const pagesOf = (c: CountryReport["countries"][number]) =>
  new Map(c.data.games.map((g) => [g.appId, g.rows.map((r) => r.imageId ?? "?").join(",")]));

/**
 * The earlier compared country whose pages are the same files in the same order for every game
 * (Hong Kong and Taiwan today), or null. Decided game by game; a game missing in either counts
 * as different.
 */
export function samePagesAs(r: CountryReport, gl: string): { gl: string; label: string } | null {
  const i = r.countries.findIndex((c) => c.gl === gl);
  const here = r.countries[i];
  if (!here) return null;
  const mine = pagesOf(here);
  for (const other of r.countries.slice(0, i)) {
    const theirs = pagesOf(other);
    if (mine.size !== theirs.size || !mine.size) continue;
    if ([...mine].every(([app, seq]) => theirs.get(app) === seq))
      return { gl: other.gl, label: other.label };
  }
  return null;
}

export function deriveCountry(
  parent: CountryReport,
  gl: string,
  meta: DeriveMeta,
  play: PlayContext,
): CountryReport | null {
  const c = parent.countries.find((x) => x.gl === gl);
  if (!c) return null;
  const name = countryName(c.label);
  const others = parent.countries.filter((x) => x.gl !== gl);
  const otherNames = others.map((x) => countryName(x.label)).filter((n) => n !== name);
  const dropped: string[] = [];
  const advice: AdvicePart[] = parent.advice
    .filter((a) => a.gl === gl)
    .map((a) => {
      const hit = a.advice ? namesOther(JSON.stringify(a.advice), otherNames) : [];
      if (!hit.length) return a;
      dropped.push(`The advice for ${name}: it names ${hit.join(", ")}`);
      return {
        ...a,
        state: "missing" as const,
        advice: null,
        review: null,
        note: `Not kept from the comparison: it names ${hit.join(", ")}. Write it for ${name} alone with Review and approve.`,
      };
    });
  const loc = parent.localisation
    ? {
        main: parent.localisation.main,
        rows: parent.localisation.rows.filter((x) => x.gl === gl),
        habits: parent.localisation.habits.filter((x) => x.gl === gl),
        across: null,
      }
    : null;
  const countries = [c];
  const v = verdicts(countries, loc, advice, parent.main);
  const actions = keyActions(countries, advice, loc);
  const ab = derivedAbTests(parent, c, play);
  const missing = parent.missing.filter(
    (m) =>
      !namesOther(m.what, otherNames).length &&
      !(
        m.what.startsWith("The AI wording of the A/B tests") &&
        ab.tests.some((t) => t.source === "ai")
      ),
  );
  for (const a of advice)
    if (!a.advice && !missing.some((m) => m.what === `The advice for ${name}`))
      missing.push({
        what: `The advice for ${name}`,
        how: "Press Review and approve on this report: the approval lists these text-only steps with their cost; nothing runs until you approve.",
      });
  const derived: DerivedInfo = {
    projection: PROJECTION,
    from: meta,
    gl,
    others: others.map((x) => ({ gl: x.gl, label: x.label })),
    samePagesAs: samePagesAs(parent, gl),
    dropped,
  };
  return {
    kind: "countries",
    version: 1,
    type: "country",
    name: `${name} vs ${c.data.games.filter((g) => !g.ours).length} competitors (from the comparison)`,
    generatedAt: parent.generatedAt,
    main: parent.main,
    base: parent.base,
    banners: parent.banners.filter((b) => !namesOther(b, otherNames).length),
    missing,
    summary: {
      shortAnswer: shortAnswer(v, actions),
      verdicts: v,
      keyActions: actions,
      dates: dates(countries, parent.generatedAt),
    },
    countries,
    localisation: loc,
    terminology: parent.terminology.filter((t) => t.gl === gl),
    crossTerms: [],
    advice,
    abTests: ab,
    sorting: mergedSorting([c.data]),
    derived,
  };
}
