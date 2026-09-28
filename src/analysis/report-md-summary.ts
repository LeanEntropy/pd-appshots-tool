import type { AbTestCard, AbTestsPart } from "../reports/ab-section.ts";
import type { SummaryPart } from "../reports/summary.ts";
import { slotChanged, type Variant } from "./ab-tests-schema.ts";
import { cell } from "./report-sections.ts";

/**
 * Markdown of the summary block (plan-reports 3C) and the "A/B test details" section (3B), from
 * the report data. The page renders the same data (view/report-summary.ts).
 */
const AB_LINK = "#5-a-b-test-details";

export function summaryDates(s: SummaryPart): string {
  const d = s.dates;
  const store =
    d.storeFrom && d.storeTo && d.storeFrom !== d.storeTo
      ? `${d.storeFrom} to ${d.storeTo}`
      : (d.storeFrom ?? "not saved");
  return `${d.generated ? `Generated ${d.generated.slice(0, 16).replace("T", " ")} UTC` : "Shown as it stands now, from the saved analyses"}. Store pages from ${store}. Analyses as of ${d.analyses ?? "none yet"}.`;
}

export function keyRecommendationsMarkdown(s: SummaryPart): string[] {
  const out = ["### Key recommendations", ""];
  if (s.recommendationsStale) out.push("_Written from older data (see Recommendations)._", "");
  if (!s.keyRecommendations.length)
    out.push("None yet: the recommendations are not written, or they keep our current deck.", "");
  else
    out.push(
      ...s.keyRecommendations.map(
        (r, i) => `${i + 1}. Position ${r.position} (${s.country}): ${r.text}`,
      ),
      "",
      "Full spec per position: [Recommendations](#4-recommendations).",
      "",
    );
  return out;
}

export function abCardsMarkdown(ab: AbTestsPart | undefined): string[] {
  const out = ["### A/B tests to run next", ""];
  if (!ab) return [...out, "_This version was made before A/B tests were part of reports._", ""];
  if (ab.note) out.push(`_${ab.note}_`, "");
  for (const t of ab.tests)
    out.push(
      `${t.priority}. **${cell(t.title)}**${t.source === "code" ? " _(written by code)_" : ""}: ${t.hypothesis} One variable: ${t.variableName}. Countries: ${t.countries.join(", ")}. Setup: ${t.setup.line}`,
    );
  if (ab.tests.length) out.push("", `Full spec of each test: [A/B test details](${AB_LINK}).`, "");
  return out;
}

function variantTable(v: Variant): string[] {
  return [
    `_${cell(v.summary)}_`,
    "",
    "| # | Changed | From our position | Orientation | Composition | Screen | Band | Headline | Extras |",
    "|---|---|---|---|---|---|---|---|---|",
    ...v.slots.map(
      (s) =>
        `| ${s.position} | ${slotChanged(s) ? `**${s.changes.join(", ") || "moved"}**` : "no"} | ${s.fromOurPosition || "new"} | ${s.orientation} | ${cell(s.composition)} | ${cell(s.screen)} | ${cell(s.band)} | ${cell(s.headline)} | ${cell(s.extras)} |`,
    ),
    "",
  ];
}

function testMarkdown(t: AbTestCard): string[] {
  const out = [
    `### Test ${t.priority}: ${t.title}`,
    "",
    ...(t.source === "code" ? ["_Gap worth testing, written by code (no AI wording)._", ""] : []),
    `- **Hypothesis:** ${t.hypothesis}`,
    `- **Evidence:** ${t.evidence.map((e) => `${e.statement} (${e.n} of ${e.of} ${e.unit}${e.games.length ? `: ${e.games.join(", ")}` : ""})`).join("; ")}`,
    `- **The one variable:** ${t.variableName}${t.positions.length ? `, position ${t.positions.join(", ")}` : ""}`,
    `- **Countries:** ${t.countries.join(", ")}`,
    `- **Metric:** ${t.metric.name} (${t.metric.meaning})`,
    `- **Guardrail:** ${t.guardrail}`,
    `- **Play Console setup:** ${t.setup.line}`,
    ...t.setup.notes.map((n) => `  - ${n}`),
    ...(t.impact ? [`- **Expected impact:** ${t.impact.size}. ${t.impact.reason}`] : []),
    "",
    "#### Variant",
    "",
  ];
  out.push(...(t.variant ? variantTable(t.variant) : [t.variantText, ""]));
  if (t.secondVariant) out.push("#### Second variant", "", ...variantTable(t.secondVariant));
  out.push(
    "#### Control: our current deck",
    "",
    "| # | Screen | Headline | Orientation |",
    "|---|---|---|---|",
    ...t.control.map(
      (c) => `| ${c.position} | ${cell(c.screen)} | ${cell(c.headline)} | ${c.orientation} |`,
    ),
    "",
  );
  return out;
}

export function abDetailsMarkdown(ab: AbTestsPart | undefined): string[] {
  if (!ab) return ["_This version was made before A/B tests were part of reports._", ""];
  const out: string[] = [
    `From ${ab.gaps} ${ab.gaps === 1 ? "gap" : "gaps"} between our deck and the competitors, computed by code; every test's evidence and setup is checked by code.`,
    "",
  ];
  if (ab.note) out.push(`_${ab.note}_`, "");
  for (const t of ab.tests) out.push(...testMarkdown(t));
  if (ab.leftOut.length)
    out.push("### Left out", "", ...ab.leftOut.map((l) => `- ${l.title}: ${l.reason}`), "");
  return out;
}
