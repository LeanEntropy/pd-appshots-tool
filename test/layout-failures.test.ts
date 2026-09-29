import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { StoredObject } from "../src/analysis/call.ts";
import type { Provider, VisionCall, VisionResult } from "../src/analysis/providers.ts";
import { projectPaths } from "../src/config/load.ts";
import { backfillScope, startBackfill } from "../src/layout/backfill.ts";
import { readLayout } from "../src/layout/checks.ts";
import { layoutCostModel } from "../src/layout/cost.ts";
import { explainFailure } from "../src/layout/failure.ts";
import type { LayoutRunLog } from "../src/layout/run-log.ts";
import { LAYOUT_CONTRACT } from "../src/layout/vocab.ts";
import { runImport } from "../src/library/import/run-import.ts";
import { libraryKey, projectKey, workspaceStorage } from "../src/storage/index.ts";
import { fakeProvider, reading } from "./helpers/fake-provider.ts";
import { legacyProject } from "./helpers/imported.ts";
import { fakeLayout } from "./helpers/layout.ts";

type Plan = "checks" | "timeout" | "once" | "ok";

/**
 * The fake layout provider, per image (in the order first seen): the first always fails the
 * checks, the second times out, the third fails once and then passes; the rest pass.
 */
function flaky(plans: Plan[]): Provider & { calls: VisionCall[]; seen: Map<string, Plan> } {
  const good = fakeProvider({ read: () => ({ screenType: "gameplay", headline: "EPIC" }) });
  const seen = new Map<string, Plan>();
  const tries = new Map<string, number>();
  const calls: VisionCall[] = [];
  return {
    family: "anthropic",
    model: "fake-model",
    calls,
    seen,
    async call(c): Promise<VisionResult> {
      calls.push(c);
      const id = createHash("sha256")
        .update(c.images[0]?.image.bytes() ?? Buffer.alloc(0))
        .digest("hex");
      if (!seen.has(id)) seen.set(id, plans[seen.size] ?? "ok");
      const n = (tries.get(id) ?? 0) + 1;
      tries.set(id, n);
      const plan = seen.get(id);
      if (plan === "timeout")
        return { ok: false, output: null, costUsd: 0.05, error: "the call timed out after 600 s" };
      const r = await good.call(c);
      if (plan === "checks" || (plan === "once" && n === 1)) {
        // A box entirely outside the picture: a hard check, so it is repaired.
        const out = r.output as { layout: { inGame: { box: unknown }[] } };
        const inGame = out.layout.inGame.map((e) => ({
          ...e,
          box: { x: 120, y: 0, w: 10, h: 10 },
        }));
        return { ...r, output: { layout: { ...out.layout, inGame } } };
      }
      return r;
    },
  };
}

