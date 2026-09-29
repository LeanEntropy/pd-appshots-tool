import assert from "node:assert/strict";
import { test } from "node:test";
import { readAttempts } from "../src/analysis/attempts.ts";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { isUsable, readRecords } from "../src/analysis/records.ts";
import { runAnalysis } from "../src/analysis/run.ts";
import { projectPaths } from "../src/config/load.ts";
import { readLayout } from "../src/layout/checks.ts";
import { layoutStatus } from "../src/layout/store.ts";
import { runImport } from "../src/library/import/run-import.ts";
import { fakeProvider, reading } from "./helpers/fake-provider.ts";
import { legacyProject } from "./helpers/imported.ts";
import { fakeLayout } from "./helpers/layout.ts";

test("a creature the analysis puts on the marketing layer and not drawn as a cut-out is a note", () => {
  const core = reading("img1", "gameplay", "EPIC");
  core.marketingLayer.elements = [
    {
      kind: "creature",
      what: "purple mascot",
      position: "right",
      pose: "standing",
      colours: "purple",
      region: { x: 60, y: 40, w: 30, h: 30 },
    },
  ];
  const without = readLayout(fakeLayout(core), core);
  assert.ok(without.layout, "saved, not retried");
  assert.deepEqual(without.notes, ["Note: the purple mascot isn't drawn as its own box."]);
  const l = fakeLayout(core);
  l.marketing.push({
    ...(l.marketing[0] as (typeof l.marketing)[0]),
    id: "M3",
    role: "cut-out",
    box: { x: 60, y: 40, w: 30, h: 30 },
    covers: [],
  });
  assert.deepEqual(readLayout(l, core).notes, []);
});

test("the layout call shares the batch's spending limit; when it cannot be paid the analysis is kept", async () => {
  const { loaded, root } = await legacyProject();
  await runImport({ root, configPath: loaded.path, apply: true });
  loaded.config.options.speed.layoutCapture = true;
  loaded.config.options.speed.parallelCalls = 1;
  const producer = fakeProvider({
    model: "claude-fable-5-1",
    read: () => ({ screenType: "gameplay", headline: "EPIC" }),
    costUsd: 0.3,
  });
  const plan = buildAnalysisPlan(loaded, "core");
  // $0.45: one analysis ($0.30, reserved at $0.40) fits; its layout call (reserved at $0.25) not.
  const out = await runAnalysis(loaded, plan, {
    producer,
    reviewer: null,
    adjudicator: producer,
    onProgress: () => {},
    budgetUsd: 0.45,
  });
  const paths = projectPaths(loaded);
  const done = out.records.filter((r) => isUsable(r));
  assert.equal(done.length, 1);
  assert.equal(producer.calls.filter((c) => c.prompt.startsWith("Draw the layout")).length, 0);
  const r = readRecords(paths).get(done[0]?.imageId as string);
  assert.ok(r && isUsable(r), "the analysis is saved");
  assert.equal(layoutStatus(paths, r).status, "missing");
  assert.ok(out.spentUsd <= 0.45);
});

test("the layout call's cost is part of the image's paid attempt (resume and the limit see it)", async () => {
  const { loaded, root } = await legacyProject();
  await runImport({ root, configPath: loaded.path, apply: true });
  loaded.config.options.speed.layoutCapture = true;
  const producer = fakeProvider({
    model: "claude-fable-5-1",
    read: () => ({ screenType: "gameplay", headline: "EPIC" }),
    costUsd: 0.1,
  });
  const out = await runAnalysis(loaded, buildAnalysisPlan(loaded, "core"), {
    producer,
    reviewer: null,
    adjudicator: producer,
    onProgress: () => {},
  });
  const paths = projectPaths(loaded);
  const done = out.records.filter((r) => isUsable(r));
  assert.ok(done.length > 0);
  for (const r of done) {
    const a = readAttempts(paths, r.imageId).filter((x) => x.state === "finished");
    assert.equal(Math.round((a[0]?.usd ?? 0) * 100) / 100, 0.2, "analysis $0.10 + layout $0.10");
    assert.equal(layoutStatus(paths, r).status, "current");
  }
});

test("a capture or headline of the reading left without a box is a note, not a rejection", () => {
  const core = reading("img1", "gameplay", "EPIC");
  const l = fakeLayout(core);
  assert.deepEqual(readLayout(l, core).problems, []);
  const two = {
    ...core,
    screenshot: {
      ...core.screenshot,
      captures: [...core.screenshot.captures, ...core.screenshot.captures],
    },
  };
  const r2 = readLayout(l, two);
  assert.ok(r2.layout);
  assert.deepEqual(r2.notes, ["Note: screenshot area 2 of 2 has no box."]);
  const noHeadline = { ...l, marketing: l.marketing.filter((e) => e.role !== "headline") };
  const r3 = readLayout(noHeadline, core);
  assert.ok(r3.layout);
  assert.match(r3.notes.join(), /the headline "EPIC" has no box/);
});
