import { dataPoints, pointsMarkdown } from "../reports/bottom-points-of.ts";
import { definitionOf } from "./categories.ts";
import type { Labeler } from "./labels.ts";
import { positionWord } from "./ours-vs-position.ts";
import type { PatternFit } from "./pattern-fit.ts";
import type { OrderRow, ReportData } from "./report-data.ts";
import {
  abCardsMarkdown,
  abDetailsMarkdown,
  keyRecommendationsMarkdown,
  summaryDates,
} from "./report-md-summary.ts";
import {
  cell,
  defineLine,
  IMG,
  patternSection,
  recommendationSection,
  sortingMarkdown,
} from "./report-sections.ts";
import { storeTextMarkdown } from "./report-store-md.ts";

const img = (thumb: string | null, file: string | null, alt: string) =>
  thumb ? `[![${alt}](${IMG}${thumb})](${IMG}${file ?? thumb})` : "";

export const SECTIONS = [
  "Summary: the bottom line",
  "Patterns across competitors",
  "Position by position",
  "Recommendations",
  "A/B test details",
  "Store text and keywords",
  "Detailed statistics",
] as const;
export const RESEARCH_SECTION = "What to research next";

export const GROUPS: Record<PatternFit["group"], string> = {
  order: "Order (the sequence of screen types)",
  content: "Content (which screen types are used)",
  layer: "Marketing layer",
  format: "Format",
};

/** The overall verdict and key points: the AI's wording when current and complete, else by code. */
export function overviewText(d: ReportData): {
  verdict: string;
  points: string[];
  worded: boolean;
} {
  const f = d.fit;
  const i = d.ai?.current ? d.ai.interpretation : null;
  const points = f?.keyPoints ?? [];
  // The AI wording is used only when it matches the computed verdict and key points.
  const worded =
    !!f &&
    !!i?.keyPoints &&
    i.keyPoints.length === points.length &&
    !!i.verdictText &&
    i.verdictText.toLowerCase().includes(f.verdict);
  return {
    verdict: worded && i ? i.verdictText : "",
    points: worded && i ? i.keyPoints : points,
    worded,
  };
}

/** " (fits 12 of 15 weighted pattern points)": counts, not a percentage. */
export function fitsText(f: NonNullable<ReportData["fit"]>): string {
  // Reports saved before the points existed: the same weights, from the saved patterns.
  const w = (x: PatternFit) => (x.strength === "pattern" ? 2 : 1);
  const judged = f.patterns.filter((x) => x.fits !== null);
  const p = f.points ?? {
    fit: judged.filter((x) => x.fits).reduce((n, x) => n + w(x), 0),
    total: judged.reduce((n, x) => n + w(x), 0),
  };
  return p.total ? ` (fits ${p.fit} of ${p.total} weighted pattern points)` : "";
}

/** The definitions of the categories and tags a pattern is about, under its text. */
const defined = (x: PatternFit) => {
  const lines = [...new Set(x.categories ?? [])].map(defineLine).filter(Boolean);
  return lines.length ? `<br>_${cell(lines.join(" "))}_` : "";
};

const fitMark = (x: PatternFit) =>
  x.fits === null ? "n/a" : x.fits ? "[V] fits" : "[X] different";

function cellOf(r: OrderRow | undefined, name: string): string {
  if (!r) return "";
  if (r.state === "excluded") return "_not analysed (tablet-shaped)_";
  const label = r.screen ? `**${cell(r.screen)}**` : "not analysed yet";
  const ls = r.layerStructure ? definitionOf(r.layerStructure)?.label.toLowerCase() : "";
  const format = [r.orientation, r.size, r.ratio, ls].filter(Boolean).join(", ");
  return `${img(r.thumb, r.file, `${name} ${r.position}`)} ${label}${format ? `<br>_${cell(format)}_` : ""}${r.headline ? `<br>"${cell(r.headline)}"` : ""}`;
}

