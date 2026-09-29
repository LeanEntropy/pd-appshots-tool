import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { RUN_SCRIPT } from "../src/view/gallery-run.ts";

/** The run panel's HTML for a status, drawn by the page's own script. */
function panel(status: unknown): string {
  const ctx: Record<string, unknown> = {
    esc: (s: unknown) => String(s),
    spinHtml: () => "",
    ACT_SPIN: () => "",
    setInterval: () => 0,
    document: { addEventListener: () => {} },
  };
  runInNewContext(
    `${RUN_SCRIPT}\nthis.draw = (s) => { lastStatus = s; return runPanelHtml(s); };`,
    ctx,
  );
  return (ctx.draw as (s: unknown) => string)(status);
}

const base = {
  running: true,
  stoppable: true,
  startedAt: new Date(Date.now() - 60_000).toISOString(),
  finishedAt: null,
  spentUsd: 1.2,
  errors: [],
  reportName: "Japan vs 2",
  batch: {
    estimateUsd: [1, 2],
    items: [
      { name: "Archero 2 (Japan)", position: 1, imageId: "a" },
      { name: "Archero 2 (Japan)", position: 2, imageId: "b" },
      { name: "Path of Kings (Taiwan)", position: 4, imageId: "c" },
      { name: "Path of Kings (Hong Kong)", position: 4, imageId: "c" },
    ],
  },
};

test("run panel: images show their real state; Stop names the phase", () => {
  const images = panel({
    ...base,
    progress: { phase: "layer-diff", done: 1, total: 4, message: "Comparing text", spentUsd: 1 },
    outcomes: { a: { state: "text", note: null }, b: { state: "running", note: null } },
    steps: [
      {
        key: "build",
        label: "Building the report",
        state: "waiting",
        startedAt: null,
        endedAt: null,
        usd: null,
        note: null,
      },
    ],
  });
  assert.match(images, /Stop after the running images/);
  assert.match(images, /Archero 2 \(Japan\) #1 <span class="st">text compared/);
  assert.match(images, /Archero 2 \(Japan\) #2 <span class="st">in progress/);
  assert.match(images, /Building the report <span class="st">waiting/);

  const t0 = new Date(Date.now() - 30_000).toISOString();
  const t1 = new Date(Date.now() - 10_000).toISOString();
  const text = panel({
    ...base,
    progress: {
      phase: "country-advice",
      done: 4,
      total: 4,
      message: "Writing the advice",
      spentUsd: 1,
    },
    outcomes: {
      a: { state: "text", note: null },
      b: { state: "reused", note: "compared before: reused, free" },
      c: { state: "ok", note: null },
    },
    steps: [
      {
        key: "words:ja",
        label: "Words used in Japanese",
        state: "done",
        startedAt: t0,
        endedAt: t1,
        usd: 0.12,
        note: null,
      },
      {
        key: "advice:th",
        label: "Advice for Thailand",
        state: "running",
        startedAt: t1,
        endedAt: null,
        usd: null,
        note: null,
      },
      {
        key: "build",
        label: "Building the report",
        state: "waiting",
        startedAt: null,
        endedAt: null,
        usd: null,
        note: null,
      },
    ],
  });
  assert.match(text, /Stop after this step/);
  assert.doesNotMatch(text, /Stop after the running images/);
  assert.doesNotMatch(text, /class="st">waiting<\/span><\/li><\/ol><\/details>$/);
  assert.equal(
    (text.match(/Path of Kings \([^)]*\) #4 <span class="st">analysed/g) ?? []).length,
    2,
  );
  assert.match(text, /Words used in Japanese <span class="st">done &middot; 20 s, \$0\.12/);
  assert.match(text, /Advice for Thailand <span class="st">running/);
  assert.match(text, /step 2 of 3: Advice for Thailand/);
  assert.match(text, /After the images: 1 of 3 steps done/);
  assert.match(text, /Images in this batch: 4 done/);
});
