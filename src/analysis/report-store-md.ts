import { cell } from "./report-sections.ts";
import type { StoreCountry } from "./store-compare.ts";

export const DERIVED_NOTE =
  "Keywords derived from the store text by the tool: the words and short phrases the title, tags and descriptions use most. Google Play has no official keywords. Matching is by exact words: other word forms and translations are not matched. Korean words keep their endings, so Korean counts are rougher.";

/** The report's "Store text and keywords" section body (markdown), per country. */
export function storeTextMarkdown(cs: readonly StoreCountry[] | undefined): string[] {
  if (!cs?.length)
    return [
      "No store text is saved for these games yet. It is read (free, no AI) by the next preview, or for the pages already downloaded with `npm run store-text`.",
      "",
    ];
  const out = [`_${DERIVED_NOTE}_`, ""];
  for (const c of cs) {
    out.push(
      `### ${c.label}`,
      "",
      "| Game | Category | Tags | Top keywords (derived) | Read |",
      "|---|---|---|---|---|",
    );
    for (const r of c.rows) {
      const name = cell(r.ours ? `**${r.name} (ours)**` : r.name);
      const s = r.store;
      out.push(
        s
          ? `| ${name} | ${cell(`${s.category ?? "not shown"}${s.chipCategory ? ` (first tag: ${s.chipCategory})` : ""}`)} | ${cell(s.tags.join(", "))} | ${cell(s.keywords.join(", "))} | ${s.date} |`
          : `| ${name} | not saved for this country | | | |`,
      );
    }
    out.push("");
    if (!c.oursSaved)
      out.push("Our store text is not saved for this country, so there is nothing to compare.", "");
    else if (c.missing.length)
      out.push(
        "**Competitor keywords not found in our store text** (used by 2 or more competitors):",
        "",
        ...c.missing.map((m) => `- ${cell(m.term)} (${cell(m.games.join(", "))})`),
        "",
      );
    else
      out.push("Every keyword that 2 or more competitors use also appears in our store text.", "");
  }
  return out;
}
