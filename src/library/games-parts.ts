import { isUsable, readRecords } from "../analysis/records.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { projectKey, type Storage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";
import { countryName, gameNames, latestDecks, roleIn } from "./project-decks.ts";

/**
 * One project's part of the games index (plan-games-library 7.2/7.3): its games, their store
 * pages as its latest download saw them, and which of its pictures have a usable reading. A
 * part is rebuilt only when its stamp changes; the stamp uses only Storage reads.
 */
export interface PagePart {
  gl: string;
  hl: string;
  status: string;
  /** Picture hashes in store order (failed slots left out). */
  images: string[];
  failed: number;
  /** The day the store page was read ("" when unknown). */
  checked: string;
}

export interface GamePart {
  appId: string;
  name: string;
  role: string;
  /** "#3 in Japan", from the project's chart lists. */
  ranks: string[];
  pages: PagePart[];
}

export interface ProjectPart {
  projectId: string;
  stamp: string;
  games: GamePart[];
  /** Pictures with a usable reading as this project sees them. */
  analysed: string[];
}

const text = (storage: Storage, k: string) => {
  try {
    return storage.getText(k) ?? "";
  } catch {
    return "";
  }
};

/**
 * Cheap: project.json, the run names, the deck files, the job and refresh state, refs.json.
 * A second store-text read the same day, or a command-line change that touches none of these,
 * is seen after "Update the list" (known limit, said on the page).
 */
export function projectStamp(storage: Storage, projectId: string): string {
  const k = (...p: string[]) => projectKey({ projectId }, ...p);
  return stableHash([
    text(storage, k("project.json")),
    storage.children(k("runs")).sort(),
    [...storage.list(k("decks"))].sort(),
    text(storage, k("state", "job.json")),
    text(storage, k("state", "refreshes.json")),
    text(storage, k("refs.json")),
  ]);
}

export function buildPart(
  storage: Storage,
  projectId: string,
  loaded: LoadedConfig | null,
  stamp: string,
): ProjectPart {
  if (!loaded) return { projectId, stamp, games: [], analysed: [] };
  const decks = latestDecks(storage, projectId);
  const names = gameNames(decks, loaded.config);
  const byApp = new Map<string, GamePart>();
  for (const d of decks) {
    const g = byApp.get(d.appId) ?? {
      appId: d.appId,
      name: names.get(d.appId) ?? d.appId,
      role: roleIn(loaded.config, d.appId),
      ranks: Object.entries(d.chartRanks ?? {}).map(([gl, r]) => `#${r} in ${countryName(gl)}`),
      pages: [],
    };
    const slots = [...(d.slots ?? [])].sort((a, b) => a.position - b.position);
    g.pages.push({
      gl: d.gl,
      hl: d.hl,
      status: d.status,
      images: slots.flatMap((s) => (s.imageId ? [s.imageId] : [])),
      failed: slots.filter((s) => !s.imageId).length,
      checked: (d.fetchedAt ?? "").slice(0, 10),
    });
    byApp.set(d.appId, g);
  }
  let analysed: string[] = [];
  try {
    analysed = [...readRecords(projectPaths(loaded)).values()]
      .filter((r) => isUsable(r))
      .map((r) => r.imageId);
  } catch {}
  return { projectId, stamp, games: [...byApp.values()], analysed };
}
