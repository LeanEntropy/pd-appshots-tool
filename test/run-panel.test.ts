import assert from "node:assert/strict";
import { test } from "node:test";
import type { CallContext } from "../src/analysis/call.ts";
import { compareLayers, type LayerItem } from "../src/analysis/layer-diff-run.ts";
import { renderReportPrompt } from "../src/analysis/prompts.ts";
import type { Provider, VisionCall } from "../src/analysis/providers.ts";
import { readRecords } from "../src/analysis/records.ts";
import { type ItemState, STOPPED_STEP, stepTracker } from "../src/analysis/run-status.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../src/config/load.ts";
import { cancel } from "../src/jobs/index.ts";
import { answerKey } from "../src/library/layout.ts";
import { enqueueReport, reportApproval } from "../src/reports/report-job.ts";
import { createReport } from "../src/reports/store.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { openImageDb } from "../src/store/imagedb.ts";
import { readDeck } from "../src/store/manifest.ts";
import {
  addDeck,
  analyse,
  builderProject,
  idOf,
  idsOf,
  newText,
  picture,
  readyReport,
  usBytes,
} from "./helpers/builder.ts";
import { reportFake } from "./helpers/report-fakes.ts";

test("step tracker: waiting, running, done with time and cost, failed, skipped", () => {
  let spent = 0;
  let t = 0;
  const seen: number[] = [];
  const s = stepTracker(
    [
      { key: "a", label: "Words used in Japanese" },
      { key: "b", label: "Advice for Japan" },
      { key: "c", label: "A/B tests" },
    ],
    () => spent,
    (list) => seen.push(list.length),
    () => new Date(Date.UTC(2026, 8, 29, 0, 0, t)),
  );
  assert.deepEqual(
    s.list().map((x) => x.state),
    ["waiting", "waiting", "waiting"],
  );
  s.start("a");
  t = 5;
  spent = 0.25;
  // Starting the next step ends the running one as done, with its time and cost.
  s.start("b");
  const a = s.list()[0];
  assert.equal(a?.state, "done");
  assert.equal(a?.usd, 0.25);
  assert.equal(a?.endedAt, "2026-09-29T00:00:05.000Z");
  spent = 0.4;
  s.endRunning("advice: the model failed");
  assert.equal(s.list()[1]?.state, "failed");
  assert.equal(s.list()[1]?.usd, 0.15);
  // A step not started because Stop was pressed is skipped, not failed.
  s.start("c");
  s.end("c", `country advice for Japan: fake: ${STOPPED_STEP}`);
  assert.equal(s.list()[2]?.state, "skipped");
  assert.equal(s.list()[2]?.note, STOPPED_STEP);
  // A step not planned is added when it starts; a done step can still be marked failed.
  s.start("fix", "Fixing the advice for Japan after the check");
  s.end("fix");
  s.end("fix", "revision: bad answer");
  assert.equal(s.list()[3]?.label, "Fixing the advice for Japan after the check");
  assert.equal(s.list()[3]?.state, "failed");
  s.skipWaiting("never");
  assert.ok(seen.length >= 5);
});

function ctxFor(loaded: LoadedConfig): CallContext {
  const paths = projectPaths(loaded);
  const { taxonomy, hash } = loadTaxonomy(loaded);
  return {
    storage: workspaceStorage(paths.workspace),
    answerKey: (step, key) => answerKey(paths, step, key),
    taxonomy,
    taxonomyHash: hash,
    maxBudgetUsd: 3,
    remainingUsd: () => 10,
    timeoutMs: 1000,
    onCost: () => {},
  };
}

test("text comparisons: an image shared by two countries is compared once, in a pool of 3, with no false problem", async () => {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  const appId = idOf(loaded, ours);
  analyse(loaded, [ours]);
  const tw = [];
  for (const p of [1, 2]) tw.push(await newText(usBytes(loaded, appId, p)));
  await addDeck(loaded, ours, "tw", "zh-TW", tw, "ours");
  const paths = projectPaths(loaded);
  const us = readDeck(paths.decks, { appId, gl: "us", hl: "en" });
  const deck = readDeck(paths.decks, { appId, gl: "tw", hl: "zh-TW" });
  // Taiwan #1, Hong Kong #1 (the very same file), Taiwan #2.
  const item = (p: number, gl: string, label: string): LayerItem => ({
    imageId: deck?.slots[p - 1]?.imageId as string,
    anchorId: us?.slots[p - 1]?.imageId as string,
    appId,
    name: ours,
    gl,
    hl: "zh-TW",
    label,
    position: p,
  });
  const items = [item(1, "tw", "Taiwan"), item(1, "hk", "Hong Kong"), item(2, "tw", "Taiwan")];
  const fake = reportFake();
  const calls: VisionCall[] = [];
  const slow: Provider = {
    ...fake,
    async call(c) {
      calls.push(c);
      await new Promise((r) => setTimeout(r, 30));
      return fake.call(c);
    },
  };
  const failures: string[] = [];
  const states: [string, ItemState, string | null | undefined][] = [];
  const counter = { done: 0 };
  const r = await compareLayers(items, {
    paths,
    db: openImageDb(paths),
    provider: slow,
    prompt: renderReportPrompt(loaded.root, paths.objects, "layerDiff", ctxFor(loaded).taxonomy),
    ctx: ctxFor(loaded),
    runId: "2026-09-29T10-00-00-000Z-r-test",
    batchId: "b1",
    records: readRecords(paths),
    estimatePerImage: 0.06,
    stopAfterSameErrors: 3,
    shouldStop: () => false,
    budgetLeft: () => 10,
    spent: () => 0,
    progress: () => {},
    fail: (m) => {
      failures.push(m);
    },
    counter,
    total: 3,
    concurrency: 3,
    item: (id, st, note) => {
      states.push([id, st, note]);
    },
  });
  assert.equal(calls.length, 2, "the shared image is compared once");
  assert.deepEqual(failures, [], "no 'being compared by another job' problem");
  assert.equal(counter.done, 3, "both countries of the shared image count as done");
  assert.equal(r.records.length, 2);
  const last = new Map(states.map(([id, st]) => [id, st]));
  assert.equal(last.get(items[0]?.imageId as string), "text");
  assert.equal(last.get(items[2]?.imageId as string), "text");
  assert.ok(states.some(([, st]) => st === "running"));
});

