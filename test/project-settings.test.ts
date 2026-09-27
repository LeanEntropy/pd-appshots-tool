import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, loadTaxonomy } from "../src/config/load.ts";
import {
  configFromSettings,
  loadDefaults,
  loadProject,
  settingsFromConfig,
  settingsKey,
} from "../src/config/project.ts";
import { ProjectSettingsSchema } from "../src/config/project-schema.ts";
import {
  listProjects,
  markOpened,
  mostRecentProject,
  REGISTRY_KEY,
  readRegistry,
  slugFor,
} from "../src/config/registry.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { stableHash } from "../src/util/hash.ts";

const REPO = join(import.meta.dirname, "..");

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "ssr-settings-"));
  mkdirSync(join(root, "configs"));
  cpSync(join(REPO, "configs"), join(root, "configs"), { recursive: true });
  cpSync(join(REPO, "taxonomies"), join(root, "taxonomies"), { recursive: true });
  return root;
}

test("project settings plus tool defaults give exactly today's Rogue Legend config", () => {
  const root = tempRoot();
  const legacy = loadConfig(join(root, "configs", "rogue-legend.json"));
  const d = loadDefaults(root);
  const s = settingsFromConfig(legacy.config, d, "2026-09-27T00:00:00.000Z");
  assert.equal(s.overrides, undefined, "no value differs from the defaults");
  assert.equal(s.competitors.length, 14);
  assert.equal(s.markets.length, 9);
  assert.deepEqual(configFromSettings(s, d), legacy.config);
  // Written as project.json and loaded with the repo root set explicitly.
  const storage = workspaceStorage(join(root, "workspace"));
  storage.putJson(settingsKey({ projectId: s.id }), s);
  const p = loadProject("rogue-legend", { root });
  assert.equal(p.root, root);
  assert.equal(p.hash, legacy.hash);
  assert.equal(p.projectId, "rogue-legend");
  assert.equal(loadTaxonomy(p).taxonomy.id, loadTaxonomy(legacy).taxonomy.id);
});

test("overrides merge over the defaults; charts can be switched off", () => {
  const root = tempRoot();
  const d = loadDefaults(root);
  const legacy = loadConfig(join(root, "configs", "rogue-legend.json"));
  const s = settingsFromConfig(legacy.config, d, "t");
  const c = configFromSettings(
    {
      ...s,
      charts: { ...s.charts, enabled: false },
      overrides: { budget: { maxUsdPerIncrement: 12 }, core: { imageCap: 90 } },
    },
    d,
  );
  assert.equal(c.budget.maxUsdPerIncrement, 12);
  assert.equal(c.core.imageCap, 90);
  assert.equal(c.core.imageTarget, 85, "untouched values keep the default");
  assert.equal(c.charts.enabled, false);
  const back = settingsFromConfig(c, d, "t");
  assert.deepEqual(Object.keys(back.overrides ?? {}).sort(), ["budget", "core"]);
});

test("settings rules: duplicates, own game, US English first, drafts", () => {
  const root = tempRoot();
  const legacy = loadConfig(join(root, "configs", "rogue-legend.json"));
  const s = settingsFromConfig(legacy.config, loadDefaults(root), "t");
  const bad = (x: unknown) => !ProjectSettingsSchema.safeParse(x).success;
  const first = s.competitors[0];
  assert.ok(first);
  assert.ok(bad({ ...s, competitors: [...s.competitors, first] }));
  assert.ok(bad({ ...s, competitors: [{ ...first, id: s.ourApp.id }] }));
  assert.ok(bad({ ...s, markets: [...s.markets].reverse() }));
  assert.ok(bad({ ...s, overrides: { workspace: "elsewhere" } }));
  assert.ok(!bad({ ...s, competitors: [] }), "a draft is valid settings");
  const storage = workspaceStorage(join(root, "workspace"));
  storage.putJson(settingsKey({ projectId: s.id }), { ...s, competitors: [] });
  assert.throws(() => loadProject(s.id, { root }), /add a competitor/);
});

test("registry: rebuilt from project folders, bad file kept aside, last opened first", () => {
  const root = tempRoot();
  const legacy = loadConfig(join(root, "configs", "rogue-legend.json"));
  const s = settingsFromConfig(legacy.config, loadDefaults(root), "2026-01-01T00:00:00.000Z");
  const storage = workspaceStorage(join(root, "workspace"));
  assert.deepEqual(readRegistry(storage).projects, []);
  storage.putJson(settingsKey({ projectId: "rogue-legend" }), s);
  storage.putJson(settingsKey({ projectId: "other" }), { ...s, id: "other", name: "Other" });
  assert.deepEqual(
    readRegistry(storage)
      .projects.map((p) => p.id)
      .sort(),
    ["other", "rogue-legend"],
  );
  markOpened(storage, "other", "2026-02-01T00:00:00.000Z");
  markOpened(storage, "rogue-legend", "2026-03-01T00:00:00.000Z");
  assert.equal(mostRecentProject(storage), "rogue-legend");
  writeFileSync(storage.localPath(REGISTRY_KEY), "{ not json");
  assert.equal(listProjects(storage).length, 2);
  const kept = readdirSync(join(root, "workspace")).filter((f) =>
    f.startsWith("projects.json.bad-"),
  );
  assert.equal(kept.length, 1);
  assert.equal(stableHash(readRegistry(storage)).length, 64);
});

test("project ids from game titles, with a number on collision", () => {
  assert.equal(slugFor("Rogue Legend", []), "rogue-legend");
  assert.equal(slugFor("Rogue Legend", ["rogue-legend"]), "rogue-legend-2");
  assert.equal(slugFor("Rogue Legend", ["rogue-legend", "rogue-legend-2"]), "rogue-legend-3");
  assert.equal(slugFor("Survivor!.io", []), "survivor-io");
  assert.equal(slugFor("你好", []), "project");
});
