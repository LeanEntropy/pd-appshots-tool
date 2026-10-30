import { coreOrder, type LoadedConfig, projectPaths, writeRunConfig } from "../config/load.ts";
import type { Config } from "../config/schema.ts";
import { type DeckManifest, readDeck } from "../store/manifest.ts";
import { type FitCandidate, type FitResult, fitCore, slotCount } from "./fit.ts";
import { mainMarket } from "./targets.ts";

/** The core-market deck of an app, or undefined when missing or unavailable. */
export function coreDeck(loaded: LoadedConfig, appId: string): DeckManifest | undefined {
  const m = mainMarket(loaded.config);
  const d = readDeck(projectPaths(loaded).decks, { appId, gl: m.gl, hl: m.hl });
  return d?.status === "ok" ? d : undefined;
}

/**
 * Named competitors that are not on Google Play in the core country (their store page there was
 * confirmed "not available"): they are left out of the core check, not an error.
 */
export function notInCoreMarket(loaded: LoadedConfig): { appId: string; name: string }[] {
  const m = mainMarket(loaded.config);
  const decks = projectPaths(loaded).decks;
  return loaded.config.competitors
    .filter((c) => readDeck(decks, { appId: c.id, gl: m.gl, hl: m.hl })?.status === "unavailable")
    .map((c) => ({ appId: c.id, name: c.name }));
}

/** Slots analysed under the configured device classes (store order kept). */
export function analysedSlots(config: Config, deck: DeckManifest | undefined) {
  return (deck?.slots ?? []).filter((s) => config.core.deviceClasses.includes(s.deviceClass));
}

export function candidate(loaded: LoadedConfig, appId: string, name: string): FitCandidate {
  const deck = coreDeck(loaded, appId);
  const n = analysedSlots(loaded.config, deck).length;
  return { appId, name, deckLength: n, leftOut: (deck?.deckLength ?? 0) - n };
}

export interface FitView {
  fit: FitResult;
  slots: number;
  ours: FitCandidate;
  /** Whole decks including left-out device classes. */
  wholeDeckTotal: number;
  /** The recommended number of competitors (below it the check is a small sample). */
  minCompetitors: number;
}

/** Whole-deck fit rule for a given order (default: the saved pick, else config order). */
export function fitFor(loaded: LoadedConfig, order?: string[]): FitView {
  const { config } = loaded;
  const names = new Map(config.competitors.map((c) => [c.id, c.name]));
  const ids = order ?? coreOrder(loaded, projectPaths(loaded));
  const candidates = ids.map((id) => candidate(loaded, id, names.get(id) ?? id));
  const ours = candidate(loaded, config.ourApp.id, config.ourApp.name);
  const fit = fitCore(ours.deckLength, candidates, {
    cap: config.core.imageCap,
    target: config.core.imageTarget,
    minCompetitors: config.core.minCompetitors,
    maxCompetitors: config.core.maxCompetitors,
  });
  const whole = [ours, ...fit.selected].reduce((n, c) => n + c.deckLength + (c.leftOut ?? 0), 0);
  const slots = slotCount(
    fit.selected.map((s) => s.deckLength),
    config.core.slotCountCap,
  );
  return { fit, slots, ours, wholeDeckTotal: whole, minCompetitors: config.core.minCompetitors };
}

/**
 * Resolves a pick given as package ids or game names (case-insensitive).
 * Returns plain-language problems instead of throwing, so the page and CLI can show them.
 */
export function resolvePick(
  config: Config,
  items: readonly string[],
): { ids: string[]; problems: string[] } {
  const problems: string[] = [];
  const ids: string[] = [];
  for (const raw of items.map((s) => s.trim()).filter(Boolean)) {
    const c = config.competitors.find(
      (x) => x.id === raw || x.name.toLowerCase() === raw.toLowerCase(),
    );
    if (!c) problems.push(`"${raw}" is not a named competitor in the config.`);
    else if (ids.includes(c.id)) problems.push(`${c.name} is listed twice.`);
    else ids.push(c.id);
  }
  return { ids, problems };
}

/** Saves the pick into the run config. A new pick always clears an earlier confirmation. */
export function savePick(
  loaded: LoadedConfig,
  ids: string[],
  source: "page" | "cli" | "file",
): FitView {
  writeRunConfig(projectPaths(loaded), {
    coreCompetitors: ids,
    source,
    updatedAt: new Date().toISOString(),
  });
  return fitFor(loaded, ids);
}
