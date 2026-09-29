import { noFactIds } from "../analysis/country-advice-schema.ts";
import { countryName } from "./names.ts";
import type { TerminologyCountry } from "./terminology.ts";
import {
  type AdviceTerm,
  tallyText,
  type WordRow,
  type WordsBlock,
  wordsBlock,
} from "./words-status.ts";

/**
 * "Words to use" in the written report (report.md, and the PDF printed from it): a one-line
 * tally and a plain table with [V] / [X] per term. Saved versions written before the table get
 * it when shown: their old bullet list is rebuilt exactly as it was written and swapped.
 */
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");

export function statusText(r: WordRow): string {
  switch (r.status) {
    case "keep":
      return "[V] Correct, keep";
    case "change":
      return `[X] Change: ${r.from ?? "ours"} → ${r.use}`;
    case "add":
      return "[X] Add";
    case "optional":
      return "Optional";
    default:
      return "Check";
  }
}

const list = (xs: string[]) => (xs.length ? xs.join(", ") : "–");

export function wordsTableMd(b: WordsBlock, label: string): string[] {
  if (!b.rows.length) return [];
  return [
    `**Words to use in ${countryName(label)}: ${tallyText(b.tally)}**`,
    "",
    "| Status | Idea | Word to use | We use now: images / store text | Competitors | Why |",
    "|---|---|---|---|---|---|",
    ...b.rows.map(
      (r) =>
        `| ${cell(statusText(r))} | ${cell(r.concept)} | **${cell(r.use)}**${r.meaning ? ` – ${cell(r.meaning)}` : ""} | ${cell(list(r.ours.images))} / ${cell(list(r.ours.store))} | ${r.competitors ? `${r.competitors.n} of ${r.competitors.of}` : "–"} | ${cell(r.reason)} |`,
    ),
    "",
  ];
}

/** The bullet list older versions wrote, line for line (see git history of country-md.ts). */
function oldList(terms: readonly AdviceTerm[]): string {
  return terms
    .map(
      (t) =>
        `- ${t.concept}: use **${t.use}**${t.avoid ? `, not ${t.avoid}` : ""}. ${noFactIds(t.why)}`,
    )
    .join("\n");
}

interface ReportLike {
  advice?: { gl?: string; label?: string; advice?: { terms?: AdviceTerm[] } | null }[];
  terminology?: TerminologyCountry[];
}

/** A saved report.md with each country's old "words to use" list replaced by the table. */
export function upgradeWordsMd(md: string, r: ReportLike): string {
  let out = md;
  for (const a of r.advice ?? []) {
    const terms = a.advice?.terms;
    if (!Array.isArray(terms) || !terms.length) continue;
    const old = `\n${oldList(terms)}\n`;
    if (!out.includes(old)) continue;
    const t = (r.terminology ?? []).find((x) => x.gl === a.gl) ?? null;
    const table = wordsTableMd(wordsBlock(terms, t), a.label ?? a.gl ?? "");
    out = out.replace(old, () => `\n${table.join("\n")}`);
  }
  return out;
}
