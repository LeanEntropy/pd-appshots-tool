import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { isUsable, readRecords } from "../src/analysis/records.ts";
import { projectPaths } from "../src/config/load.ts";
import { loadProject } from "../src/config/project.ts";
import { listProjects } from "../src/config/registry.ts";
import { runImport } from "../src/library/import/run-import.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { openImageDb } from "../src/store/imagedb.ts";
import { files, fingerprint, legacyProject, links } from "./helpers/imported.ts";

const opts = (root: string, configPath: string, apply: boolean) => ({
  root,
  configPath,
  apply,
  verifyHashes: true,
});

test("dry run: counts everything, verifies hashes, writes nothing", async () => {
  const { loaded, root } = await legacyProject();
  const ws = join(root, "workspace");
  const before = fingerprint(ws);
  const r = await runImport(opts(root, loaded.path, false));
  assert.deepEqual(fingerprint(ws), before, "a dry run changes no file");
  const db = openImageDb(projectPaths(loaded));
  assert.equal(r.status, "dry-run");
  assert.equal(r.images, db.size);
  assert.equal(r.files.original, db.size);
  assert.deepEqual(r.hashes, { checked: db.size, bad: [] });
  assert.equal(r.settings.equal, true);
  assert.deepEqual(r.records, {
    total: 9,
    proven: 8,
    unproven: 1,
    reasons: { "no model answer (the analysis failed)": 1 },
  });
  assert.equal(r.after, null);
});

test("import: hardlinks into the library, same approvals and views, then a no-op", async () => {
  const { loaded, root } = await legacyProject();
  const pilot = buildAnalysisPlan(loaded, "pilot");
  const core = buildAnalysisPlan(loaded, "core");
  const oldPaths = projectPaths(loaded);
  const usable = [...readRecords(oldPaths).values()].filter((x) => isUsable(x)).length;
  const r = await runImport(opts(root, loaded.path, true));
  assert.equal(r.status, "imported");
  assert.deepEqual(r.gate, []);
  assert.equal(r.linkCounts?.copied, 0);

  const paths = projectPaths(loaded);
  assert.ok(paths.library, "the project now uses the library");
  assert.ok(existsSync(join(paths.base, "refs.json")));
  assert.ok(existsSync(join(paths.base, "project.json")));
  assert.ok(existsSync(join(paths.base, "_before-library", "images", "db.json")));
  assert.ok(!existsSync(join(paths.base, "images")));
  assert.ok(!existsSync(join(paths.base, "analysis")));
  const db = openImageDb(paths);
  const first = db.all()[0];
  assert.ok(first);
  assert.equal(links(db.abs(first.file)), 2, "original and library copy are one file");
  assert.equal(buildAnalysisPlan(loaded, "pilot").planHash, pilot.planHash);
  assert.equal(buildAnalysisPlan(loaded, "core").planHash, core.planHash);
  const records = readRecords(paths);
  assert.equal(records.size, 9);
  assert.equal([...records.values()].filter((x) => isUsable(x)).length, usable);
  const proven = [...records.values()].filter((x) => x.provenance === "proven");
  assert.equal(proven.length, 8);
  assert.ok(proven.every((x) => x.key === paths.library?.analysisKey && x.paidBy?.projectId));
  assert.ok(proven.every((x) => x.identity?.files.original?.absolute.includes("_library")));
  // The project settings run the same config; the registry lists it.
  const p = loadProject("rogue-legend", { root });
  assert.equal(p.hash, loaded.hash);
  assert.equal(buildAnalysisPlan(p, "core").planHash, core.planHash);
  assert.deepEqual(
    listProjects(workspaceStorage(join(root, "workspace"))).map((x) => x.id),
    ["rogue-legend"],
  );
  const ws = join(root, "workspace");
  const skip = (f: string) => f.startsWith(".locks/") || f === "projects.json";
  const after = fingerprint(ws, skip);
  const again = await runImport(opts(root, loaded.path, true));
  assert.equal(again.status, "already-imported");
  assert.deepEqual(fingerprint(ws, skip), after, "a second import changes nothing");
});

for (const step of ["link", "facts", "records", "identity", "gate"] as const) {
  test(`an import that fails after "${step}" leaves everything as it was, and can be re-run`, async () => {
    const { loaded, root } = await legacyProject();
    const ws = join(root, "workspace");
    const skip = (f: string) => f.startsWith("rogue-legend/state/") || f.startsWith(".locks/");
    const before = fingerprint(ws, skip);
    await assert.rejects(runImport({ ...opts(root, loaded.path, true), failAfter: step }));
    assert.deepEqual(fingerprint(ws, skip), before, "rolled back exactly");
    assert.deepEqual(files(join(ws, "_library")), [], "no library entry left behind");
    assert.equal(projectPaths(loaded).library, null);
    const r = await runImport(opts(root, loaded.path, true));
    assert.equal(r.status, "imported");
  });
}

test("a corrupted original stops the import and nothing is changed", async () => {
  const { loaded, root } = await legacyProject();
  const db = openImageDb(projectPaths(loaded));
  const victim = db.all()[2];
  assert.ok(victim);
  writeFileSync(db.abs(victim.file), "not the picture");
  const dry = await runImport(opts(root, loaded.path, false));
  assert.equal(dry.hashes?.bad.length, 1);
  await assert.rejects(runImport(opts(root, loaded.path, true)), /content hash/);
  assert.deepEqual(files(join(root, "workspace", "_library")), []);
});

test("an analysis still running in the old tool blocks the import", async () => {
  const { loaded, root } = await legacyProject();
  mkdirSync(projectPaths(loaded).pending, { recursive: true });
  const status = join(projectPaths(loaded).pending, "analysis-status.json");
  writeFileSync(
    status,
    JSON.stringify({
      running: true,
      startedAt: new Date().toISOString(),
      progress: { message: "Analysing image 5 / 17" },
    }),
  );
  const r = await runImport(opts(root, loaded.path, true));
  assert.equal(r.status, "blocked");
  assert.match(r.blocked ?? "", /image 5 \/ 17/);
  assert.deepEqual(files(join(root, "workspace", "_library")), []);
});
