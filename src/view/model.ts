import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config/schema.ts";
import type { Group } from "../core/targets.ts";
import type { ImageDb } from "../store/imagedb.ts";
import type { DeckManifest, RunManifest } from "../store/manifest.ts";
import { readJson } from "../util/fsx.ts";

/** Short analysis summary shown under a thumbnail (from the analysis stage). */
export interface ViewAnalysis {
  screen: string;
  headline: string;
  status: string;
}

export interface ViewImage {
  position: number;
  imageId: string | null;
  analysis: ViewAnalysis | null;
  /** Paths relative to the images folder; null when the download failed. */
  thumb: string | null;
  full: string | null;
  width: number;
  height: number;
  device: string;
  sameAsBaseline: boolean;
}

export interface ViewDeck {
  gl: string;
  hl: string;
  label: string;
  status: string;
  length: number;
  rawCount: number;
  images: ViewImage[];
}

export interface ViewApp {
  appId: string;
  name: string;
  group: Group;
  tier: string;
  chartRanks: Record<string, number>;
  baselineLength: number;
  /** Baseline screenshots of the analysed device classes (what counts in the core check). */
  analysedLength: number;
  decks: ViewDeck[];
}

export interface ViewModel {
  project: string;
  runId: string;
  createdAt: string;
  core: { cap: number; target: number; min: number; max: number };
  ours: ViewApp[];
  named: ViewApp[];
  chart: ViewApp[];
  selection: string[];
  markets: { gl: string; label: string }[];
  coreMarket: { gl: string; hl: string; label: string };
  deviceClasses: string[];
  pilotCompetitors: number;
}

export function latestRun(runsDir: string): RunManifest | undefined {
  if (!existsSync(runsDir)) return undefined;
  const ids = readdirSync(runsDir)
    .filter((d) => d.endsWith("-setup") && existsSync(join(runsDir, d, "manifest.json")))
    .sort();
  const last = ids.at(-1);
  return last ? (readJson(join(runsDir, last, "manifest.json")) as RunManifest) : undefined;
}

/** Builds the page/markdown data model from an immutable run manifest (deterministic). */
export function buildViewModel(
  config: Config,
  run: RunManifest,
  db: ImageDb,
  selection: string[],
  analyses: ReadonlyMap<string, ViewAnalysis> = new Map(),
): ViewModel {
  const baseline = config.markets.find((m) => m.baseline) ?? config.markets[0];
  const label = (gl: string, hl: string) => {
    const m = config.markets.find((x) => x.gl === gl && x.hl === hl);
    return m ? m.label : `${gl} (${hl})`;
  };
  const order = new Map(config.markets.map((m, i) => [`${m.gl}|${m.hl}`, i]));
  const byApp = new Map<string, DeckManifest[]>();
  for (const d of run.decks) byApp.set(d.appId, [...(byApp.get(d.appId) ?? []), d]);

  const apps: ViewApp[] = [];
  for (const [appId, decks] of byApp) {
    decks.sort(
      (a, b) => (order.get(`${a.gl}|${a.hl}`) ?? 99) - (order.get(`${b.gl}|${b.hl}`) ?? 99),
    );
    const first = decks[0] as DeckManifest;
    const base = decks.find((d) => d.gl === baseline?.gl && d.hl === baseline?.hl);
    const baseIds = new Set(base?.slots.map((s) => s.imageId) ?? []);
    apps.push({
      appId,
      name: decks.find((d) => d.title)?.title ?? first.name,
      group: first.group,
      tier: first.tier,
      chartRanks: first.chartRanks,
      baselineLength: base?.status === "ok" ? base.deckLength : 0,
      analysedLength:
        base?.status === "ok"
          ? base.slots.filter((s) => config.core.deviceClasses.includes(s.deviceClass)).length
          : 0,
      decks: decks.map((d) => ({
        gl: d.gl,
        hl: d.hl,
        label: label(d.gl, d.hl),
        status: d.status,
        length: d.deckLength,
        rawCount: d.rawCount,
        images: d.slots.map((s) => {
          const rec = s.imageId ? db.get(s.imageId) : undefined;
          return {
            position: s.position,
            imageId: s.imageId,
            analysis: (s.imageId && analyses.get(s.imageId)) || null,
            thumb: rec?.thumb ?? null,
            full: rec?.file ?? null,
            width: s.width,
            height: s.height,
            device: s.deviceClass,
            sameAsBaseline: d !== base && !!s.imageId && baseIds.has(s.imageId),
          };
        }),
      })),
    });
  }
  const namedOrder = new Map(config.competitors.map((c, i) => [c.id, i]));
  const bestRank = (a: ViewApp) => Math.min(99, ...Object.values(a.chartRanks));
  return {
    project: config.project,
    runId: run.runId,
    createdAt: run.createdAt,
    core: {
      cap: config.core.imageCap,
      target: config.core.imageTarget,
      min: config.core.minCompetitors,
      max: config.core.maxCompetitors,
    },
    ours: apps.filter((a) => a.group === "ours"),
    named: apps
      .filter((a) => a.group === "named")
      .sort((a, b) => (namedOrder.get(a.appId) ?? 99) - (namedOrder.get(b.appId) ?? 99)),
    chart: apps
      .filter((a) => a.group === "chart")
      .sort((a, b) => bestRank(a) - bestRank(b) || a.name.localeCompare(b.name)),
    selection,
    markets: config.markets.map((m) => ({ gl: m.gl, label: m.label })),
    coreMarket: (() => {
      const m = config.markets.find((x) => x.gl === config.core.market) ?? baseline;
      return { gl: m?.gl ?? "", hl: m?.hl ?? "", label: m?.label ?? "" };
    })(),
    deviceClasses: [...config.core.deviceClasses],
    pilotCompetitors: config.core.pilotCompetitors,
  };
}
