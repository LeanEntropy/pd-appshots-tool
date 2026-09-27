import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ProjectPaths } from "../config/load.ts";
import type { Config } from "../config/schema.ts";
import type { ImageDb, ImageSource } from "../store/imagedb.ts";
import { type DeckManifest, readDeck } from "../store/manifest.ts";
import { readJson } from "../util/fsx.ts";
import type { ImageFacts } from "./image-facts.ts";

export interface FilePath {
  /** Relative to the project workspace folder (workspace/<project>/), forward slashes. */
  relative: string;
  absolute: string;
  exists: boolean;
}

export interface Appearance {
  game: string;
  appId: string;
  gl: string;
  hl: string;
  position: number;
  storePage: string;
}

/** Which image a record is about, rebuilt from the image database and deck manifests. */
export interface ImageIdentity {
  imageId: string;
  filename: string;
  game: string;
  appId: string;
  /** The deck this record was analysed for. */
  analysedAs: { gl: string; hl: string; position: number };
  /** Size, orientation, aspect ratio and dominant colours, computed from the pixels. */
  image: ImageFacts | null;
  files: { original: FilePath | null; model: FilePath; thumb: FilePath | null };
  /** Full-resolution image on Google Play, and the store page it was analysed for. */
  sourceUrl: string | null;
  storePage: string;
  /** Every game, country-language and position where this exact image appears. */
  appearances: Appearance[];
}

export const storePage = (appId: string, gl: string, hl: string) =>
  `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&gl=${gl}&hl=${hl}`;

/** Builds identities for many records with shared lookups (deck titles are read once). */
export function identityBuilder(paths: ProjectPaths, db: ImageDb, config: Config) {
  const configured = new Map<string, string>([
    [config.ourApp.id, config.ourApp.name],
    ...config.competitors.map((c) => [c.id, c.name] as [string, string]),
  ]);
  const titles = new Map<string, string>();
  const googleIds = new Map<string, string>();
  // Configured names are app-wide; other games use the store title of that country-language.
  const nameOf = (appId: string, gl: string, hl: string) => {
    const known = configured.get(appId);
    if (known) return known;
    const k = `${appId}|${gl}|${hl}`;
    if (!titles.has(k)) titles.set(k, readDeck(paths.decks, { appId, gl, hl })?.title ?? appId);
    return titles.get(k) as string;
  };
  // Every current deck manifest, indexed by image id (appearances = deck slots + database sources).
  let deckIndex: Map<string, ImageSource[]> | null = null;
  const fromDecks = (imageId: string): ImageSource[] => {
    if (!deckIndex) {
      deckIndex = new Map();
      if (existsSync(paths.decks))
        for (const app of readdirSync(paths.decks))
          for (const f of readdirSync(join(paths.decks, app)).filter((n) => n.endsWith(".json"))) {
            const d = readJson(join(paths.decks, app, f)) as DeckManifest;
            for (const sl of d.slots ?? []) {
              if (!sl.imageId) continue;
              const list = deckIndex.get(sl.imageId) ?? [];
              list.push({ appId: d.appId, gl: d.gl, hl: d.hl, position: sl.position });
              deckIndex.set(sl.imageId, list);
            }
          }
    }
    return deckIndex.get(imageId) ?? [];
  };
  const googleIdOf = (appId: string, gl: string, hl: string, position: number) => {
    const k = `${appId}|${gl}|${hl}|${position}`;
    if (!googleIds.has(k)) {
      const slot = readDeck(paths.decks, { appId, gl, hl })?.slots.find(
        (s) => s.position === position,
      );
      googleIds.set(k, slot?.googleId ?? "");
    }
    return googleIds.get(k) || null;
  };
  const file = (abs: string): FilePath => ({
    relative: relative(paths.base, abs).split("\\").join("/"),
    absolute: abs,
    exists: existsSync(abs),
  });
  return (
    r: { imageId: string; appId: string; gl: string; hl: string; position: number },
    facts: ImageFacts | null,
  ): ImageIdentity => {
    const rec = db.get(r.imageId);
    const seen = new Set<string>();
    const sources = [...(rec?.sources ?? []), ...fromDecks(r.imageId)]
      .filter((x) => {
        const k = `${x.appId}|${x.gl}|${x.hl}|${x.position}`;
        return !seen.has(k) && !!seen.add(k);
      })
      .sort(
        (a, b) =>
          a.appId.localeCompare(b.appId) ||
          a.gl.localeCompare(b.gl) ||
          a.hl.localeCompare(b.hl) ||
          a.position - b.position,
      );
    const gid = googleIdOf(r.appId, r.gl, r.hl, r.position) ?? rec?.googleIds[0] ?? null;
    return {
      imageId: r.imageId,
      filename: rec ? (rec.file.split("/").pop() ?? rec.file) : r.imageId,
      game: nameOf(r.appId, r.gl, r.hl),
      appId: r.appId,
      analysedAs: { gl: r.gl, hl: r.hl, position: r.position },
      image: facts,
      files: {
        original: rec ? file(db.abs(rec.file)) : null,
        model: file(join(paths.imagesModel, `${r.imageId}.jpg`)),
        thumb: rec ? file(db.abs(rec.thumb)) : null,
      },
      sourceUrl: gid ? `https://play-lh.googleusercontent.com/${gid}=s0` : null,
      storePage: storePage(r.appId, r.gl, r.hl),
      appearances: sources.map((s) => ({
        game: nameOf(s.appId, s.gl, s.hl),
        appId: s.appId,
        gl: s.gl,
        hl: s.hl,
        position: s.position,
        storePage: storePage(s.appId, s.gl, s.hl),
      })),
    };
  };
}
