import type { Config } from "../config/schema.ts";
import type { PreviewSummary } from "../core/summary.ts";
import { type DeckTarget, deckKey } from "../core/targets.ts";
import { formatBytes } from "../util/cli-io.ts";
import { type DownloadPlan, humanCategory } from "./preview.ts";

function perGame(plan: DownloadPlan, targets: DeckTarget[]): string[] {
  const byApp = new Map<string, DeckTarget[]>();
  for (const t of targets) byApp.set(t.appId, [...(byApp.get(t.appId) ?? []), t]);
  const lines: string[] = [];
  for (const list of byApp.values()) {
    const first = list[0] as DeckTarget;
    const title = plan.listings[deckKey(first)]?.title;
    const cells = list.map((t) => {
      const l = plan.listings[deckKey(t)];
      const n =
        l?.status === "ok"
          ? String(l.screenshots.length)
          : l?.status === "unavailable"
            ? "not available"
            : "could not be read";
      return `${t.gl.toUpperCase()} ${n}`;
    });
    const store = title && title !== first.name ? ` (store title: ${title})` : "";
    lines.push(`    ${first.name}${store}: ${cells.join(", ")}`);
  }
  return lines;
}

/** Plain-language preview for the terminal. */
export function describePlan(plan: DownloadPlan, config: Config): string {
  const s = plan.summary;
  const label = (gl: string) => config.markets.find((m) => m.gl === gl)?.label ?? gl.toUpperCase();
  const row = (name: string, g: PreviewSummary["total"]) =>
    `  ${name.padEnd(18)} ${String(g.apps).padStart(3)} games ${String(g.decks).padStart(4)} store pages ${String(g.available).padStart(4)} available ${String(g.screenshots).padStart(5)} screenshots ${String(g.uniqueImages).padStart(5)} unique images`;
  const lines = [
    "Download preview",
    "",
    row("Our game", s.groups.ours),
    row("Named competitors", s.groups.named),
    row("Chart games", s.groups.chart),
    row("Total", s.total),
    "",
    "  Screenshots per game and country (after removing the store's repeated entries):",
    ...perGame(
      plan,
      plan.targets.filter((t) => t.group !== "chart"),
    ),
    `    Chart games: ${s.groups.chart.apps} games, listed per country in pending/download-preview.md`,
    "",
    `  Not available in that country: ${s.total.unavailable} store pages. Could not be read: ${s.total.failed}.`,
    `  Screenshots repeated in another store page (downloaded once): ${s.repeatedAcrossDecks}.`,
    `  Images to download: ${s.total.uniqueImages} (full resolution). Estimated disk space: ${formatBytes(s.estimatedBytes)} (${plan.bytesSource === "measured" ? "measured from a sample" : "rough estimate"}, about ${formatBytes(plan.bytesPerImage)} per image).`,
    "  AI-analysed images: 0. AI calls: 0.",
    "",
    `  Top ${(plan.charts[0]?.collection ?? "").toLowerCase().replace("_", " ")} chart games per country (${humanCategory(plan.category)}):`,
  ];
  for (const c of s.charts) {
    lines.push(
      c.status === "ok"
        ? `    ${label(c.gl).padEnd(32)} ${c.found} found, ${c.newGames} not already ours or a named competitor`
        : `    ${label(c.gl).padEnd(32)} could not be read`,
    );
  }
  if (plan.incomplete.length) {
    lines.push(
      "",
      "  Warning: this preview is incomplete. Run the preview again later, or download what is available:",
    );
    for (const n of plan.incomplete.slice(0, 10)) lines.push(`    ${n}`);
  }
  return lines.join("\n");
}

/** Full per-store-page table, written next to the plan for review. */
export function previewMarkdown(plan: DownloadPlan, config: Config): string {
  const label = (gl: string) => config.markets.find((m) => m.gl === gl)?.label ?? gl.toUpperCase();
  const group = { ours: "Our game", named: "Named competitor", chart: "Chart game" };
  const lines = [
    "# Download preview",
    "",
    `Made ${plan.createdAt}. No images downloaded yet. AI calls: 0.`,
    "",
    "| Group | Game | Country | Chart position | Screenshots | Status |",
    "|---|---|---|---|---|---|",
  ];
  for (const t of plan.targets) {
    const l = plan.listings[deckKey(t)];
    const ranks = Object.entries(t.chartRanks)
      .map(([gl, r]) => `${gl.toUpperCase()} #${r}`)
      .join(", ");
    const status =
      l?.status === "ok"
        ? "available"
        : l?.status === "unavailable"
          ? "not available"
          : "could not be read";
    lines.push(
      `| ${group[t.group]} | ${l?.title ?? t.name} | ${label(t.gl)} | ${ranks} | ${l?.screenshots.length ?? 0} | ${status} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}
