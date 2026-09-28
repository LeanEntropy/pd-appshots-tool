import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test } from "node:test";
import { readAttempts, recordLockKey } from "../src/analysis/attempts.ts";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import type { Provider } from "../src/analysis/providers.ts";
import { isUsable, readRecord, readRecords, writeRecord } from "../src/analysis/records.ts";
import { runAnalysis } from "../src/analysis/run.ts";
import { type LoadedConfig, projectPaths } from "../src/config/load.ts";
import { savePick } from "../src/core/selection.ts";
import { runImport } from "../src/library/import/run-import.ts";
import { freeImages } from "../src/server/api-analysis.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { fakeProvider } from "./helpers/fake-provider.ts";
import { legacyProject, PICK } from "./helpers/imported.ts";
import { tempProject } from "./helpers/project.ts";

const DECKS = {
  "Archero 2": { phone: 3, tablet: 0 },
  "Capybara Go": { phone: 2, tablet: 0 },
  "Mini Tales": { phone: 1, tablet: 0 },
  Heroll: { phone: 1, tablet: 0 },
  Dicero: { phone: 1, tablet: 0 },
};

/** Fake providers that take a little time per call and count the image analyses. */
function counting() {
  const read = () => ({ screenType: "gameplay", headline: "EPIC" });
  const base = fakeProvider({ model: "claude-fable-5-1", read });
  let calls = 0;
  const producer: Provider = {
    family: base.family,
    model: base.model,
    async call(c) {
      calls++;
      await new Promise((r) => setTimeout(r, 15));
      return base.call(c);
    },
  };
  return {
    deps: {
      producer,
      reviewer: null,
      adjudicator: fakeProvider({ model: "claude-opus-5-5", read }),
      onProgress: () => {},
    },
    calls: () => calls,
  };
}

async function ready(): Promise<LoadedConfig> {
  const loaded = await tempProject(DECKS);
  savePick(loaded, PICK, "cli");
  return loaded;
}

test("two runners racing on the same images pay for each image once", async () => {
  const loaded = await ready();
  const plan = buildAnalysisPlan(loaded, "pilot");
  const full = plan.items.filter((i) => i.tier === "full");
  const a = counting();
  const b = counting();
  const [ra, rb] = await Promise.all([
    runAnalysis(loaded, plan, a.deps),
    runAnalysis(loaded, plan, b.deps),
  ]);
  assert.equal(a.calls() + b.calls(), full.length, "each image analysed once");
  const paths = projectPaths(loaded);
  for (const it of full) {
    assert.ok(isUsable(readRecord(paths, it.imageId)));
    const attempts = readAttempts(paths, it.imageId);
    assert.equal(attempts.length, 1, "one paid attempt per image");
    assert.equal(attempts[0]?.state, "finished");
  }
  assert.equal(ra.records.length + rb.records.length, full.length);
});

test("an image finished after planning is skipped as already analysed, free", async () => {
  const loaded = await ready();
  const paths = projectPaths(loaded);
  const first = counting();
  await runAnalysis(loaded, buildAnalysisPlan(loaded, "pilot"), first.deps);
  const core = buildAnalysisPlan(loaded, "core");
  const target = core.items.find((i) => i.tier === "full");
  const donor = [...readRecords(paths).values()].find((r) => isUsable(r));
  assert.ok(target && donor);
  // Another project (or terminal run) finishes it after the approval screen was built.
  writeRecord(paths, {
    ...donor,
    imageId: target.imageId,
    position: target.position,
    appId: target.appId,
  });
  const second = counting();
  await runAnalysis(loaded, core, second.deps);
  assert.equal(second.calls(), core.counts.full - 1);
  assert.equal(readAttempts(paths, target.imageId).length, 0, "nothing paid for it");
});

test("a stale record lock (its process is gone) is taken over", async () => {
  const loaded = await ready();
  const paths = projectPaths(loaded);
  const plan = buildAnalysisPlan(loaded, "pilot");
  const it = plan.items.find((i) => i.tier === "full");
  assert.ok(it);
  const file = workspaceStorage(paths.workspace).localPath(recordLockKey(paths, it.imageId));
  mkdirSync(dirname(file), { recursive: true });
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  writeFileSync(
    file,
    JSON.stringify({
      nonce: "d".repeat(32),
      pid: 999_999,
      processStartedAt: old,
      projectId: "gone",
      kind: "analysis",
      startedAt: old,
      heartbeatAt: old,
    }),
  );
  const c = counting();
  await runAnalysis(loaded, plan, c.deps);
  assert.equal(c.calls(), plan.counts.full);
  assert.ok(isUsable(readRecord(paths, it.imageId)));
});

test("the approval's free row says who paid: this project or another one", async () => {
  const { loaded, root } = await legacyProject();
  await runImport({ root, configPath: loaded.path, apply: true });
  const paths = projectPaths(loaded);
  const plan = buildAnalysisPlan(loaded, "pilot");
  const names = (id: string) => (id === "other-game" ? "Other Game" : id);
  const before = freeImages(loaded, plan, names);
  assert.ok(before.thisProject > 0);
  assert.deepEqual(before.others, []);
  const reused = plan.items.find((i) => i.tier === "identical" && i.reason === "already analysed");
  const rec = reused && readRecord(paths, reused.imageId);
  assert.ok(rec);
  writeRecord(paths, {
    ...rec,
    paidBy: { projectId: "other-game", runId: "r", usd: 0.2, at: rec.updatedAt },
  });
  const after = freeImages(loaded, plan, names);
  assert.equal(after.thisProject, before.thisProject - 1);
  assert.deepEqual(after.others, [{ projectId: "other-game", name: "Other Game", count: 1 }]);
});