test("layout failures: each is recorded with why, its cost counts, and only a new approval retries it", async () => {
  const { loaded, root } = await legacyProject();
  await runImport({ root, configPath: loaded.path, apply: true });
  const paths = projectPaths(loaded);
  const scope = backfillScope(loaded);
  assert.ok(scope.items.length >= 4, "enough images for the test");
  assert.equal(scope.failed.length, 0);

  const bad = flaky(["checks", "timeout", "once"]);
  const r = startBackfill(loaded, scope.scopeHash, () => bad);
  assert.ok(r.ok);
  const end = await r.done;
  assert.equal(end.state, "finished");
  assert.equal(end.failed.length, 2);
  assert.equal(end.saved, scope.items.length - 2);
  assert.equal(end.retried, 1, "the image that passed on its second attempt");
  const checks = end.failed.find((f) => f.kind === "checks");
  const timeout = end.failed.find((f) => f.kind === "timeout");
  assert.ok(checks && timeout);
  assert.match(checks.reason, /a box was empty or entirely outside the picture/);
  assert.equal(checks.calls, 3, "the first answer and two repairs");
  assert.equal(checks.usd, 0.3);
  assert.match(timeout.reason, /took too long/);
  assert.equal(timeout.calls, 2);
  assert.equal(timeout.usd, 0.1);
  assert.equal(end.failedUsd, 0.4);
  // Every call is paid and counted: 3 + 2 for the failures, 2 for the retry, 1 for each other.
  const expected = 0.3 + 0.1 + 0.2 + (scope.items.length - 3) * 0.1;
  assert.equal(end.spentUsd, Math.round(expected * 100) / 100);
  assert.match(end.message, /2 failed \(\$0\.40 of it spent on them\)/);

  // The run's log keeps every call, each image's cost and each failure's reason.
  const storage = workspaceStorage(paths.workspace);
  const log = storage.getJson(projectKey(paths, "runs", end.runId, "layout.json")) as LayoutRunLog;
  assert.equal(log.failed.length, 2);
  assert.equal(log.calls.length, bad.calls.length);
  // Each rejected answer keeps why it was rejected: 3 for the failure, 1 for the retried image.
  const rejected = log.calls.filter((c) => c.problems?.length);
  assert.equal(rejected.length, 4);
  assert.ok(rejected.every((c) => c.problems?.some((x) => /has an empty box/.test(x))));
  assert.equal(log.spentUsd, end.spentUsd);
  assert.ok(log.endedAt);

  // The saved retried answer records what all its attempts cost.
  const answers = storage.children(libraryKey("objects", "layout"));
  const twice = answers
    .map((k) => storage.getJson(libraryKey("objects", "layout", k)) as StoredObject)
    .find((o) => o.attempts === 2);
  assert.ok(twice);
  assert.equal(Math.round((twice.spentUsd ?? 0) * 100) / 100, 0.2);

  // The failed images are not offered again by default; trying them is its own approval.
  const next = backfillScope(loaded);
  assert.equal(next.items.length, 0);
  assert.equal(next.failed.length, 2);
  assert.ok(next.failed.every((f) => f.reason.length > 10));
  const retry = backfillScope(loaded, { retryFailed: true });
  assert.equal(retry.items.length, 2);
  assert.ok(retry.usd[1] > retry.usd[0]);
  const good = flaky([]);
  const wrong = startBackfill(loaded, retry.scopeHash, () => good);
  assert.equal(wrong.ok, false, "the retry list needs the retry approval");
  assert.equal(good.calls.length, 0);
  const again = startBackfill(loaded, retry.scopeHash, () => good, true);
  assert.ok(again.ok);
  const end2 = await again.done;
  assert.equal(end2.saved, 2);
  assert.equal(end2.failed.length, 0);
  assert.equal(backfillScope(loaded).failed.length, 0, "a later success clears the failure");
});

test("layout estimate: from the recorded calls of today's contract (per image tried, retries included)", async () => {
  const { loaded, root } = await legacyProject();
  await runImport({ root, configPath: loaded.path, apply: true });
  const paths = projectPaths(loaded);
  const planned = layoutCostModel(paths);
  assert.match(planned.basis, /planned/);
  // 10 images, 12 calls: two images needed a second call.
  const costs = [0.1, 0.11, 0.12, 0.12, 0.13, 0.13, 0.14, 0.15, 0.16, 0.2, 0.12, 0.14];
  const calls = costs.map((costUsd, i) => ({
    step: "layout",
    model: "fake-model",
    key: `k${i}`,
    imageIds: [`img${i % 10}`],
    ok: true,
    costUsd,
    usage: null,
    at: "2026-09-29T10:00:00.000Z",
    contract: LAYOUT_CONTRACT,
  }));
  // A call of an older contract asked for less: it never counts.
  calls.push({ ...(calls[0] as (typeof calls)[0]), costUsd: 5, contract: "layout.v1" });
  workspaceStorage(paths.workspace).putJson(
    projectKey(paths, "runs", "2026-09-29T10-00-00-000Z-layout-backfill", "layout.json"),
    { runId: "x", kind: "layout-backfill", images: [], failed: [], calls },
  );
  // The same calls kept again in another file of that run count once.
  workspaceStorage(paths.workspace).putJson(
    projectKey(paths, "runs", "2026-09-29T10-00-00-000Z-layout-backfill", "calls.json"),
    { calls },
  );
  const m = layoutCostModel(paths);
  assert.deepEqual(m.perCall, [0.13, 0.16]);
  assert.equal(m.callsPerImage, 1.2);
  // $1.62 over 10 images tried; none saved here, so the high end is 10% above.
  assert.deepEqual(m.perImage, [0.16, 0.18]);
  assert.match(m.basis, /12 recorded layout calls on 10 images/);
  const scope = backfillScope(loaded);
  const n = scope.items.length;
  assert.deepEqual(scope.usd, [Math.round(n * 16) / 100, Math.round(n * 18) / 100]);
  assert.deepEqual(scope.perImageUsd, [0.16, 0.18]);
});

