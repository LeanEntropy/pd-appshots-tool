import { randomBytes } from "node:crypto";
import { type CountryCatalogue, loadCountries } from "../config/countries.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { loadDefaults, loadProject, readSettings, workspaceDir } from "../config/project.ts";
import { isDraft, type ProjectSettings } from "../config/project-schema.ts";
import { markOpened, readRegistry, upsertEntry } from "../config/registry.ts";
import type { RunnerOptions } from "../jobs/index.ts";
import type { Fetcher } from "../play/icon.ts";
import { PlayLookup } from "../play/lookup.ts";
import type { ProjectState } from "../projects/state.ts";
import type { StoreDeps } from "../steps/add-competitor.ts";
import { PROJECT_ID, type Storage, workspaceStorage } from "../storage/index.ts";
import { statusPage } from "../view/pages-html.ts";

export type Loaded = { loaded: LoadedConfig } | { draft: ProjectSettings };

/** What every route needs: the workspace, the page token, and how to reach a project. */
export interface AppContext {
  root: string;
  storage: Storage;
  /** Written into each served page and required on every write request. */
  token: string;
  /** This server's identity, answered on /api/health (single-instance check). */
  nonce: string;
  names: (id: string) => string;
  /** A project by id: its runnable config, or its draft settings; null when unknown. */
  load: (id: string) => Loaded | null;
  /** Caches a project's derived state for the home screen. */
  remember: (id: string, s: ProjectState) => void;
  opened: (id: string) => void;
  /** The most recently opened project (for old links), or null. */
  recent: () => string | null;
  runner?: RunnerOptions;
  pages: { status: typeof statusPage };
  /** Google Play lookups and searches, through the one polite queue of this process. */
  play: PlayLookup;
  /** The country catalogue (read once). */
  countries: () => CountryCatalogue;
  /** Icon downloads (tests inject a fake). */
  fetcher?: Fetcher;
  /** Tests: store pages and images for an added competitor without the network. */
  storeDeps?: StoreDeps;
}

export interface AppOptions {
  root: string;
  token?: string;
  nonce?: string;
  runner?: RunnerOptions;
  /** Tests: serve these configs as projects instead of the registry. */
  projects?: LoadedConfig[];
  /** Tests: a lookup with a fake scraper. */
  play?: PlayLookup;
  fetcher?: Fetcher;
  storeDeps?: StoreDeps;
}

/** The store pacing of the tool defaults (800 ms), or that when the defaults cannot be read. */
function requestDelay(o: AppOptions): number {
  if (o.projects?.[0]) return o.projects[0].config.download.requestDelayMs;
  try {
    return loadDefaults(o.root).download.requestDelayMs;
  } catch {
    return 800;
  }
}

export function createAppContext(o: AppOptions): AppContext {
  const storage = o.projects?.[0]
    ? workspaceStorage(projectPaths(o.projects[0]).workspace)
    : workspaceStorage(workspaceDir(o.root));
  const fixed = new Map((o.projects ?? []).map((l) => [l.config.project, l]));
  const registry = () => (fixed.size ? null : readRegistry(storage));
  const entry = (id: string) => registry()?.projects.find((p) => p.id === id);
  let lastOpened: string | null = null;
  let countries: CountryCatalogue | undefined;
  return {
    play: o.play ?? new PlayLookup(storage, { delayMs: requestDelay(o) }),
    countries: () => {
      countries ??= loadCountries();
      return countries;
    },
    ...(o.fetcher ? { fetcher: o.fetcher } : {}),
    ...(o.storeDeps ? { storeDeps: o.storeDeps } : {}),
    root: o.root,
    storage,
    token: o.token ?? randomBytes(16).toString("hex"),
    nonce: o.nonce ?? randomBytes(16).toString("hex"),
    names: (id) => fixed.get(id)?.config.ourApp.name ?? entry(id)?.name ?? id,
    load(id) {
      // Checked before any path is built: no traversal across projects.
      if (!PROJECT_ID.test(id)) return null;
      const f = fixed.get(id);
      if (f) return { loaded: f };
      if (!entry(id)) return null;
      const s = readSettings(storage, { projectId: id });
      if (!s) return null;
      return isDraft(s) ? { draft: s } : { loaded: loadProject(id, { root: o.root }) };
    },
    remember(id, s) {
      const e = entry(id);
      if (!e || (e.summary?.line === s.line && e.summary.stage === s.stage)) return;
      upsertEntry(storage, {
        ...e,
        summary: { stage: s.stage, line: s.line, updatedAt: new Date().toISOString() },
      });
    },
    opened(id) {
      lastOpened = id;
      if (entry(id)) markOpened(storage, id);
    },
    recent() {
      const reg = registry();
      if (!reg) return lastOpened ?? [...fixed.keys()][0] ?? null;
      const live = reg.projects.filter((p) => !p.archived);
      live.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
      return live[0]?.id ?? null;
    },
    runner: o.runner,
    pages: { status: statusPage },
  };
}
