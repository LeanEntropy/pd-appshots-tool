import { noFactIds } from "../analysis/country-advice-schema.ts";
import type { CountryReport } from "./country-report-types.ts";
import { countryName } from "./names.ts";
import { wordsTableMd } from "./words-md.ts";
import { wordsBlock } from "./words-status.ts";

/**
 * The written report of a country version (report.md): the bottom line, the advice per country,
 * how each game localises, our habits, words used and the A/B tests. Code only, from the saved
 * data; the page renders the same data in more detail.
 */
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");

/** A country report made from a comparison: where it comes from, and the same-pages note. */
export function derivedLines(r: CountryReport): string[] {
  const d = r.derived;
  if (!d) return [];
  const name = countryName(r.countries[0]?.label ?? "");
  const when = d.from.generatedAt.slice(0, 16).replace("T", " ");
  return [
    ...(d.samePagesAs
      ? [
          `> ${name} shows the same images as ${countryName(d.samePagesAs.label)} for every game: this report repeats ${countryName(d.samePagesAs.label)}'s findings.`,
        ]
      : []),
    `> Part of the comparison "${d.from.name}" (${when} UTC), made from its saved data with no AI call. Also in it: ${d.others.map((o) => countryName(o.label)).join(", ")}.`,
    ...d.dropped.map((x) => `> Not kept: ${x}.`),
  ];
}

export function countryMarkdown(r: CountryReport, research: string[] = []): string {
  const out: string[] = [`# ${r.name}`, ""];
  const s = r.summary;
  out.push(
    `Generated ${r.generatedAt.slice(0, 16).replace("T", " ")} UTC. Main country (reference): ${r.main.label}.`,
    "",
    ...r.banners.map((b) => `> ${b}`),
    ...derivedLines(r),
    "",
    "## 1. Summary: the bottom line",
    "",
    s.shortAnswer,
    "",
    "| Country | Our page | Competitors | Most important gap | Localisation |",
    "|---|---|---|---|---|",
    ...s.verdicts.map(
      (v) =>
        `| ${countryName(v.label)} | ${v.verdict}${v.points ? ` (${v.points.fit} of ${v.points.total} points)` : ""} | ${v.competitors} | ${cell(v.keyPoint ?? "none")} | ${cell(v.localisation || "(main country)")} |`,
    ),
    "",
    "### Key actions",
    "",
    ...s.keyActions.map(
      (a, i) =>
        `${i + 1}. **${countryName(a.label)}:** ${a.text}${a.why ? ` ${a.why}` : ""}${a.impact ? ` (expected impact: ${a.impact})` : ""}`,
    ),
    "",
    "### A/B tests to run next",
    "",
    ...r.abTests.tests.map(
      (t) =>
        `${t.priority}. **${t.title}** (${t.variableName}; ${t.countries.join(", ")}). ${t.setup.line}`,
    ),
    "",
  );
  if (r.missing.length)
    out.push("Not written yet:", "", ...r.missing.map((m) => `- ${m.what}. ${m.how}`), "");
  out.push("## 2. Recommendations per country", "");
  for (const a of r.advice) {
    out.push(`### ${countryName(a.label)}`, "");
    if (!a.advice) {
      out.push(a.note, "");
      continue;
    }
    out.push(
      noFactIds(a.advice.shortAnswer),
      "",
      "| # | From main | Change | Screen | Headline | Back-translation | Logo |",
      "|---|---|---|---|---|---|---|",
      ...a.advice.deck.map(
        (d) =>
          `| ${d.position} | ${d.fromMainPosition || "new"} | ${d.change} | ${cell(d.screen)} | ${cell(d.headline)} | ${cell(d.backTranslation)} | ${d.logo.show ? "yes" : "no"} |`,
      ),
      "",
    );
    out.push(
      ...wordsTableMd(
        wordsBlock(a.advice.terms, r.terminology.find((t) => t.gl === a.gl) ?? null),
        a.label,
      ),
    );
  }
  if (r.localisation) {
    out.push(
      "## 3. How each game localises",
      "",
      "| Game | Country | Same file | Same picture, new text | Other picture | Moved | Text left untranslated | Order |",
      "|---|---|---|---|---|---|---|---|",
      ...r.localisation.rows
        .filter((x) => x.state === "ok")
        .map(
          (x) =>
            `| ${x.game}${x.ours ? " (ours)" : ""} | ${countryName(x.country)} | ${x.identical} | ${x.newText + x.notCompared} | ${x.different} | ${x.moved} | ${x.keptText} | ${cell(x.orderNote)} |`,
        ),
      "",
      "## 4. Our localisation vs the competitors'",
      "",
      ...r.localisation.habits.flatMap((h) => [
        `### ${countryName(h.country)}`,
        "",
        ...h.habits.map(
          (x) => `- ${x.fits === null ? "(n/a)" : x.fits ? "[V]" : "[X]"} ${x.label}: ${x.reason}.`,
        ),
        "",
      ]),
    );
  }
  out.push("## 5. Words used, per country", "");
  for (const t of r.terminology) {
    out.push(`### ${countryName(t.label)}`, "", ...(t.note ? [t.note, ""] : []));
    for (const row of t.rows.slice(0, 12))
      out.push(
        `- ${row.ours === "differs" ? "[X]" : row.ours === "same" ? "[V]" : "-"} **${row.label}**: ${row.reason}${row.suggestion ? `. ${row.suggestion}` : ""}`,
      );
    out.push("");
  }
  if (research.length) out.push("## What to research next", "", ...research, "");
  return `${out.join("\n")}\n`;
}
