import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { isUsable, readRecord, readRecords } from "../src/analysis/records.ts";
import { runAnalysis } from "../src/analysis/run.ts";
import { type LoadedConfig, projectPaths } from "../src/config/load.ts";
import { runImport } from "../src/library/import/run-import.ts";
import { refsKey } from "../src/library/layout.ts";
import { staticKey } from "../src/server/static.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { openImageDb } from "../src/store/imagedb.ts";
import { legacyProject, providers } from "./helpers/imported.ts";

async function imported() {
  const { loaded, root } = await legacyProject();
  await runImport({ root, configPath: loaded.path, apply: true });
  return { loaded, root, storage: workspaceStorage(join(root, "workspace")) };
}

/** A second project on the same workspace (library from the start), optionally other models. */
function other(loaded: LoadedConfig, models?: Partial<LoadedConfig["config"]["models"]>) {
  const config = {
    ...loaded.config,
    project: "other",
    models: { ...loaded.config.models, ...models },
  };
  const o: LoadedConfig = { ...loaded, config };
  workspaceStorage(projectPaths(loaded).workspace).putJson(refsKey({ projectId: "other" }), {
    version: 1,
    projectId: "other",
    images: {},
  });
  return projectPaths(o);
}

test("after the import, new analyses and model answers go to the shared library", async () => {
  const { loaded, storage } = await imported();
  const paths = projectPaths(loaded);
  const plan = buildAnalysisPlan(loaded, "core");
  assert.ok(plan.counts.full > 0);
  const out = await runAnalysis(loaded, plan, providers());
  const key = paths.library?.analysisKey as string;
  for (const r of out.records) {
    assert.ok(storage.exists(`library/analysis/${r.imageId}/${key}.json`));
    assert.equal(readRecord(paths, r.imageId)?.provenance, "proven");
  }
  const lib = join(paths.workspace, "_library", "objects", "full-analysis");
  assert.ok(readdirSync(lib).length >= out.records.length);
  assert.ok(!existsSync(join(paths.base, "objects", "full-analysis")), "per-image answers shared");
  assert.ok(!existsSync(join(paths.base, "analysis")));
  assert.equal(buildAnalysisPlan(loaded, "core").counts.full, 0, "nothing is analysed twice");
});

test("another project reuses stored images and proven analyses, never unproven ones", async () => {
  const { loaded } = await imported();
  const rl = projectPaths(loaded);
  const rlDb = openImageDb(rl);
  const records = [...readRecords(rl).values()];
  const proven = records.find((r) => r.provenance === "proven" && isUsable(r));
  const unproven = records.find((r) => r.provenance === "unproven");
  assert.ok(proven && unproven);
  const img = rlDb.get(proven.imageId);
  assert.ok(img);

  const op = other(loaded);
  const db = openImageDb(op);
  assert.equal(db.size, 0);
  const found = db.byGoogleId(img.googleIds[0] as string);
  assert.equal(found?.id, img.id, "known to the library: not downloaded again");
  db.addSource(img.id, { appId: proven.appId, gl: "us", hl: "en", position: 1 });
  db.addSource(unproven.imageId, { appId: unproven.appId, gl: "us", hl: "en", position: 9 });
  db.save();
  const again = openImageDb(op);
  assert.equal(again.size, 2);
  assert.equal(again.abs(img.file), rlDb.abs(img.file), "one file for both projects");
  assert.ok(isUsable(readRecord(op, img.id)), "same settings: the analysis is reused");
  assert.equal(readRecord(op, unproven.imageId), undefined, "unproven: not shared");
  assert.equal(readRecords(op).size, 1);

  const different = other(loaded, { fullAnalysis: "claude:claude-opus-5-5" });
  assert.notEqual(different.library?.analysisKey, op.library?.analysisKey);
  assert.equal(readRecord(different, img.id), undefined, "other settings: not reused silently");
});

test("the gallery serves library images only to projects that use them", async () => {
  const { loaded } = await imported();
  const paths = projectPaths(loaded);
  const img = openImageDb(paths).all()[0];
  assert.ok(img);
  const served = staticKey(paths, `/images/${img.file}`);
  assert.ok(served?.startsWith("library/"));
  assert.ok(staticKey(paths, `/images/${img.thumb}`));
  assert.equal(staticKey(paths, `/images/orig/${"a".repeat(64)}.png`), null);
  assert.equal(staticKey(paths, "/images/../project.json"), null);
  const op = other(loaded);
  assert.equal(staticKey(op, `/images/${img.file}`), null, "not referenced by it");
});
