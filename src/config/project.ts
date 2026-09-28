import { isAbsolute, join } from "node:path";
import {
  type ProjectContext,
  projectKey,
  type Storage,
  workspaceStorage,
} from "../storage/index.ts";
import { readJson } from "../util/fsx.ts";
import { stableStringify } from "../util/hash.ts";
import { configHash, type LoadedConfig } from "./load.ts";
import {
  isDraft,
  type ProjectSettings,
  ProjectSettingsSchema,
  type ToolDefaults,
  ToolDefaultsSchema,
} from "./project-schema.ts";
import { type Config, ConfigSchema } from "./schema.ts";

export const DEFAULTS_FILE = join("configs", "defaults.json");

function problems(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `  - ${i.path.map(String).join(".")}: ${i.message}`).join("\n");
}

export function loadDefaults(root: string): ToolDefaults {
  const parsed = ToolDefaultsSchema.safeParse(readJson(join(root, DEFAULTS_FILE)));
  if (!parsed.success)
    throw new Error(`The tool defaults file has problems:\n${problems(parsed.error.issues)}`);
  return parsed.data;
}

/** The shared workspace folder of all projects (from the tool defaults). */
export function workspaceDir(root: string, defaults = loadDefaults(root)): string {
  return isAbsolute(defaults.workspace) ? defaults.workspace : join(root, defaults.workspace);
}

export function settingsKey(ctx: ProjectContext): string {
  return projectKey(ctx, "project.json");
}

export function readSettings(storage: Storage, ctx: ProjectContext): ProjectSettings | null {
  const raw = storage.getJson(settingsKey(ctx));
  if (raw === undefined) return null;
  const parsed = ProjectSettingsSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `The settings of project "${ctx.projectId}" have problems:\n${problems(parsed.error.issues)}`,
    );
  return parsed.data;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Objects merge key by key; arrays and plain values replace. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

/** Project settings + tool defaults (+ overrides) in the exact shape of today's config file. */
export function settingsToRawConfig(s: ProjectSettings, d: ToolDefaults): Record<string, unknown> {
  const tool = {
    download: d.download,
    core: d.core,
    review: d.review,
    budget: d.budget,
    estimates: d.estimates,
    run: d.run,
    tierWeights: d.tierWeights,
    models: d.models,
    taxonomy: d.taxonomy,
    options: d.options,
  };
  const merged = deepMerge(tool, s.overrides ?? {}) as typeof tool;
  // The main country is the baseline; one no longer in the project falls back to the first.
  const main = s.markets.some((m) => m.gl === merged.core.market)
    ? merged.core.market
    : (s.markets[0]?.gl ?? merged.core.market);
  merged.core = { ...merged.core, market: main };
  // Tool values first: the project's own fields below always win.
  return {
    ...merged,
    schemaVersion: 1,
    project: s.id,
    workspace: d.workspace,
    ourApp: { name: s.ourApp.name, id: s.ourApp.id },
    category: s.category,
    competitors: s.competitors.map((c) => ({ name: c.name, id: c.id, tier: c.tier })),
    markets: s.markets.map((m) => ({
      gl: m.gl,
      hl: m.hl,
      label: m.label,
      baseline: m.gl === main,
    })),
    charts: {
      ...(s.charts.enabled ? {} : { enabled: false }),
      collection: s.charts.collection,
      depth: s.charts.depth,
      analyse: d.charts.analyse,
      includeBaselineLocale: d.charts.includeBaselineLocale,
    },
    ...(s.ownAssets ? { ownAssets: s.ownAssets } : {}),
  };
}

export function configFromSettings(s: ProjectSettings, d: ToolDefaults): Config {
  const parsed = ConfigSchema.safeParse(settingsToRawConfig(s, d));
  if (!parsed.success)
    throw new Error(`Project "${s.id}" cannot be run:\n${problems(parsed.error.issues)}`);
  if (parsed.data.project !== s.id || parsed.data.ourApp.id !== s.ourApp.id)
    throw new Error(`Project "${s.id}": its settings name another project.`);
  return parsed.data;
}

/**
 * The runnable config of a project, in today's LoadedConfig shape. The root is set to the repo
 * root explicitly (taxonomy, prompts and tools resolve from there, not from the workspace).
 */
export function loadProject(id: string, opts: { root: string }): LoadedConfig {
  const defaults = loadDefaults(opts.root);
  const ws = workspaceDir(opts.root, defaults);
  const storage = workspaceStorage(ws);
  const settings = readSettings(storage, { projectId: id });
  if (!settings) throw new Error(`There is no project "${id}".`);
  if (isDraft(settings))
    throw new Error(
      `Project "${settings.name}" is still being set up: finish its steps on the tool's page first.`,
    );
  const config = configFromSettings(settings, defaults);
  return {
    config,
    path: storage.localPath(settingsKey({ projectId: id })),
    root: opts.root,
    hash: configHash(config),
    projectId: id,
  };
}

/**
 * Settings for an existing config (the import): the game, competitors in order, markets, charts
 * and own assets, plus overrides for any tool value that differs from the defaults.
 */
export function settingsFromConfig(c: Config, d: ToolDefaults, now: string): ProjectSettings {
  const base = c.markets.find((m) => m.baseline);
  if (c.markets[0] !== base || base?.gl !== "us" || base.hl !== "en")
    throw new Error(
      "Only projects whose first country is United States (English) can be imported.",
    );
  const s: ProjectSettings = {
    schemaVersion: 1,
    id: c.project,
    name: c.ourApp.name,
    createdAt: now,
    updatedAt: now,
    ourApp: { id: c.ourApp.id, name: c.ourApp.name },
    competitors: c.competitors.map((x) => ({ id: x.id, name: x.name, tier: x.tier, addedAt: now })),
    markets: c.markets.map((m) => ({ gl: m.gl, hl: m.hl, label: m.label })),
    charts: {
      enabled: c.charts.enabled !== false,
      collection: c.charts.collection,
      depth: c.charts.depth,
    },
    category: c.category,
    ...(c.ownAssets ? { ownAssets: c.ownAssets } : {}),
  };
  if (c.workspace !== d.workspace) throw new Error("The project uses another workspace folder.");
  const fromDefaults = ConfigSchema.parse(settingsToRawConfig(s, d)) as Record<string, unknown>;
  const overrides: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (stableStringify(v) !== stableStringify(fromDefaults[k])) overrides[k] = v;
  }
  for (const k of [
    "project",
    "ourApp",
    "category",
    "competitors",
    "markets",
    "charts",
    "ownAssets",
  ])
    if (k in overrides) throw new Error(`The imported settings do not round-trip (field "${k}").`);
  const out = ProjectSettingsSchema.safeParse(
    Object.keys(overrides).length ? { ...s, overrides } : s,
  );
  if (!out.success)
    throw new Error(
      `Project "${c.project}" cannot be imported as it is:\n${problems(out.error.issues)}`,
    );
  return out.data;
}
