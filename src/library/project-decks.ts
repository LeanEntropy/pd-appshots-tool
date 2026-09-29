import { loadCountries } from "../config/countries.ts";
import type { Config } from "../config/schema.ts";
import { projectKey, type Storage } from "../storage/index.ts";
import { type DeckManifest, withDeckClasses } from "../store/manifest.ts";

/**
 * Small shared readers for the library pages (image page, games directory, game page), all
 * through Storage: a project's decks as its latest download run saw them, game names, a game's
 * role in a project, and plain country names.
 */
export function latestRunId(storage: Storage, projectId: string): string | null {
  const runs = storage
    .children(projectKey({ projectId }, "runs"))
    .filter((d) => d.endsWith("-setup"))
    .sort();
  for (const id of runs.reverse())
    if (storage.exists(projectKey({ projectId }, "runs", id, "manifest.json"))) return id;
  return null;
}

/** The decks of the project's latest download run (what the project page shows). */
export function latestDecks(storage: Storage, projectId: string): DeckManifest[] {
  const id = latestRunId(storage, projectId);
  if (!id) return [];
  try {
    const m = storage.getJson(projectKey({ projectId }, "runs", id, "manifest.json")) as
      | { decks?: DeckManifest[] }
      | undefined;
    return (Array.isArray(m?.decks) ? m.decks : []).map(withDeckClasses);
  } catch {
    return [];
  }
}

/** appId -> the game's store name (the deck title, else the name the project gave it). */
export function gameNames(decks: readonly DeckManifest[], config?: Config): Map<string, string> {
  const out = new Map<string, string>();
  if (config) {
    out.set(config.ourApp.id, config.ourApp.name);
    for (const c of config.competitors) out.set(c.id, c.name);
  }
  for (const d of decks) if (d.title || !out.has(d.appId)) out.set(d.appId, d.title || d.name);
  return out;
}

const TIER: Record<string, string> = {
  direct: "direct competitor",
  same_audience: "same-audience competitor",
  reference: "reference game",
};

/** The game's role in a project, in plain words. */
export function roleIn(config: Config, appId: string): string {
  if (config.ourApp.id === appId) return "our game";
  const c = config.competitors.find((x) => x.id === appId);
  return c ? (TIER[c.tier] ?? "competitor") : "chart game";
}

let names: Map<string, string> | null = null;

/** "Japan"; an unknown code in capitals. */
export function countryName(gl: string): string {
  names ??= new Map(loadCountries().countries.map((c) => [c.gl, c.label]));
  return names.get(gl.toLowerCase()) ?? gl.toUpperCase();
}
