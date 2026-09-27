import type { AnalysisPlan } from "./plan.ts";

const usd = (n: number) => `$${n.toFixed(2)}`;
const STAGE = { pilot: "Core pilot", core: "Core check" };

/** The approval screen, in plain language. */
export function describeAnalysisPlan(p: AnalysisPlan): string {
  const lines = [
    `${STAGE[p.stage]}: approval needed before any AI call`,
    "",
    `Market: ${p.market.label}. Games and screenshot positions included:`,
    ...p.games.map(
      (g) => `  ${g.name}: positions ${g.positions.join(", ") || "none"} (${g.positions.length})`,
    ),
  ];
  if (p.excluded.length) {
    lines.push(`Left out (kept and shown raw, not analysed): ${p.excluded.length}`);
    const byGame = new Map<string, number[]>();
    for (const e of p.excluded)
      byGame.set(`${e.name}: ${e.reason}`, [
        ...(byGame.get(`${e.name}: ${e.reason}`) ?? []),
        e.position,
      ]);
    for (const [k, v] of byGame) lines.push(`  ${k}, positions ${v.join(", ")}`);
  }
  lines.push(
    "",
    "Images by cost level:",
    `  Identical to an image already analysed (no AI): ${p.counts.identical}`,
    `  Same picture as an analysed English image, new text (marketing-layer diff): ${p.counts.layerDiff}`,
    `  Full analysis: ${p.counts.full}`,
    `  New images counted against the core cap: ${p.counts.newImages}. Core total after this batch: ${p.coreTotal} of ${p.cap}${p.withinCap ? "" : " (over the cap: this batch will not run)"}.`,
    "",
    "Model passes:",
    ...p.estimate.passes.map(
      (m) => `  ${m.role} (${m.model}): ${m.calls} calls, ${m.images} images; ${m.note}`,
    ),
    "",
    `Estimated cost: ${usd(p.estimate.usd[0])} to ${usd(p.estimate.usd[1])} on Claude, plus about ${Math.round(p.estimate.gptTokens / 1000)}k GPT tokens for the second opinion. Provisional: the pilot measures the real costs.`,
    `Settling disagreements is estimated at ${p.estimate.expectedDisputes} images; the real number depends on the second opinion.`,
    p.synthesisNeeded
      ? "After the screenshots: patterns across competitors (by code), our game vs the patterns, and recommendations (Opus, checked by GPT), then the final report."
      : "Patterns and recommendations for this data are already written.",
  );
  return lines.join("\n");
}
