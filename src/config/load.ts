import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
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
  const base = join(fromRoot(loaded, loaded.config.workspace), loaded.config.project);
  return {
    base,
    cache: join(base, "cache"),
    imagesOrig: join(base, "images", "orig"),
    imagesThumb: join(base, "images", "thumb"),
    imagesModel: join(base, "images", "model"),
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
