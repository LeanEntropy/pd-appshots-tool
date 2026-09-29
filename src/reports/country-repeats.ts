import type { RepeatFinding } from "../analysis/repeat-findings.ts";
import type { CountryReport, KeyAction } from "./country-report-types.ts";
import { countryName } from "./names.ts";

const join = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/**
 * The bottom line of a One country or Compare countries report when our store page shows the same
 * screen twice in a country (pure, idempotent): that finding is the first key action per country
 * and leads the short answer ("Japan and South Korea: your store page shows ..."); the country's
 * verdict card names it as its key point. Reads each country's data.repeats.
 */
export function withCountryRepeats(r: CountryReport): CountryReport {
  const found = r.countries.flatMap((c) => {
    const f = c.data.repeats?.find((x) => x.ours);
    return f ? [{ c, f }] : [];
  });
  if (!found.length) return r;
  const why = (f: RepeatFinding) =>
    f.counted
      ? `Counted once in this report: ${f.total} images, ${f.unique} unique.`
      : "This version was built before the check and counts every image; build a new version to count each screen once.";
  const lead: KeyAction[] = found.map(({ c, f }) => ({
    gl: c.gl,
    label: c.label,
    text: f.text,
    why: why(f),
    impact: "large",
    source: "code",
  }));
  const key = (a: Pick<KeyAction, "gl" | "text">) => `${a.gl}|${a.text}`;
  const leadKeys = new Set(lead.map(key));
  const rest = r.summary.keyActions.filter((a) => !leadKeys.has(key(a)));
  const keyActions = [...lead, ...rest].slice(0, Math.max(6, lead.length + 2));
  // One sentence per distinct finding, with the countries it applies to.
  const byText = new Map<string, string[]>();
  for (const { c, f } of found)
    byText.set(f.text, [...(byText.get(f.text) ?? []), countryName(c.label)]);
  const lines = [...byText]
    .filter(([text]) => !r.summary.shortAnswer.includes(text.slice(1)))
    .map(([text, names]) => `${join(names)}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`);
  const verdicts = r.summary.verdicts.map((v) => {
    const f = found.find((x) => x.c.gl === v.gl)?.f;
    return f ? { ...v, keyPoint: f.text } : v;
  });
  return {
    ...r,
    summary: {
      ...r.summary,
      shortAnswer: [...lines, r.summary.shortAnswer].join(" "),
      keyActions,
      verdicts,
    },
  };
}
