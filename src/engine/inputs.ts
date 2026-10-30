import { type BatchEntries, batchEntries, planRepeats } from "../analysis/entries.ts";
import type { AnalysisPlan } from "../analysis/plan.ts";
import type { AnalysisRecord } from "../analysis/records.ts";
import type { LoadedConfig, ProjectPaths } from "../config/load.ts";
import { projectPaths } from "../config/load.ts";
import { readLayoutFile } from "../layout/store.ts";
import { latestStoreText } from "../library/store-text.ts";
import { appSegment } from "../play/answers.ts";
import { key, type Storage, workspaceStorage } from "../storage/index.ts";
import type { ImageDb } from "../store/imagedb.ts";
import type { DeckManifest } from "../store/manifest.ts";
import { latestRun } from "../view/model.ts";
import { attributesFromNotes, type ImageAttributes, mergeAttributes } from "./attributes.ts";
import { readSavedAttributes } from "./attributes-store.ts";
import type { EngineInput, EngineResult } from "./engine.ts";
import type { GameMarket } from "./leaders.ts";
import { engineOf } from "./report.ts";

export { withEngine } from "./report.ts";

/**
 * What the engine reads from disk (no AI, no network): installs from the cached store details,
 * the grossing chart rank from the latest download run, the image attributes (analysis notes,
 * the backfill, the saved layout) and the store text of every project competitor.
 */
type Details = {
  value?: { installs?: string; realInstalls?: number; maxInstalls?: number } | null;
};

/** Installs (cached US details, any age: installs are global) and grossing rank in `gl`. */
export function marketData(
  storage: Storage,
  paths: Pick<ProjectPaths, "runs">,
  games: readonly { appId: string; name: string }[],
  gl: string,
): GameMarket[] {
  const decks: DeckManifest[] = latestRun(paths.runs)?.decks ?? [];
  return games.map((g) => {
    let d: Details | undefined;
    try {
      d = storage.getJson(
        key("shared", "cache", "play", "details", appSegment(g.appId), "us-en.v2.json"),
      ) as Details | undefined;
    } catch {
      d = undefined;
    }
    const rank = decks.find((x) => x.appId === g.appId && x.chartRanks?.[gl] !== undefined)
      ?.chartRanks?.[gl];
    return {
      appId: g.appId,
      name: g.name,
      installs: d?.value?.installs || null,
      realInstalls: d?.value?.realInstalls ?? d?.value?.maxInstalls ?? null,
      grossingRank: rank ?? null,
    };
  });
}

/** One image's attributes: its analysis notes first, then the backfill, then its saved layout. */
export function attributesOf(
  paths: ProjectPaths,
  records: ReadonlyMap<string, AnalysisRecord>,
): (imageId: string) => ImageAttributes | null {
  return (id) => {
    const r = records.get(id);
    if (!r?.final) return null;
    const layout = readLayoutFile(paths, r)?.layout ?? null;
    const fromLayout: Partial<ImageAttributes> | null = layout
      ? {
          hudVisible: layout.inGame.some((e) => e.role === "hud") || null,
          focusMatch:
            layout.composition.focusMatch.verdict === "no marketing layer"
              ? null
              : layout.composition.focusMatch.verdict,
          from: ["layout"],
        }
      : null;
    return mergeAttributes(
      attributesFromNotes(r.final.notes),
      readSavedAttributes(paths, id),
      fromLayout,
    );
  };
}

/** The store listing input: every project competitor's saved store text, per country. */
export function metaInput(
  loaded: LoadedConfig,
  storage: Storage,
  market: GameMarket[],
): NonNullable<EngineInput["meta"]> {
  const c = loaded.config;
  const cache = new Map<string, ReturnType<typeof latestStoreText>>();
  return {
    markets: c.markets.map((m) => ({ gl: m.gl, hl: m.hl, label: m.label })),
    ours: { appId: c.ourApp.id, name: c.ourApp.name },
    competitors: c.competitors.map((x) => ({ appId: x.id, name: x.name })),
    text: (appId, gl, hl) => {
      const k = `${appId}|${gl}|${hl}`;
      if (!cache.has(k)) cache.set(k, latestStoreText(storage, appId, gl, hl));
      return cache.get(k)?.official ?? null;
    },
    market,
  };
}

/** The engine for an analysis run's entries (installs, chart rank and store text read from disk). */
export function engineForPlan(
  loaded: LoadedConfig,
  gl: string,
  entries: Pick<BatchEntries, "ours" | "competitors" | "decks" | "ourDeckLength">,
): EngineResult {
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const all = loaded.config.competitors.map((c) => ({ appId: c.id, name: c.name }));
  const market = marketData(storage, paths, all, gl);
  return engineOf(entries, market, metaInput(loaded, storage, market));
}

/** An analysis run's entries, with the image attributes the engine reads. */
export function runEntries(
  loaded: LoadedConfig,
  plan: AnalysisPlan,
  records: ReadonlyMap<string, AnalysisRecord>,
  db: ImageDb,
): BatchEntries {
  const paths = projectPaths(loaded);
  const repeats = planRepeats(paths, db, plan, records);
  const attrs = attributesOf(paths, records);
  return batchEntries(plan, records, db, loaded.config.ourApp.id, repeats, undefined, attrs);
}
