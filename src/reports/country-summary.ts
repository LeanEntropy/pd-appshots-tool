import { noFactIds } from "../analysis/country-advice-schema.ts";
import { languageName } from "../analysis/play-experiments.ts";
import type { ReportData } from "../analysis/report-data.ts";
import type {
  AdvicePart,
  CountryReport,
  CountryVerdict,
  KeyAction,
} from "./country-report-types.ts";
import type { LocalisationData } from "./localisation.ts";
import { countryName } from "./names.ts";
import type { MarketRef } from "./types.ts";

/**
 * The bottom line of a country report (plan-reports 3C), by code: a verdict per country (the
 * computed pattern fit), one localisation line per country, the key actions (the country
 * advice's when written, else the computed gaps), the short answer and the dates.
 */
function localLine(loc: LocalisationData | null, gl: string, main: MarketRef): string {
  const h = loc?.habits.find((x) => x.gl === gl)?.habits;
  if (!h) return "";
  const tr = h.find((x) => x.id === "translate");
  const sw = h.find((x) => x.id === "swap");
  const parts: string[] = [];
  if (tr?.of)
    parts.push(
      `${tr.n} of ${tr.of} competitors translate the text on their images; ${tr.ours === null ? "we have no page here" : tr.ours ? "we do too" : `ours stays in ${languageName(main.hl)}`}`,
    );
  if (sw?.of && sw.n)
    parts.push(
      `${sw.n} of ${sw.of} use pictures not on their ${countryName(main.label)} page${sw.ours ? " (we do too)" : ""}`,
    );
  return parts.join("; ");
}

export function verdicts(
  countries: CountryReport["countries"],
  loc: LocalisationData | null,
  advice: readonly AdvicePart[],
  main: MarketRef,
): CountryVerdict[] {
  return countries.map((c) => {
    const f = c.data.fit;
    const a = advice.find((x) => x.gl === c.gl);
    return {
      gl: c.gl,
      label: c.label,
      isMain: c.isMain,
      verdict: f?.verdict ?? "not enough data",
      points: f?.points ?? null,
      competitors: c.data.games.filter((g) => !g.ours).length,
      keyPoint: f?.keyPoints[0] ?? null,
      localisation: c.isMain ? "" : localLine(loc, c.gl, main),
      shortAnswer: a?.advice ? noFactIds(a.advice.shortAnswer) : "",
    };
  });
}

/** The top actions: per country the advice's first two (AI), else its first computed gaps. */
export function keyActions(
  countries: CountryReport["countries"],
  advice: readonly AdvicePart[],
  loc: LocalisationData | null,
): KeyAction[] {
  const out: KeyAction[] = [];
  for (const c of countries) {
    const a = advice.find((x) => x.gl === c.gl)?.advice;
    if (a) {
      for (const x of a.actions.slice(0, 2))
        out.push({
          gl: c.gl,
          label: c.label,
          text: noFactIds(x.action),
          why: firstSentence(noFactIds(x.why)),
          impact: x.impact,
          source: "ai",
        });
      continue;
    }
    const tr = loc?.habits.find((h) => h.gl === c.gl)?.habits.find((h) => h.id === "translate");
    if (tr && tr.fits === false && tr.ours === false)
      out.push({
        gl: c.gl,
        label: c.label,
        text: "Translate the text on our images",
        why: `${tr.n} of ${tr.of} competitors here do; ours does not.`,
        impact: null,
        source: "code",
      });
    const k = c.data.fit?.keyPoints[0];
    if (k) out.push({ gl: c.gl, label: c.label, text: k, why: "", impact: null, source: "code" });
  }
  const rank = { large: 0, medium: 1, small: 2 } as const;
  return out
    .map((x, i) => ({ x, i }))
    .sort(
      (a, b) =>
        (a.x.impact ? rank[a.x.impact] : 3) - (b.x.impact ? rank[b.x.impact] : 3) || a.i - b.i,
    )
    .slice(0, 6)
    .map(({ x }) => x);
}

/** The first sentence of a text (the summary stays short; the full reason is in the advice). */
const firstSentence = (s: string) => /^.+?[.!?](?=\s|$)/.exec(s.trim())?.[0] ?? s.trim();

const joinNames = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/**
 * The short answer: with one country, the country advice's own short answer (CMO voice) when
 * written; otherwise by code, from the verdicts and the first key action (its text only).
 */
export function shortAnswer(v: readonly CountryVerdict[], actions: readonly KeyAction[]): string {
  const one = v.length === 1 ? v[0] : undefined;
  const n = Math.max(0, ...v.map((x) => x.competitors));
  if (one?.shortAnswer)
    return `Our store page is ${one.verdict} against ${one.competitors} competitors in ${countryName(one.label)}. ${one.shortAnswer}`;
  const by = new Map<string, string[]>();
  for (const x of v) by.set(x.verdict, [...(by.get(x.verdict) ?? []), countryName(x.label)]);
  const verdictText = [...by].map(([word, names]) => `${word} in ${joinNames(names)}`).join(", ");
  const first = actions[0];
  return [
    `Against up to ${n} competitors per country, our store page is ${verdictText}.`,
    first
      ? `First change: ${first.text.replace(/[.!]?$/, "")} (${countryName(first.label)}).`
      : "No computed gap stands out: our page follows the competitors' patterns here.",
  ].join(" ");
}

export function dates(
  countries: readonly { data: ReportData }[],
  generated: string,
): CountryReport["summary"]["dates"] {
  const all = countries.flatMap((c) => (c.data.summary ? [c.data.summary.dates] : []));
  const sorted = (xs: (string | null)[]) => xs.filter((d): d is string => !!d).sort();
  const from = sorted(all.map((d) => d.storeFrom));
  const to = sorted(all.map((d) => d.storeTo));
  const an = sorted(all.map((d) => d.analyses));
  return {
    generated,
    storeFrom: from[0] ?? null,
    storeTo: to.at(-1) ?? null,
    analyses: an.at(-1) ?? null,
  };
}
