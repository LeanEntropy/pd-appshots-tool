import { noFactIds } from "../analysis/country-advice-schema.ts";
import { ownPoints, sharedPoints } from "./country-points.ts";
import type { CountryReport } from "./country-report-types.ts";
import { countryName } from "./names.ts";
import { wordsTableMd } from "./words-md.ts";
import { wordsBlock } from "./words-status.ts";

/**
 * The written report of a country version (report.md, also the PDF), in the page's order:
 * 1 Overall recommendations (verdicts, gaps shared across countries, each country's own key
 * points, the A/B tests), the contents, 2 Across countries (how each game localises, our habits,
 * words across languages, what to research next), 3 Per country (every country in sequence: its
 * advice, key points and words). Code only, from the saved data; the page shows more detail.
 */
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");

function overall(r: CountryReport): string[] {
  const s = r.summary;
  const shared = sharedPoints(r);
  const n = r.countries.length;
  const out = [
    "## 1. Overall recommendations",
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
  ];
  if (shared.length)
    out.push(
      "### Across countries",
      "",
      ...shared.map(
        (g, i) =>
          `${i + 1}. **${g.key}** (${g.per.length === n ? `all ${n}` : `${g.per.length} of ${n}`} countries): ${g.per.map((q) => `${countryName(q.label)}${q.detail ? ` (${q.detail})` : ""}`).join("; ")}.`,
      ),
      "",
    );
  out.push(n > 1 ? "### Key points per country" : "### Key points", "");
  for (const c of r.countries) {
    const pts = ownPoints(r, c.gl, shared);
    if (!pts.length) continue;
    if (n > 1) out.push(`#### ${countryName(c.label)}`, "");
    out.push(
      ...pts.map(
        (p, i) =>
          `${i + 1}. ${p.text}${p.why ? ` ${p.why}` : ""}${p.impact ? ` (expected impact: ${p.impact})` : ""}${p.code ? " (computed gap)" : ""}`,
      ),
      "",
    );
  }
  out.push(
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
  return out;
}

function across(r: CountryReport, research: string[]): string[] {
  const out: string[] = [];
  if (r.localisation)
    out.push(
      "### How each game localises",
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
      "### Our localisation vs the competitors'",
      "",
      ...r.localisation.habits.flatMap((h) => [
        `#### ${countryName(h.country)}`,
        "",
        ...h.habits.map(
          (x) => `- ${x.fits === null ? "(n/a)" : x.fits ? "[V]" : "[X]"} ${x.label}: ${x.reason}.`,
        ),
        "",
      ]),
    );
  if (r.terminology.length > 1 && r.crossTerms.length)
    out.push(
      "### Words compared across languages",
      "",
      `| Idea | ${r.terminology.map((t) => countryName(t.label)).join(" | ")} |`,
      `|---|${r.terminology.map(() => "---|").join("")}`,
      ...r.crossTerms.map(
        (x) =>
          `| ${cell(x.label)} | ${x.perCountry.map((p) => cell(`${p.common ?? "none"}${p.ours && p.ours !== p.common ? ` (ours: ${p.ours})` : ""}`)).join(" | ")} |`,
      ),
      "",
    );
  if (research.length) out.push("### What to research next", "", ...research, "");
  return out;
}

function perCountry(r: CountryReport): string[] {
  const out: string[] = [];
  for (const c of r.countries) {
    out.push(`### ${countryName(c.label)}${c.isMain ? " (main country)" : ""}`, "");
    const a = r.advice.find((x) => x.gl === c.gl);
    if (a?.advice)
      out.push(
        "#### Recommendations",
        "",
        noFactIds(a.advice.shortAnswer),
        "",
        "| # | From main | Change | Screen | Headline | Back-translation | Logo |",
        "|---|---|---|---|---|---|---|",
        ...a.advice.deck.map(
          (d) =>
            `| ${d.position} | ${d.fromMainPosition || "new"} | ${d.change} | ${cell(d.screen)} | ${cell(d.headline)} | ${cell(d.backTranslation)} | ${d.logo.show ? "yes" : "no"} |`,
        ),
        "",
        ...wordsTableMd(
          wordsBlock(a.advice.terms, r.terminology.find((t) => t.gl === a.gl) ?? null),
          a.label,
        ),
      );
    else if (a) out.push("#### Recommendations", "", a.note, "");
    const kps = c.data.fit?.keyPoints ?? [];
    if (kps.length)
      out.push(
        "#### Patterns: key points to optimise",
        "",
        ...kps.map((k, i) => `${i + 1}. ${k}`),
        "",
      );
    const t = r.terminology.find((x) => x.gl === c.gl);
    if (t) {
      out.push("#### Words used", "", ...(t.note ? [t.note, ""] : []));
      for (const row of t.rows.slice(0, 12))
        out.push(
          `- ${row.ours === "differs" ? "[X]" : row.ours === "same" ? "[V]" : "-"} **${row.label}**: ${row.reason}${row.suggestion ? `. ${row.suggestion}` : ""}`,
        );
      out.push("");
    }
  }
  return out;
}

export function countryMarkdown(r: CountryReport, research: string[] = []): string {
  const acrossPart = across(r, research);
  const titles = [
    "Overall recommendations",
    ...(acrossPart.length ? ["Across countries"] : []),
    "Per country",
  ];
  const out: string[] = [
    `# ${r.name}`,
    "",
    `Generated ${r.generatedAt.slice(0, 16).replace("T", " ")} UTC. Main country (reference): ${r.main.label}.`,
    "",
    ...r.banners.map((b) => `> ${b}`),
    "",
    ...overall(r),
    "## Contents",
    "",
    ...titles.map((t, i) => `${i + 1}. ${t}`),
    "",
  ];
  if (acrossPart.length) out.push("## 2. Across countries", "", ...acrossPart);
  out.push(`## ${titles.length}. Per country`, "", ...perCountry(r));
  return `${out.join("\n")}\n`;
}
