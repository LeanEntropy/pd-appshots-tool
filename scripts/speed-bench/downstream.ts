/**
 * Downstream check (plan section 9, gate 3): the normalised inputs of every step that reads the
 * analyses, built from a copy of the core-check data where some readings are replaced.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { categoryOf } from "../../src/analysis/categories.ts";
import { batchEntries } from "../../src/analysis/entries.ts";
import { artMessage, showsLogo } from "../../src/analysis/image-tags.ts";
import { labeler } from "../../src/analysis/labels.ts";
import { layerDiffTask } from "../../src/analysis/layer-diff-schema.ts";
import { compareOurs } from "../../src/analysis/ours-vs.ts";
import { patternFit } from "../../src/analysis/pattern-fit.ts";
import { findPatterns } from "../../src/analysis/patterns.ts";
import type { AnalysisPlan } from "../../src/analysis/plan.ts";
import { withCurrentMapping } from "../../src/analysis/record-refresh.ts";
import type { AnalysisRecord } from "../../src/analysis/records.ts";
import type { ImageAnalysis } from "../../src/analysis/schema.ts";
import { brief } from "../../src/analysis/synthesis.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../../src/config/load.ts";
import type { ImageDb } from "../../src/store/imagedb.ts";

export function corePlan(loaded: LoadedConfig): AnalysisPlan {
  const dir = join(projectPaths(loaded).base, "state", "approved");
  const plans = readdirSync(dir)
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as AnalysisPlan)
    .filter((p) => p.stage === "core")
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const p = plans[0];
  if (!p) throw new Error("no approved core plan in the scratch copy");
  return p;
}

/** Every downstream input, as one object. */
export function downstream(
  loaded: LoadedConfig,
  plan: AnalysisPlan,
  records: ReadonlyMap<string, AnalysisRecord>,
  db: ImageDb,
  bench: readonly string[],
): Record<string, unknown> {
  const { taxonomy } = loadTaxonomy(loaded);
  const L = labeler(taxonomy);
  const all = withCurrentMapping(records);
  const e = batchEntries(plan, all, db, loaded.config.ourApp.id);
  const patterns = findPatterns(e.competitors, e.decks);
  const oursVs = compareOurs(e.ours, patterns, e.ourDeckLength, L);
  const fit = patternFit(e.competitors, e.ours, patterns, e.ourDeckLength, L);
  const entries = [...e.ours, ...e.competitors];
  const perImage: Record<string, unknown> = {};
  for (const id of bench) {
    const r = all.get(id);
    const f = r?.final as ImageAnalysis | undefined;
    if (!r || !f) continue;
    const game = r.identity?.game ?? r.appId;
    const entry = entries.find((x) => x.imageId === id);
    perImage[id.slice(0, 10)] = {
      category: categoryOf(f),
      logo: showsLogo(f, game),
      artMessage: artMessage(f, game),
      screenshotLine: entry ? brief(entry) : null,
      terminology: { headline: f.headline, texts: f.marketingLayer.texts.map((t) => [t.language, t.text]) },
      textComparisonAnchor: layerDiffTask(f, { label: "X", hl: "xx" }),
    };
  }
  return { patterns, oursVs, fit, perImage };
}

/** Paths whose values differ between two objects (arrays by index). */
export function diffPaths(a: unknown, b: unknown, path = ""): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) =>
      diffPaths(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        path ? `${path}.${k}` : k,
      ),
    );
  }
  return [path];
}

/** The downstream area a path belongs to (for the report), e.g. "patterns.colours". */
export function area(path: string): string {
  const parts = path.split(".");
  if (parts[0] === "perImage") return `per image: ${parts[2] ?? ""}`;
  return parts.slice(0, 2).join(".");
}