const TWO = ["Capybara Go", "Mini Tales"];
const JP = { gl: "jp", hl: "ja", label: "Japan" };

async function japan() {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  analyse(loaded, [ours, ...TWO]);
  readyReport(loaded, "pilot");
  await addDeck(loaded, ours, "jp", "ja", [usBytes(loaded, idOf(loaded, ours), 1)], "ours");
  const capy = usBytes(loaded, idOf(loaded, "Capybara Go"), 1);
  await addDeck(loaded, "Capybara Go", "jp", "ja", [await newText(capy)]);
  await addDeck(loaded, "Mini Tales", "jp", "ja", [await picture(901)]);
  const paths = projectPaths(loaded);
  const def = createReport(workspaceStorage(paths.workspace), paths, {
    name: "Japan vs 2 competitors",
    type: "country",
    scope: { type: "country", markets: [JP], competitors: idsOf(loaded, TWO), includeCharts: [] },
  });
  const a = reportApproval(loaded, def);
  assert.ok(!("problem" in a));
  return { loaded, def, hash: a.plan.planHash };
}

test("report run: every image gets its final state, and every step after the images is listed with time and cost", async () => {
  const { loaded, def, hash } = await japan();
  const fake = reportFake();
  const r = enqueueReport(
    loaded,
    { reportId: def.id, planHash: hash },
    {
      depsFor: (onProgress) => ({ producer: fake, reviewer: null, adjudicator: fake, onProgress }),
      reportProvider: (ref) => ({ ...fake, model: ref.split(":")[1] ?? ref }),
    },
  );
  assert.ok(r.ok);
  const job = await r.done;
  assert.equal(job.state, "finished", job.error ?? "");
  assert.equal(job.items.length, 2);
  for (const it of job.items) {
    const o = job.outcomes[it.imageId];
    assert.ok(o, `${it.name} #${it.position} has a state`);
    assert.notEqual(o?.state, "running");
  }
  const states = job.items.map((it) => job.outcomes[it.imageId]?.state).sort();
  assert.deepEqual(states, ["ok", "text"]);
  assert.deepEqual(
    job.steps.map((s) => [s.label, s.state]),
    [
      ["Words used in Japanese", "done"],
      ["Advice for Japan", "done"],
      ["Check of the advice for Japan (second opinion by the other AI)", "done"],
      ["A/B tests", "done"],
      ["Building the report", "done"],
    ],
  );
  for (const s of job.steps) {
    assert.ok(s.startedAt && s.endedAt, s.label);
    assert.equal(typeof s.usd, "number");
  }
  assert.ok((job.steps[1]?.usd ?? 0) > 0, "the advice's own cost");
});

test("report run: Stop during the written parts ends after the step in progress; the rest is skipped", async () => {
  const { loaded, def, hash } = await japan();
  const fake = reportFake();
  const kinds: string[] = [];
  const r = enqueueReport(
    loaded,
    { reportId: def.id, planHash: hash },
    {
      depsFor: (onProgress) => ({ producer: fake, reviewer: null, adjudicator: fake, onProgress }),
      reportProvider: (ref) => ({
        ...fake,
        model: ref.split(":")[1] ?? ref,
        async call(c) {
          const out = await fake.call(c);
          kinds.push(fake.kinds.at(-1) ?? "");
          // Stop is pressed while the words are grouped (the first step after the images).
          if (fake.kinds.at(-1) === "concept") cancel(loaded);
          return out;
        },
      }),
    },
  );
  assert.ok(r.ok);
  const job = await r.done;
  assert.equal(job.state, "stopped");
  assert.match(job.error ?? "", /you pressed Stop/);
  assert.ok(!kinds.includes("advice"), "no step starts after Stop");
  assert.deepEqual(
    job.steps.map((s) => s.state),
    ["done", "skipped", "skipped", "skipped", "done"],
  );
  assert.equal(job.errors.length, 0, "a skipped step is not a problem");
});
