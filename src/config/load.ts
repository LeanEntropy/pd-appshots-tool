import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { type LayoutOverride, libraryLayout } from "../library/layout.ts";
import { readJson, writeJsonAtomic } from "../util/fsx.ts";
import { stableHash } from "../util/hash.ts";
import { type Config, ConfigSchema, type RunConfig, RunConfigSchema } from "./schema.ts";

export interface LoadedConfig {
  config: Config;
  /** Absolute path to the config file. */
  path: string;
  /** Repo root (parent of the configs folder). */
  root: string;
  hash: string;
  /** Set when loaded from workspace/<id>/project.json (loadProject). */
  projectId?: string;
  /** Forces the old or the library layout (the import's before/after comparison only). */
  layout?: LayoutOverride;
}

const TaxonomySchema = z.object({
  id: z.string(),
  version: z.string(),
  screenTypes: z.array(
    z.object({ id: z.string(), label: z.string(), subtypes: z.array(z.string()) }),
  ),
  definitions: z.record(z.string(), z.string()).default({}),
  /** Display names for subtype codes; others are shown with spaces and a capital letter. */
  subtypeLabels: z.record(z.string(), z.string()).default({}),
});
export type Taxonomy = z.infer<typeof TaxonomySchema>;

export function loadConfig(configPath: string): LoadedConfig {
  const path = resolve(configPath);
  if (!existsSync(path)) throw new Error(`Config file not found: ${path}`);
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`The config file has problems:\n${lines.join("\n")}`);
  }
  const root = dirname(dirname(path));
  return { config: parsed.data, path, root, hash: stableHash(parsed.data) };
}

export function fromRoot(loaded: LoadedConfig, p: string): string {
  return isAbsolute(p) ? p : join(loaded.root, p);
}

export function loadTaxonomy(loaded: LoadedConfig): { taxonomy: Taxonomy; hash: string } {
  const taxonomy = TaxonomySchema.parse(readJson(fromRoot(loaded, loaded.config.taxonomy)));
  return { taxonomy, hash: stableHash(taxonomy) };
}

/** Folder layout of one game project's local workspace (gitignored). */
export function projectPaths(loaded: LoadedConfig) {
  const workspace = fromRoot(loaded, loaded.config.workspace);
  const base = join(workspace, loaded.config.project);
  // Once imported, images, pixel facts, analysis records and per-image answers are shared.
  const library = libraryLayout(loaded.config, workspace, loaded.layout);
  const images = library ? join(library.dir, "images") : join(base, "images");
  return {
    workspace,
    projectId: loaded.config.project,
    base,
    library,
    cache: join(base, "cache"),
    imagesOrig: join(images, "orig"),
    imagesThumb: join(images, "thumb"),
    imagesModel: join(images, "model"),
    /** Prompts, JSON schemas and synthesis answers (always the project's own). */
    objects: join(base, "objects"),
    analysis: join(base, "analysis"),
    orders: join(base, "orders"),
    reports: join(base, "reports"),
    imageDb: join(base, "images", "db.json"),
    decks: join(base, "decks"),
    pending: join(base, "pending"),
    runs: join(base, "runs"),
    own: join(base, "own"),
    views: join(base, "views"),
    runConfig: join(base, "run-config.json"),
    selectionInbox: join(base, "selection.json"),
  };
}
export type ProjectPaths = ReturnType<typeof projectPaths>;

export function readRunConfig(paths: ProjectPaths): RunConfig | null {
  if (!existsSync(paths.runConfig)) return null;
  return RunConfigSchema.parse(readJson(paths.runConfig));
}

export function writeRunConfig(paths: ProjectPaths, rc: RunConfig): void {
  writeJsonAtomic(paths.runConfig, RunConfigSchema.parse(rc));
}

/** Core competitor order: the user's pick if present, otherwise the config's default order. */
export function coreOrder(loaded: LoadedConfig, paths: ProjectPaths): string[] {
  const rc = readRunConfig(paths);
  return rc ? rc.coreCompetitors : loaded.config.competitors.map((c) => c.id);
}