test("layout failure reasons in plain words, one precise sentence per hard check", () => {
  const m = "fake-model";
  assert.equal(explainFailure(["the spending limit for this batch was reached"], m).kind, "budget");
  assert.equal(explainFailure([`${m}: rate limit, 429`], m).kind, "model");
  const c = explainFailure(
    [
      "img1 layout: S2 has an empty box (or one outside the image)",
      "img1 layout: M1 textRef 4 does not exist (2 marketing texts)",
      "img1 layout: M1 note must be at most 160 characters",
    ],
    m,
  );
  assert.equal(c.kind, "checks");
  assert.equal(
    c.reason,
    "The AI's layout failed the checks on every attempt: a box was empty or entirely outside the picture; a box pointed at a marketing text the analysis does not have; a box description was too long.",
  );
  const each: [string, RegExp][] = [
    ["img1 layout: every element id must be unique", /two boxes had the same id/],
    ['img1 layout: marketing id "M11" must be M1 to M10', /more boxes than one layer allows/],
    ["layout.inGame: Too big: expected array to have <=16 items", /more boxes than one layer/],
    ["img1 layout: S1 tilt must be between -45 and 45", /tilted more than 45 degrees/],
    ['img1 layout: M3 has role "other" and needs a note', /kind "other" had no description/],
    ["img1 layout: S1 capture 2 does not exist (1 captures)", /screenshot area the analysis/],
    ["img1 layout: the focal point must be inside the image (0-100)", /focal point was outside/],
    ["img1 layout: focus.words must be at most 80 characters", /a focus text was too long/],
    ["layout.inGame.0.box.x: Invalid input: expected number, received NaN", /inGame\.0\.box\.x/],
  ];
  for (const [problem, want] of each) {
    const r = explainFailure([problem], m).reason;
    assert.match(r, want, problem);
    assert.doesNotMatch(r, /malformed/, problem);
  }
});

test("soft checks: an analysis element without its own box, or with the wrong kind, is a note", () => {
  const core = reading("img1", "gameplay", "EPIC");
  const el = {
    position: "centre",
    pose: "",
    colours: "gold",
    region: { x: 35, y: 25, w: 30, h: 30 },
  };
  core.marketingLayer.elements = [
    { kind: "item", what: "enlarged highlighted monster card of Rub", ...el },
  ];
  const l = fakeLayout(core);
  const plain = readLayout(l, core);
  assert.ok(plain.layout, "saved");
  assert.deepEqual(plain.problems, []);
  assert.deepEqual(plain.notes, [
    "Note: the enlarged highlighted monster card of Rub isn't drawn as its own box.",
  ]);
  const base = l.marketing[0] as (typeof l.marketing)[0];
  l.marketing.push({ ...base, id: "M3", role: "badge", box: el.region, covers: [] });
  assert.deepEqual(readLayout(l, core).notes, [], "an item may be a badge");
  core.marketingLayer.elements = [{ kind: "character", what: "red-haired heroine", ...el }];
  const hero = readLayout(l, core);
  assert.ok(hero.layout, "saved");
  assert.deepEqual(hero.notes, [
    "Note: the red-haired heroine is drawn as a badge (M3), not as a character cut-out.",
  ]);
});
