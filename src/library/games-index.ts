import { z } from "zod";
import { splitStoreTitle } from "../analysis/brand.ts";
import type { LoadedConfig } from "../config/load.ts";
import type { Storage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";
import { appIconSrc } from "./app-icon.ts";
import {
  buildPart,
  type Platform,
  type ProjectPart,
  platformOf,
  projectStamp,
} from "./games-parts.ts";
import { byRecent, type ProjectInfo, projectInfos } from "./image-uses.ts";
import { latestStoreText } from "./store-text.ts";

/**
 * The games directory's saved list (plan-games-library 3, 7.2): shared/index/games.v1.json, a
 * cache that can be deleted without loss. Metadata only: every game any project holds, its
 * store pages, counts, ASO words, keywords and where it is used. Built from data on disk; never
 * reads Google Play, never calls a model.
 */
export const GAMES_KEY = "shared/index/games.v1.json";

export interface GameEntry {
  appId: string;
  name: string;
  icon: string | null;
  category: string;
  /** Store pages; a missing platform (lists saved before it) means Google Play. */
  pages: {
    platform: Platform;
    gl: string;
    hl: string;
    images: number;
    checked: string;
    status: string;
  }[];
  images: number;
  countries: number;
  analysed: number;
  /** The second part of a two-part store title (ASO words), main page first. */
  aso: string;
  asoDiffers: number;
  keywords: { gl: string; terms: string[] }[];
  uses: { projectId: string; project: string; role: string; archived: boolean; ranks: string[] }[];
  latestCheck: string;
  /** Searchable text: name, ASO words, keywords (lower case, accents removed). */
  search: string;
}

const Saved = z.object({
  version: z.literal(1),
  builtAt: z.string(),
  storeStamp: z.string(),
  parts: z.record(
    z.string(),
    z.custom<ProjectPart>((v) => !!v && typeof v === "object"),
  ),
  games: z.array(z.custom<GameEntry>((v) => !!v && typeof v === "object")),
});
export type SavedIndex = z.infer<typeof Saved>;

export function readIndex(storage: Storage): SavedIndex | null {
  try {
    const r = Saved.safeParse(storage.getJson(GAMES_KEY));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

/** Which store pages have saved text: names only (one listing), to notice new reads. */
export function storeStamp(storage: Storage): string {
  return stableHash([...storage.list("library/store-text")].sort());
}

function merge(storage: Storage, parts: ProjectPart[], infos: ProjectInfo[]): GameEntry[] {
  const info = new Map(infos.map((p) => [p.id, p]));
  const analysed = new Set(parts.flatMap((p) => p.analysed));
  const games = new Map<string, GameEntry & { shas: Set<string> }>();
  const ordered = [...parts].sort((a, b) => {
    const x = info.get(a.projectId);
    const y = info.get(b.projectId);
    return x && y ? byRecent(x, y) : 0;
  });
  for (const part of ordered) {
    const p = info.get(part.projectId);
    for (const g of part.games) {
      const e = games.get(g.appId) ?? {
        appId: g.appId,
        name: g.name,
        icon: appIconSrc(storage, g.appId),
        category: "",
        pages: [],
        images: 0,
        countries: 0,
        analysed: 0,
        aso: "",
        asoDiffers: 0,
        keywords: [],
        uses: [],
        latestCheck: "",
        search: "",
        shas: new Set<string>(),
      };
      for (const pg of g.pages) {
        const platform = platformOf(pg.platform);
        const had = e.pages.find(
          (x) => x.platform === platform && x.gl === pg.gl && x.hl === pg.hl,
        );
        const row = {
          platform,
          gl: pg.gl,
          hl: pg.hl,
          images: pg.images.length,
          checked: pg.checked,
          status: pg.status,
        };
        if (!had) e.pages.push(row);
        else if (pg.checked > had.checked) Object.assign(had, row);
        if (pg.status === "ok") for (const s of pg.images) e.shas.add(s);
      }
      e.uses.push({
        projectId: part.projectId,
        project: p?.name ?? part.projectId,
        role: g.role,
        archived: p?.archived ?? false,
        ranks: g.ranks,
      });
      games.set(g.appId, e);
    }
  }
  const out: GameEntry[] = [];
  for (const { shas, ...e } of games.values()) {
    const asoByPage: string[] = [];
    for (const pg of e.pages) {
      // Saved store text is Google Play's (App Store text gets its own folder, plan-app-store 3).
      if (pg.platform !== "play") continue;
      const s = latestStoreText(storage, e.appId, pg.gl, pg.hl);
      if (!s) continue;
      e.category ||= s.official.genre.name ?? "";
      if (s.official.title) asoByPage.push(splitStoreTitle(s.official.title).keywords ?? "");
      const terms = s.derived.keywords.slice(0, 3).map((k) => k.term);
      if (terms.length) e.keywords.push({ gl: pg.gl, terms });
    }
    const asos = asoByPage.filter(Boolean);
    e.aso = asos[0] ?? "";
    e.asoDiffers = new Set(asos).size > 1 ? new Set(asos).size : 0;
    e.images = shas.size;
    e.countries = e.pages.filter((p) => p.status === "ok" && p.images > 0).length;
    e.analysed = [...shas].filter((s) => analysed.has(s)).length;
    e.latestCheck = e.pages.reduce((m, p) => (p.checked > m ? p.checked : m), "");
    e.uses.sort((a, b) => Number(a.archived) - Number(b.archived));
    e.search = fold([e.name, e.appId, e.aso, ...e.keywords.flatMap((k) => k.terms)].join(" "));
    out.push(e);
  }
  return out.sort((a, b) => b.images - a.images || a.name.localeCompare(b.name));
}

export interface RebuildProgress {
  running: boolean;
  done: number;
  total: number;
  message: string;
  changed: number | null;
  error: string;
}

const states = new Map<string, { progress: RebuildProgress; run: Promise<void> | null }>();
const tick = () => new Promise<void>((r) => setImmediate(r));

export function rebuildProgress(workspace: string): RebuildProgress | null {
  return states.get(workspace)?.progress ?? null;
}

/**
 * Rebuilds the parts whose stamps changed (all of them when forced), merges and saves. One at a
 * time per workspace: a second request joins the running one. Yields between steps, so progress
 * polls are answered while it runs.
 */
export function rebuildIndex(
  workspace: string,
  storage: Storage,
  load: (id: string) => LoadedConfig | null,
  force: boolean,
): Promise<void> {
  const st = states.get(workspace);
  if (st?.run) return st.run;
  const progress: RebuildProgress = {
    running: true,
    done: 0,
    total: 0,
    message: "Starting...",
    changed: null,
    error: "",
  };
  const run = (async () => {
    const saved = readIndex(storage);
    const infos = projectInfos(storage);
    progress.total = infos.length;
    const parts: ProjectPart[] = [];
    for (const p of infos) {
      progress.message = `Reading project ${progress.done + 1} of ${infos.length}`;
      const stamp = projectStamp(storage, p.id);
      const had = saved?.parts[p.id];
      parts.push(
        !force && had?.stamp === stamp ? had : buildPart(storage, p.id, load(p.id), stamp),
      );
      progress.done++;
      await tick();
    }
    progress.message = "Merging the games";
    await tick();
    const games = merge(storage, parts, infos);
    const before = new Map((saved?.games ?? []).map((g) => [g.appId, stableHash(g)]));
    progress.changed =
      games.filter((g) => before.get(g.appId) !== stableHash(g)).length +
      [...before.keys()].filter((id) => !games.some((g) => g.appId === id)).length;
    storage.putJson(GAMES_KEY, {
      version: 1,
      builtAt: new Date().toISOString(),
      storeStamp: storeStamp(storage),
      parts: Object.fromEntries(parts.map((p) => [p.projectId, p])),
      games,
    });
    progress.message = `List updated: ${progress.changed} ${progress.changed === 1 ? "game" : "games"} changed`;
  })()
    .catch((e: unknown) => {
      progress.error = `The list could not be updated: ${e instanceof Error ? e.message : String(e)}`;
    })
    .finally(() => {
      progress.running = false;
      const s = states.get(workspace);
      if (s) s.run = null;
    });
  states.set(workspace, { progress, run });
  return run;
}

/** True when a project or the saved store texts changed since the list was saved. */
export function indexStale(storage: Storage, saved: SavedIndex | null): boolean {
  if (!saved) return true;
  const ids = projectInfos(storage).map((p) => p.id);
  if (ids.length !== Object.keys(saved.parts).length) return true;
  if (ids.some((id) => saved.parts[id]?.stamp !== projectStamp(storage, id))) return true;
  return saved.storeStamp !== storeStamp(storage);
}
