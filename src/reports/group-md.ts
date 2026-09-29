import type { GroupFinding, GroupsPart } from "./group-types.ts";
import { countryName } from "./names.ts";

/**
 * The group part in the written report (report.md view and the PDF), inside "Across countries":
 * the bottom line, our pages that differ, what is common everywhere, each group's findings with
 * their numbers, the recommendations framed as A/B tests, and the terms. Code only.
 */
const per = (f: GroupFinding) =>
  f.perCountry
    .map((p) =>
      f.dim === "deckLength"
        ? `${countryName(p.label)} ${p.of} images (${p.yes} different)`
        : `${countryName(p.label)} ${p.yes} of ${p.of}${p.ours === null ? "" : p.ours ? ", ours yes" : ", ours no"}`,
    )
    .join("; ");

const finding = (f: GroupFinding) => [
  `- **${f.title}.** ${f.text}`,
  `  - Per country: ${per(f)}.`,
  ...(f.sketch ? ["  - Sketch: schematic, not measured (shown on the page)."] : []),
];

export function groupsMarkdown(g: GroupsPart): string[] {
  const out: string[] = ["### Patterns across your countries", "", g.bottomLine, ""];
  for (const s of g.samePages)
    out.push(`> ${s.label} shows the same images as ${s.as} for every game.`, "");
  if (g.ours.length)
    out.push("#### Our pages differ between countries", "", ...g.ours.flatMap(finding), "");
  if (g.common.length || g.descriptive.length)
    out.push(
      "#### Common in every country",
      "",
      ...[...g.common, ...g.descriptive].flatMap(finding),
      "",
    );
  for (const s of g.groups) {
    out.push(`#### ${s.name}: ${s.countries.map((c) => countryName(c.label)).join(", ")}`, "");
    if (s.problem) {
      out.push(s.problem, "");
      continue;
    }
    out.push(
      ...(s.findings.length
        ? s.findings.flatMap(finding)
        : ["No group difference found on the main dimensions."]),
      "",
    );
    if (s.notAPattern.length)
      out.push("Not a pattern:", "", ...s.notAPattern.map((l) => `- ${l}`), "");
    out.push(`Play Console: ${s.setup}`, "");
  }
  if (g.recommendations.length) {
    out.push("#### Group recommendations, as A/B tests", "");
    g.recommendations.forEach((r, i) => {
      out.push(
        `${i + 1}. **${r.title}** (${r.variableName}; ${r.countries.map(countryName).join(", ")}). ${r.text}`,
        `   - Hypothesis: ${r.hypothesis}`,
        `   - Setup: ${r.setup.line}`,
        ...r.conflicts.map((c) => `   - Goes against: ${c}`),
      );
    });
    out.push("");
  }
  if (g.hint) out.push(`Hint: ${g.hint}`, "");
  out.push(g.main.note, "");
  return out;
}

/** The saved report.md with the group part inside "Across countries" (or before "Per country"). */
export function withGroupsMd(saved: string, g: GroupsPart | null): string {
  let md = saved;
  if (!g) return md;
  const lines = groupsMarkdown(g).join("\n");
  const top = /^## 1\. Overall recommendations\s*$/m.exec(md);
  if (top) {
    const at = top.index + top[0].length;
    md = `${md.slice(0, at)}\n\n**Across your countries:** ${g.bottomLine}${md.slice(at)}`;
  }
  const across = /^## \d+\. Across countries\s*$/m.exec(md);
  if (across) {
    const at = across.index + across[0].length;
    return `${md.slice(0, at)}\n\n${lines}\n${md.slice(at)}`;
  }
  const per = /^## \d+\. (Per country|Recommendations per country)\s*$/m.exec(md);
  const block = `## Across countries\n\n${lines}\n`;
  return per ? `${md.slice(0, per.index)}${block}\n${md.slice(per.index)}` : `${md}\n${block}`;
}
