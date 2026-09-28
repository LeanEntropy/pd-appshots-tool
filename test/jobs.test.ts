import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { batchSpend } from "../src/analysis/attempts.ts";
import { type LoadedConfig, projectPaths } from "../src/config/load.ts";
import { savePick } from "../src/core/selection.ts";
import { cancel, enqueue, list, status } from "../src/jobs/index.ts";
import { readJournal, writeJournal } from "../src/jobs/journal.ts";
import { postAnalysisPlan } from "../src/server/api.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { LOCKS, tryAcquire } from "../src/storage/leases.ts";
import { PICK } from "./helpers/imported.ts";
import { fakeDeps, outcome, settle } from "./helpers/jobs.ts";
import { tempProject } from "./helpers/project.ts";

const DECKS = {
  "Archero 2": { phone: 3, tablet: 0 },
  "Capybara Go": { phone: 2, tablet: 0 },
  "Mini Tales": { phone: 1, tablet: 0 },
  Heroll: { phone: 1, tablet: 0 },
  Dicero: { phone: 1, tablet: 0 },
};

async function ready(): Promise<LoadedConfig> {
  const loaded = await tempProject(DECKS);
  savePick(loaded, PICK, "cli");
  return loaded;
}

function approve(loaded: LoadedConfig, continueBatch?: string) {
  const r = postAnalysisPlan(
    loaded,
    continueBatch ? { stage: "pilot", continueBatch } : { stage: "pilot" },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as {
    plan: { planHash: string };
    continuing: { spentUsd: number; limitUsd: number; leftUsd: number } | null;
  };
}

const storageOf = (l: LoadedConfig) => workspaceStorage(projectPaths(l).workspace);

test("Stop ends the batch after the current image; Continue carries the spend and the limit", async () => {
  const loaded = await ready();
  const shown = approve(loaded);
  const r = enqueue(
    loaded,
    "analysis",
    { stage: "pilot", planHash: shown.plan.planHash },
    {
      depsFor: (cb) =>
        fakeDeps((p) => {
          cb(p);
          if (/: saved$/.test(p.message)) cancel(loaded);
        }),
    },
  );
  assert.ok(r.ok);
  const job = await r.done;
  assert.equal(job.state, "stopped");
  assert.match(job.error ?? "", /you pressed Stop/);
  const s = status(loaded);
  assert.equal(s.running, false);
  assert.equal(s.continuable?.remaining, 8 - 1);
  assert.equal(s.ledger?.spentUsd, 0.1, "one image paid");
  // Continue: the approval shows what the batch spent and its limit; the run gets the rest.
  const cont = approve(loaded, s.ledger?.batchId);
  assert.equal(cont.continuing?.spentUsd, 0.1);
  assert.ok(
    Math.abs((cont.continuing?.leftUsd ?? 0) - ((cont.continuing?.limitUsd ?? 0) - 0.1)) < 0.011,
  );
  let budget = -1;
  const again = enqueue(
    loaded,
    "analysis",
    { stage: "pilot", planHash: cont.plan.planHash, continueBatch: s.ledger?.batchId },
    {
      depsFor: (cb) => fakeDeps(cb),
      run: async (_l, _p, deps) => {
        budget = deps.budgetUsd ?? -1;
        return outcome();
      },
    },
  );
  assert.ok(again.ok);
  await again.done;
  assert.ok(Math.abs(budget - ((cont.continuing?.limitUsd ?? 0) - 0.1)) < 1e-9);
  // The ledger is summed from the attempt logs on disk, so it survives a restart.
  const b = readJournal(storageOf(loaded), projectPaths(loaded)).batches[0];
  assert.equal(b?.runs.length, 2);
  assert.equal(batchSpend(projectPaths(loaded), b?.id ?? "", b?.imageIds ?? []).usd, 0.1);
});

test("the same approval never starts two jobs; one project runs one analysis", async () => {
  const loaded = await ready();
  const shown = approve(loaded);
  let release = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const opts = {
    depsFor: (cb: Parameters<typeof fakeDeps>[0]) => fakeDeps(cb),
    run: async () => {
      await gate;
      return outcome();
    },
  };
  const a = enqueue(loaded, "analysis", { stage: "pilot", planHash: shown.plan.planHash }, opts);
  const b = enqueue(loaded, "analysis", { stage: "pilot", planHash: shown.plan.planHash }, opts);
  assert.ok(a.ok && b.ok);
  assert.equal(b.jobId, a.jobId);
  assert.equal(b.existing, true);
  const c = enqueue(loaded, "analysis", { stage: "core", planHash: "c".repeat(64) }, opts);
  assert.equal(c.ok, false);
  assert.equal(status(loaded).running, true);
  assert.equal(status(loaded).stoppable, true);
  release();
  await settle(loaded);
  assert.equal(status(loaded).state, "finished");
});

test("one AI job across all projects; never a download and an analysis in one project", async () => {
  const loaded = await ready();
  const storage = storageOf(loaded);
  const other = { projectId: "other-game" };
  const lease = tryAcquire(storage, LOCKS.ai, { ...other, kind: "analysis" });
  assert.ok(!("heldBy" in lease));
  const now = new Date().toISOString();
  writeJournal(storage, other, {
    version: 1,
    jobs: {
      ai: {
        id: "j1",
        kind: "analysis",
        planHash: "p",
        stage: "pilot",
        batchId: null,
        frozenInput: null,
        lockNonce: lease.nonce,
        startedAt: now,
        heartbeatAt: now,
        finishedAt: null,
        progress: { phase: "analysis", done: 2, total: 10, message: "m", spentUsd: 0.5 },
        state: "running",
        errors: [],
        error: null,
        report: null,
        synthesisSkipped: null,
        items: [],
        estimateUsd: null,
        cancelled: false,
      },
    },
    batches: [],
    increments: [],
  });
  const shown = approve(loaded);
  const r = enqueue(loaded, "analysis", { stage: "pilot", planHash: shown.plan.planHash });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.problem : "", /other-game is using the AI now \(image 3 of 10\)/);
  assert.match(status(loaded).otherAi ?? "", /other-game is using the AI now/);
  const lanes = list(storage);
  assert.deepEqual(
    lanes.map((l) => [l.lane, l.projectId, l.done, l.total]),
    [["ai", "other-game", 2, 10]],
  );
  lease.release();
  const store = tryAcquire(storage, LOCKS.store, {
    projectId: projectPaths(loaded).projectId,
    kind: "download",
  });
  assert.ok(!("heldBy" in store));
  const d = enqueue(loaded, "analysis", { stage: "pilot", planHash: shown.plan.planHash });
  assert.match(!d.ok ? d.problem : "", /downloading/);
  store.release();
});

