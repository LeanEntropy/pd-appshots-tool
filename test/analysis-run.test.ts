import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalProblem } from "../src/analysis/job.ts";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { readRecords } from "../src/analysis/records.ts";
import { runAnalysis } from "../src/analysis/run.ts";
import { projectPaths } from "../src/config/load.ts";
import { savePick } from "../src/core/selection.ts";
import { fakeProvider } from "./helpers/fake-provider.ts";
import { tempProject } from "./helpers/project.ts";

const DECKS = {
  "Archero 2": { phone: 3, tablet: 2 },
  "Capybara Go": { phone: 2, tablet: 0 },
  "Mini Tales": { phone: 1, tablet: 0 },
  Heroll: { phone: 1, tablet: 0 },
  Dicero: { phone: 1, tablet: 0 },
};
const PICK = [
  "com.xq.archeroii",
  "com.habby.capybara",
  "com.loadcomplete.minitales",
  "com.percent.aos.rollinghero",
  "com.bailing.lark.roll.dev",
];

async function setup() {
  const loaded = await tempProject(DECKS);
  savePick(loaded, PICK, "cli");
  return loaded;
}

test("pilot plan: ours plus the first two picked, phone screenshots only, tablet ones listed", async () => {
  const loaded = await setup();
  const plan = buildAnalysisPlan(loaded, "pilot");
  assert.deepEqual(
    plan.games.map((g) => g.positions.length),
    [3, 3, 2],
  );
  assert.equal(plan.counts.full, 8);
  assert.equal(plan.excluded.length, 2);
  assert.equal(plan.withinCap, true);
  assert.equal(
    approvalProblem(undefined, plan, plan.planHash),
    "No approval screen was shown for this batch yet.",
  );
  assert.equal(approvalProblem(plan, plan, plan.planHash), null);
});

test("run: deck calls, blind review, disputes settled, results cached and reused", async () => {
  const loaded = await setup();
  const plan = buildAnalysisPlan(loaded, "pilot");
  const producer = fakeProvider({
    read: () => ({ screenType: "gameplay", headline: "EPIC BOSS FIGHTS!" }),
  });
  let n = 0;
  const reviewer = fakeProvider({
    family: "openai",
    read: () =>
      n++ === 0
        ? { screenType: "map_world", headline: "EPIC BOSS FIGHTS" }
        : { screenType: "gameplay", headline: "epic boss fights" },
  });
  const adjudicator = fakeProvider({
    read: () => ({ screenType: "gameplay", headline: "EPIC BOSS FIGHTS!" }),
  });
  const out = await runAnalysis(loaded, plan, {
    producer,
    reviewer,
    adjudicator,
    onProgress: () => {},
  });
  assert.equal(out.records.length, 8);
  assert.equal(producer.calls.length, 8);
  assert.equal(reviewer.calls.length, 8);
  assert.equal(adjudicator.calls.length, 1);
  assert.equal(out.records.filter((r) => r.status === "adjudicated").length, 1);
  assert.equal(out.records.filter((r) => r.status === "ok").length, 7);
  assert.equal(readRecords(projectPaths(loaded)).size, 8);

  const again = buildAnalysisPlan(loaded, "pilot");
  assert.equal(again.counts.full, 0);
  assert.equal(again.counts.identical, 8);
});

test("a deck answer that fails validation is repaired, then falls back to one image per call", async () => {
  const loaded = await setup();
  loaded.config.estimates.imagesPerCall = 10;
  const plan = buildAnalysisPlan(loaded, "pilot");
  const producer = fakeProvider({
    read: () => ({ screenType: "gameplay", headline: "" }),
    badDeckCalls: 99,
  });
  const out = await runAnalysis(loaded, plan, {
    producer,
    reviewer: null,
    adjudicator: producer,
    onProgress: () => {},
  });
  assert.equal(out.records.filter((r) => r.status === "ok").length, 8);
  const deckCalls = producer.calls.filter((c) => c.images.length > 1).length;
  assert.equal(deckCalls, 3 * 3);
  assert.match(producer.calls[1]?.prompt ?? "", /previous answer had these problems/);
});

test("the spending guard stops a batch that costs far more than estimated", async () => {
  const loaded = await setup();
  const plan = buildAnalysisPlan(loaded, "pilot");
  const producer = fakeProvider({
    read: () => ({ screenType: "gameplay", headline: "" }),
    costUsd: 50,
  });
  const out = await runAnalysis(loaded, plan, {
    producer,
    reviewer: null,
    adjudicator: producer,
    onProgress: () => {},
  });
  assert.equal(out.stoppedForBudget, true);
  assert.equal(producer.calls.length, 1);
});

test("a required second opinion that cannot be read leaves the image unreviewed, not ok", async () => {
  const loaded = await setup();
  const plan = buildAnalysisPlan(loaded, "pilot");
  const producer = fakeProvider({ read: () => ({ screenType: "gameplay", headline: "" }) });
  const reviewer = fakeProvider({
    family: "openai",
    read: () => ({ screenType: "gameplay", headline: "" }),
    badDeckCalls: 99,
  });
  reviewer.call = async (c) => {
    reviewer.calls.push(c);
    return { ok: false, output: null, costUsd: null, error: "unavailable" };
  };
  const out = await runAnalysis(loaded, plan, {
    producer,
    reviewer,
    adjudicator: producer,
    onProgress: () => {},
  });
  // The same failure three times in a row stops the batch, loudly.
  assert.equal(out.records.filter((r) => r.status === "unreviewed").length, 3);
  assert.match(out.aborted ?? "", /3 images in a row failed with the same error/);
  assert.equal(out.errors.length, 3);
  assert.match(out.records[0]?.problems[0] ?? "", /second opinion could not be read/);
  assert.equal(out.synthesisSkipped, "the batch stopped early");
});

test("the approval fingerprint changes when any number on the screen changes", async () => {
  const loaded = await setup();
  const a = buildAnalysisPlan(loaded, "pilot");
  loaded.config.estimates.fullAnalysisUsdPerImage = [0.5, 0.9];
  const b = buildAnalysisPlan(loaded, "pilot");
  assert.notEqual(a.planHash, b.planHash);
  loaded.config.estimates.imagesPerCall = 2;
  assert.notEqual(buildAnalysisPlan(loaded, "pilot").planHash, b.planHash);
});

test("each model call gets at most what is left of the batch limit", async () => {
  const loaded = await setup();
  const plan = buildAnalysisPlan(loaded, "pilot");
  const producer = fakeProvider({
    read: () => ({ screenType: "gameplay", headline: "" }),
    costUsd: 1,
  });
  await runAnalysis(loaded, plan, {
    producer,
    reviewer: null,
    adjudicator: producer,
    onProgress: () => {},
  });
  const limits = producer.calls.map((c) => c.maxBudgetUsd);
  assert.ok(limits.every((l) => l <= 3));
  assert.ok((limits.at(-1) ?? 99) < (limits[0] ?? 0));
});
