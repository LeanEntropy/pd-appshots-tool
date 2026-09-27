import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Count } from "../analysis/patterns.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { ensureDir, readJsonIfExists, writeJsonAtomic } from "../util/fsx.ts";
import { buildOverview, type MarketOverview, type Overview } from "./overview.ts";

const pct = (n: number | null | undefined) =>
  n === null || n === undefined ? "n/a" : `${Math.round(n * 100)}%`;
const share = (cs: readonly Count[], key: string) => cs.find((c) => c.key === key)?.share ?? 0;
const list = (cs: readonly Count[], n = 3) =>
  cs
    .slice(0, n)
    .map((c) => `${c.key} ${pct(c.share)}`)
    .join(", ") || "none";
const ASIA = (m: MarketOverview) => m.gl !== "us" && m.gl !== "ph";

function table(ms: readonly MarketOverview[]): string[] {
  return [
    "| Country | Games | Images | Landscape | Portrait | Aspect ratios | Deck length (median, range) | Same image as US | Main colours (measured) |",
    "|---|---|---|---|---|---|---|---|---|",
    ...ms.map(
      (m) =>
        `| ${m.label} | ${m.games} | ${m.images} | ${pct(share(m.orientation, "landscape"))} | ${pct(share(m.orientation, "portrait"))} | ${list(m.ratios)} | ${m.deckLength.median} (${m.deckLength.min} to ${m.deckLength.max}) | ${m.gl === "us" ? "(baseline)" : pct(m.reusedFromUs)} | ${list(m.colours)} |`,
    ),
  ];
}

/** Landscape share of all images in the Asian markets (every country except the US and PH). */
export function asiaVsUs(ms: readonly MarketOverview[]): { us: number; asia: number } {
  const us = ms.find((m) => m.gl === "us");
  const asia = ms.filter(ASIA);
  const n = asia.reduce((a, m) => a + m.images, 0);
  const land = asia.reduce((a, m) => a + share(m.orientation, "landscape") * m.images, 0);
  return {
    us: us ? share(us.orientation, "landscape") : 0,
    asia: n ? Math.round((land / n) * 100) / 100 : 0,
  };
}

export function overviewMarkdown(o: Overview): string {
  const all = asiaVsUs(o.markets);
  const named = asiaVsUs(o.namedMarkets);
  const flips = o.games.filter(
    (g) => g.us !== null && g.asia !== null && (g.asia as number) - (g.us as number) >= 0.3,
  );
  return [
    "# Store overview (free, no AI)",
    "",
    `Computed by code from the downloaded store data (run ${o.runId}): ${o.totals.games} games, ${o.totals.images} store images in the phone sets (${o.totals.uniqueImages} unique). Tablet sets that Google Play appends after the phone set are not counted. Colours are measured from the pixels.`,
    "",
    `- **Landscape images in each country's top-grossing chart:** ${pct(all.us)} in the US vs ${pct(all.asia)} in the Asian markets. Named competitors and our game: ${pct(named.us)} in the US vs ${pct(named.asia)} in Asia (the same games keep the same orientation across countries).`,
    `- Named games that switch to landscape in Asia (30 points or more): ${flips.map((g) => g.name).join(", ") || "none"}.`,
    "- Note: the core check analyses US English only, so the AI analysis will confirm the Asian pattern only during the country expansions.",
    "",
    "## Each country's top-grossing chart, per country",
    "",
    "The games in that country's own top-grossing chart, as shown in that country's store.",
    "",
    ...table(o.markets),
    "",
    "## Named competitors and our game, per country",
    "",
    ...table(o.namedMarkets),
    "",
    "## Landscape share per named game: US vs Asia",
    "",
    "| Game | US | Asian markets |",
    "|---|---|---|",
    ...o.games.map((g) => `| ${g.name} | ${pct(g.us)} | ${pct(g.asia)} |`),
    "",
  ].join("\n");
}

export function overviewFile(loaded: LoadedConfig): string {
  return join(projectPaths(loaded).reports, "overview", "overview.md");
}

/** Builds and saves the overview (markdown + JSON, plus a dated copy). No AI call. */
export async function writeOverview(
  loaded: LoadedConfig,
): Promise<{ file: string; overview: Overview }> {
  const o = await buildOverview(loaded);
  const dir = join(projectPaths(loaded).reports, "overview");
  ensureDir(dir);
  const md = overviewMarkdown(o);
  const file = overviewFile(loaded);
  writeFileSync(file, md);
  writeFileSync(join(dir, `${o.createdAt.slice(0, 10)}.md`), md);
  writeJsonAtomic(join(dir, "overview.json"), o);
  return { file, overview: o };
}

export function readOverviewJson(loaded: LoadedConfig): Overview | undefined {
  return readJsonIfExists(join(projectPaths(loaded).reports, "overview", "overview.json")) as
    | Overview
    | undefined;
}
