import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { analysisKey, currentPipeline } from "../src/analysis/pipeline.ts";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { type AnalysisRecord, isUsable, readRecord, readRecords } from "../src/analysis/records.ts";
import { runAnalysis } from "../src/analysis/run.ts";
import { projectPaths } from "../src/config/load.ts";
import { readLayoutMeasure } from "../src/layout/capture.ts";
import {
  ensureLayout,
  layoutFromAnswer,
  layoutStatus,
  readLayoutFile,
} from "../src/layout/store.ts";
import { runImport } from "../src/library/import/run-import.ts";
import { LIB } from "../src/library/layout.ts";
import { cleanupTrialFiles } from "../src/library/trial-cleanup.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { fakeProvider } from "./helpers/fake-provider.ts";
import { legacyProject } from "./helpers/imported.ts";

/** A project on the shared library, its Pilot analysed before layout capture existed. */
async function libraryProject() {
  const { loaded, root } = await legacyProject();
  await runImport({ root, configPath: loaded.path, apply: true });
  loaded.config.options.speed.layoutCapture = false;
  return { loaded, storage: workspaceStorage(join(root, "workspace")) };
}

const providers = () => ({
  producer: fakeProvider({
    model: "claude-fable-5-1",
    read: () => ({ screenType: "gameplay", headline: "EPIC" }),
  }),
  reviewer: null,
  adjudicator: fakeProvider({
    model: "claude-opus-5-5",
    read: () => ({ screenType: "gameplay", headline: "EPIC" }),
  }),
  onProgress: () => {},
});

test("layout capture keeps every analysis key; new images get a write-once layout file", async () => {
  const { loaded } = await libraryProject();
  const before = analysisKey(currentPipeline(loaded.config));
  const paths = projectPaths(loaded);
  const old = [...readRecords(paths).values()];
  assert.ok(old.length > 0);

  loaded.config.options.speed.layoutCapture = true;
  assert.equal(
    analysisKey(currentPipeline(loaded.config)),
    before,
    "the switch never changes the key",
  );
  assert.equal(buildAnalysisPlan(loaded, "pilot").counts.full, 0, "saved analyses stay current");
  for (const r of old.filter(isUsable)) assert.ok(isUsable(readRecord(paths, r.imageId)));
  for (const r of old.filter(isUsable)) assert.equal(layoutStatus(paths, r).status, "missing");

  const p = providers();
  await runAnalysis(loaded, buildAnalysisPlan(loaded, "core"), p);
  const calls = p.producer.calls.filter((c) => c.images.length);
  assert.ok(calls.length > 0);
  for (const c of calls) {
    assert.match(c.system.text, /## 3\. Layout/);
    assert.ok(JSON.stringify(c.schema).includes('"layout"'));
  }
  const fresh = [...readRecords(paths).values()].filter(
    (r) => !old.some((o) => o.imageId === r.imageId),
  );
  assert.ok(fresh.length > 0);
  for (const r of fresh) {
    assert.ok(isUsable(r));
    const s = layoutStatus(paths, r);
    assert.equal(s.status, "current", r.imageId);
    assert.equal(s.file?.recordKey, r.key);
    assert.ok(readLayoutMeasure(paths, r), "measured once by code");
    assert.equal(Object.keys(r).includes("layout"), false, "the record itself is unchanged");
  }
  // Write-once: a second writer keeps the first layout.
  const r = fresh[0] as AnalysisRecord;
  const first = readLayoutFile(paths, r);
  assert.equal(ensureLayout(paths, r)?.createdAt, first?.createdAt);
});

test("a settled reading the layout no longer fits leaves it missing; older versions read as outdated", async () => {
  const { loaded } = await libraryProject();
  loaded.config.options.speed.layoutCapture = true;
  await runAnalysis(loaded, buildAnalysisPlan(loaded, "core"), providers());
  const paths = projectPaths(loaded);
  const r = [...readRecords(paths).values()].find((x) =>
    readLayoutFile(paths, x),
  ) as AnalysisRecord & { final: NonNullable<AnalysisRecord["final"]> };
  // As if a settled dispute kept a reading without a marketing layer.
  const settled: AnalysisRecord = {
    ...r,
    final: {
      ...r.final,
      marketingLayer: {
        ...r.final.marketingLayer,
        present: false,
        texts: [],
        backgroundMasks: [],
        elements: [],
      },
    },
  };
  assert.match(layoutFromAnswer(paths, settled).problems.join(), /marketing layer is absent/);
  // A layout saved before the reading changed no longer counts.
  assert.equal(layoutStatus(paths, r).status, "current");
  assert.equal(layoutStatus(paths, settled).status, "missing");
  assert.equal(ensureLayout(paths, settled), null);
  const storage = workspaceStorage(paths.workspace);
  const file = readLayoutFile(paths, r);
  assert.ok(file);
  const otherKey = { ...r, key: "0".repeat(32) };
  storage.putJson(LIB.layout(r.imageId, "old"), {
    ...file,
    recordKey: otherKey.key,
    version: "layout-schema.v0",
  });
  assert.equal(layoutStatus(paths, otherKey).status, "outdated");
});

test("trial files are skipped by the record reader and removed only when equal to their sample", async () => {
  const { loaded, storage } = await libraryProject();
  const paths = projectPaths(loaded);
  const [a, b] = [...readRecords(paths).keys()] as [string, string];
  // Shaped like this project's newest own record, so only the file-name filter keeps it out.
  const sample = {
    imageSha256: a,
    imageId: a,
    writtenBy: loaded.config.project,
    updatedAt: "9999",
  };
  storage.putJson(`library/analysis/${a}/structure-test-v0.json`, sample);
  storage.putJson(`library/analysis/${b}/structure-test-v0.json`, {
    imageSha256: b,
    changed: true,
  });
  const models = { ...loaded.config.models, fullAnalysis: "claude:another-model" };
  const moved = projectPaths({ ...loaded, config: { ...loaded.config, models } });
  assert.notEqual(moved.library?.analysisKey, paths.library?.analysisKey);
  assert.equal(readRecord(moved, a)?.updatedAt === "9999", false, "never read as a record");
  const dry = cleanupTrialFiles(storage, [sample, { imageSha256: b }], false);
  assert.equal(dry.found.length, 2);
  assert.deepEqual(dry.removed, []);
  const done = cleanupTrialFiles(storage, [sample, { imageSha256: b }], true);
  assert.deepEqual(done.removed, [`library/analysis/${a}/structure-test-v0.json`]);
  assert.match(done.kept[0]?.reason ?? "", /differs/);
  assert.ok(storage.exists(`library/analysis/${b}/structure-test-v0.json`));
  assert.throws(() => storage.deleteTrialFile(`library/analysis/${a}/x.json`), /Refusing/);
});