test("a running job whose lock is gone shows as interrupted; the old status file is a fallback", async () => {
  const loaded = await ready();
  const paths = projectPaths(loaded);
  mkdirSync(paths.pending, { recursive: true });
  writeFileSync(
    join(paths.pending, "analysis-status.json"),
    JSON.stringify({
      running: false,
      stage: "pilot",
      startedAt: "2026-09-01T00:00:00.000Z",
      finishedAt: "2026-09-01T00:10:00.000Z",
      progress: { phase: "done", done: 1, total: 18, message: "Finished.", spentUsd: 0.2 },
      error: null,
    }),
  );
  const old = status(loaded);
  assert.equal(old.state, "finished");
  assert.equal(old.stage, "pilot");
  const shown = approve(loaded);
  const r = enqueue(
    loaded,
    "analysis",
    { stage: "pilot", planHash: shown.plan.planHash },
    {
      depsFor: (cb) => fakeDeps(cb),
      run: async () => outcome(),
    },
  );
  assert.ok(r.ok);
  await r.done;
  // Simulate a crash: the journal says running, but nobody holds the AI lock with its nonce.
  const storage = storageOf(loaded);
  const j = readJournal(storage, paths);
  if (j.jobs.ai) Object.assign(j.jobs.ai, { state: "running", finishedAt: null });
  writeJournal(storage, paths, j);
  const s = status(loaded);
  assert.equal(s.interrupted, true);
  assert.equal(s.state, "stopped");
  assert.equal(s.running, false);
  assert.equal(s.finishedAt, null);
  assert.match(s.error ?? "", /stopped during this run/);
});