/**
 * The report body in markdown, in the same numbered sections as the gallery's Report page:
 * overview (verdict and key points), patterns with our fit, one row per store position (ours
 * first), recommendations, A/B test details, store text and derived keywords per country, what
 * to research next (only when `research` is given), then the detailed statistics. Everything but the AI wording and the
 * recommendations is computed by code and always present.
 */
export function reportMarkdown(d: ReportData, label: Labeler, research?: string[]): string[] {
  // "What to research next" (plan-reports 5A.5), when the version kept it: before the statistics.
  const titles: string[] = [...SECTIONS];
  if (research) titles.splice(6, 0, RESEARCH_SECTION);
  const slug = (i: number) =>
    `${i + 1}-${(titles[i] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const head = (i: number) => `## ${i + 1}. ${titles[i]}`;
  const out: string[] = [];
  const o = overviewText(d);
  const f = d.fit;
  out.push(head(0), "");
  const n = d.patterns?.games.length ?? 0;
  // Same note as the page's verdict (gallery-report.ts): a small sample is said, never refused.
  const sample =
    n && n < 10
      ? ` Against ${n} ${n === 1 ? "competitor" : "competitors"}: a small sample, so read the patterns as strong hints.`
      : "";
  if (f)
    out.push(`**Verdict: our deck is ${f.verdict.toUpperCase()}**${fitsText(f)}.${sample}`, "");
  else out.push("**Verdict: not enough competitor data yet.**", "");
  if (d.summary) {
    const p = dataPoints(d);
    out.push(...(p ? pointsMarkdown(p) : [d.summary.shortAnswer, ""]));
  } else if (o.verdict) out.push(o.verdict, "");
  out.push("### Key points to optimise, most important first", "");
  if (o.points.length) out.push(...o.points.map((p, i) => `${i + 1}. ${p}`));
  else out.push("None: our deck fits every competitor pattern found.");
  out.push("");
  if (d.summary) out.push(...keyRecommendationsMarkdown(d.summary));
  out.push(...abCardsMarkdown(d.abTests));
  if (d.summary) out.push(`_${summaryDates(d.summary)}_`, "");
  const s = d.synthesis;
  if (s.state !== "current")
    out.push(
      `> **AI insights and recommendations ${s.state === "stale" ? "are out of date" : "are not written yet"}.** ${s.reason} How to get them: ${s.howTo}`,
      "",
    );
  if (!d.approved)
    out.push(
      "_No batch is approved for this stage yet; the games below are the proposed batch._",
      "",
    );
  if (d.leftOut.length)
    out.push(
      `_Not in this check: ${d.leftOut.join(", ")} (not on Google Play in ${d.market}). They are shown in the countries where they exist._`,
      "",
    );

  // The contents follow the summary (plan-reports 3C).
  out.push("## Contents", "", ...titles.map((s, i) => `${i + 1}. [${s}](#${slug(i)})`), "");

  out.push(head(1), "", ...sortingMarkdown(d.sorting));
  out.push(
    `Computed from ${d.coverage.used} of ${d.coverage.total} screenshots in the batch${d.coverage.missing.length ? ` (missing: ${d.coverage.missing.join(", ")})` : ""}. A **pattern** holds for (nearly) every competitor; a **partial pattern** for at least half of them.`,
    "",
  );
  const i = d.ai?.interpretation;
  if (i)
    out.push(
      d.ai?.current
        ? i.summary
        : `_From run ${d.ai?.runId}, written from older analyses:_ ${i.summary}`,
      "",
    );
  if (f?.patterns.length) {
    for (const g of Object.keys(GROUPS) as PatternFit["group"][]) {
      const rows = f.patterns.filter((x) => x.group === g);
      if (!rows.length) continue;
      out.push(
        `### ${GROUPS[g]}`,
        "",
        "| Our deck | Kind | Pattern | Evidence | Ours |",
        "|---|---|---|---|---|",
        ...rows.map(
          (x) =>
            `| ${fitMark(x)} | ${x.strength === "pattern" ? "pattern" : "partial"} | ${cell(x.text)}${defined(x)} | ${cell(x.evidence)} | ${cell(x.reason)} |`,
        ),
        "",
      );
    }
  } else
    out.push("Fewer than 2 competitor screenshots are analysed, so there are no patterns yet.", "");

  const ours = d.games.find((g) => g.ours);
  const theirs = d.games.filter((g) => !g.ours);
  const cols = [ours, ...theirs].filter((g): g is NonNullable<typeof g> => !!g);
  const max = Math.max(0, ...cols.flatMap((g) => g.rows.map((r) => r.position)));
  out.push(
    head(2),
    "",
    "One row per Google Play position: our screenshot first, then each competitor's screenshot at the same position.",
    "",
    ...(d.repeats ?? []).flatMap((r) => [
      `**Same screen uploaded twice: ${r.ours ? `${r.name} (ours)` : r.name}, ${r.total} images, ${r.unique} unique.** ${r.ours ? r.text : "Counted once in the patterns."}${r.counted ? "" : " This version was built before the check and counts every image."}`,
      "",
    ]),
    `| # | ${cols.map((g) => cell(g.ours ? `${g.name} (ours)` : g.name)).join(" | ")} | How ours compares |`,
    `|---|${cols.map(() => "---").join("|")}|---|`,
  );
  for (let p = 1; p <= max; p++) {
    const v = d.oursVs?.positions.find((x) => x.position === p);
    out.push(
      `| ${p} | ${cols
        .map((g) =>
          cellOf(
            g.rows.find((r) => r.position === p),
            g.name,
          ),
        )
        .join(
          " | ",
        )} | ${v ? `**${positionWord(v)}**${v.directive ? ` (${v.verdict})` : ""}: ${cell(v.reasons.join("; "))}` : ""} |`,
    );
  }
  out.push("");

  out.push(head(3), "");
  const r = d.ai?.recommendations;
  if (r && d.ai) {
    if (!d.ai.current) out.push(`_From run ${d.ai.runId}, written from older analyses._`, "");
    if (d.recProblems.length)
      out.push(
        "> **Check these slots: the label does not match the spec (found by code).**",
        ...d.recProblems.map((x) => `> - ${x}`),
        "",
      );
    out.push(
      "| # | Screen | Source | Headline |",
      "|---|---|---|---|",
      ...[...r.positions]
        .sort((a, b) => a.position - b.position)
        .map(
          (p) =>
            `| ${p.position} | ${cell(`${label(p.screenType)}${p.subtype ? ` / ${label(p.subtype)}` : ""}`)} | ${cell(p.source)} | ${cell(p.marketingLayer.texts[0]?.text ?? "")} |`,
        ),
      "",
    );
    const ex = (pos: number) =>
      (d.examples[String(pos)] ?? [])
        .map((e) => `${img(e.thumb, null, `${e.name} ${e.position}`)} ${e.name} #${e.position}`)
        .join(", ");
    const rec = recommendationSection(r, d.ai.review, d.ai.revised, label, ex);
    out.push(...rec.slice(1).map((l) => (l.startsWith("### ") ? `#${l}` : l)));
  } else out.push(`Not written yet. ${s.reason} How to get them: ${s.howTo}`, "");

  out.push(head(4), "", ...abDetailsMarkdown(d.abTests));

  out.push(head(5), "", ...storeTextMarkdown(d.storeText));

  if (research) out.push(head(6), "", ...research);
  out.push(head(titles.length - 1), "");
  if (d.patterns)
    out.push(
      ...patternSection(d.patterns, null, label)
        .slice(1)
        .map((l) => (l.startsWith("### ") ? `#${l}` : l)),
    );
  else out.push("No statistics yet.", "");
  return out;
}
