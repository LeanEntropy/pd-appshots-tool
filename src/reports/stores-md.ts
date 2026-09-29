import { MARK_NAMES, type PairResult, type StoresReport } from "./stores-types.ts";

/** The written report of a "Google Play vs App Store" version (the PDF export prints it). */
const store = (s: "play" | "appstore") => (s === "play" ? "Google Play" : "App Store");
const cell = (s: string) => s.replace(/\|/g, "/").replace(/\n/g, " ");

function pairMd(r: PairResult): string[] {
  if (r.state.play !== "ok" || r.state.apple !== "ok")
    return [
      `### ${r.name}${r.ours ? " (ours)" : ""}`,
      `Not comparable: Google Play ${r.state.play === "ok" ? "held" : r.state.play === "not-sold" ? "not sold here" : "not read"}, App Store ${r.state.apple === "ok" ? "held" : r.state.apple === "not-sold" ? "not sold here" : "not read"}.`,
    ];
  return [
    `### ${r.name}${r.ours ? " (ours)" : ""}`,
    `${r.count.play} images on Google Play, ${r.count.apple} on the App Store; order ${r.order === "same" ? "kept" : r.order === "reordered" ? "changed" : "not comparable"}; orientation ${r.orientation.play} / ${r.orientation.apple}.`,
    "",
    "| # | Google Play | App Store | How they relate | Text |",
    "|---|---|---|---|---|",
    ...r.rows.map(
      (w) =>
        `| ${w.n} | ${cell(w.play?.reading?.screen ?? (w.play ? "not analysed" : "none"))} | ${cell(w.apple?.reading?.screen ?? (w.apple ? "not analysed" : "none"))} | ${w.apple ? `${MARK_NAMES[w.apple.mark]}${w.apple.playPosition ? ` (Google Play #${w.apple.playPosition})` : ""}` : ""} | ${w.text ?? ""} |`,
    ),
    "",
  ];
}

export function storesMarkdown(r: StoresReport): string {
  const out: string[] = [
    "# Google Play vs App Store",
    "",
    "## Bottom line",
    "",
    r.summary.verdict,
    "",
    ...r.summary.points.map((p) => `- ${p}`),
    "",
  ];
  if (r.recommendations.length) {
    out.push("## Recommendations", "");
    for (const x of r.recommendations)
      out.push(
        `${x.priority}. **${store(x.store)}: ${x.title}.** ${x.action} _Why:_ ${x.why}${x.rule ? ` (enforced: ${x.rule})` : ""}`,
      );
    out.push("");
  }
  if (r.tests.length) {
    out.push("## A/B tests to run next", "");
    for (const t of r.tests)
      out.push(
        `### ${store(t.store)}: ${t.title}`,
        "",
        `- Hypothesis: ${t.hypothesis}`,
        `- Evidence: ${t.evidence}`,
        `- Control: ${t.control}`,
        ...t.treatments.map(
          (v, i) => `- ${t.store === "appstore" ? "Treatment" : "Variant"} ${i + 1}: ${v}`,
        ),
        `- Metric: ${t.metric}`,
        `- Setup: ${t.setup.line}`,
        ...t.setup.notes.map((n) => `  - ${n}`),
        "",
      );
  }
  out.push("## Patterns across competitors", "");
  for (const p of r.patterns)
    out.push(
      `- ${p.country}: ${p.n} of ${p.of} competitors ${p.statement}${p.pattern ? " (pattern)" : ""}; ours: ${p.oursNote}.`,
    );
  out.push("", "## Position by position", "");
  for (const c of r.countries) {
    out.push(`## ${c.label}`, "");
    for (const pr of r.pairs.filter((x) => x.gl === c.gl)) out.push(...pairMd(pr));
  }
  out.push("## About this data", "", ...r.caveats.map((c) => `- ${c}`));
  if (r.leftOut.length) out.push(`- Not sold there: ${r.leftOut.join(", ")}.`);
  return `${out.join("\n")}\n`;
}
