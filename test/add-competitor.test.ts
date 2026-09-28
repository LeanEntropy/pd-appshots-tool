import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPaths, readRunConfig } from "../src/config/load.ts";
import { loadProject } from "../src/config/project.ts";
import { storeRunning } from "../src/jobs/store-runner.ts";
import { gamePlanProblem, readGamePlan } from "../src/steps/add-competitor.ts";
import { LOCKS, tryAcquire } from "../src/storage/leases.ts";
import { latestRun } from "../src/view/model.ts";
import { downloadedProject } from "./helpers/competitors.ts";
import { OURS } from "./helpers/wizard.ts";

type Row = { id: string; downloaded: boolean; inPick: boolean; reference?: { gl: string } };
type Preview = {
  planHash: string;
  images: number;
  inLibrary: number;
  toDownload: number;
  aiCalls: number;
  notInCore: string | null;
  problem: string | null;
  countries: { gl: string; status: string; images: number }[];
};

/** Waits for the project's store job in this process. */
async function settle(id: string) {
  await storeRunning.get(id)?.done;
}

test("add a competitor from the Competitors tab: checks, preview, download only what is new", async () => {
  const { w, id, store } = await downloadedProject();
  try {
    const api = (p: string) => `/p/${id}/api/competitors${p}`;
    const add = (body: unknown) => w.post(api("/add"), body);
    assert.equal(
      (await w.post(api("/add"), { id: "com.dxx.firenow", tier: "direct" }, {})).status,
      403,
    );
    assert.match(
      (await add({ id: OURS, tier: "direct" })).body.problems?.[0] ?? "",
      /your own game/,
    );
    const dup = await add({ id: "com.habby.capybara", tier: "direct" });
    assert.match(dup.body.problems?.[0] ?? "", /in your list already/);
    assert.equal((await add({ id: "com.not.there", tier: "direct" })).status, 404);
    assert.equal((await add({ id: "com.dxx.firenow", tier: "nearby" })).status, 400);

    const ok = await add({ id: "com.dxx.firenow", tier: "reference" });
    assert.equal(ok.status, 200);
    assert.match(String(ok.body.message), /Survivor\.io added.*not in your core pick/);
    const jp = await add({ id: "com.jp.only", tier: "same_audience" });
    assert.match(
      (jp.body.warnings as string[])[0] ?? "",
      /Not on Google Play in the United States/,
    );

    // The pick is unchanged: the new games are not ticked for the core check.
    const loaded = loadProject(id, { root: w.root });
    assert.deepEqual(readRunConfig(projectPaths(loaded))?.coreCompetitors, ["com.habby.capybara"]);
    const list = (await w.get(api(""))).json().competitors as Row[];
    assert.deepEqual(
      list.map((c) => [c.id, c.downloaded, c.inPick]),
      [
        ["com.habby.capybara", true, true],
        ["com.dxx.firenow", false, false],
        ["com.jp.only", false, false],
      ],
    );
    assert.equal(list[2]?.reference?.gl, "jp");

    // Store check of the new game only: no images, no AI.
    assert.equal((await w.get(api("/preview?id=com.dxx.firenow"))).status, 409);
    const check = await w.post(api("/check"), { id: "com.dxx.firenow" });
    assert.equal(check.status, 202);
    await settle(id);
    const job = (await w.get(api("/job"))).json().job;
    assert.equal(job.state, "finished");
    assert.equal(job.kind, "store-check");
    assert.equal(store.fetched.length, 0, "a store check downloads no image");
    const p = (await w.get(api("/preview?id=com.dxx.firenow"))).json().preview as Preview;
    assert.deepEqual(
      p.countries.map((c) => [c.gl, c.status, c.images]),
      [
        ["us", "ok", 2],
        ["jp", "ok", 1],
      ],
    );
    assert.equal(p.images, 3);
    assert.equal(p.inLibrary, 1, "the picture Capybara Go shares is in the library already");
    assert.equal(p.toDownload, 2);
    assert.equal(p.aiCalls, 0);
    assert.equal(p.problem, null);

    const wrong = await w.post(api("/download"), {
      id: "com.dxx.firenow",
      planHash: "0".repeat(64),
    });
    assert.equal(wrong.status, 409);
    const dl = await w.post(api("/download"), { id: "com.dxx.firenow", planHash: p.planHash });
    assert.equal(dl.status, 202);
    await settle(id);
    assert.equal((await w.get(api("/job"))).json().job.state, "finished");
    assert.deepEqual(
      store.fetched.map((f) => f.replace(/.*\//, "")).sort(),
      ["f1=s0", "f2=s0"],
      "only the new images are downloaded",
    );

    // The latest run keeps every deck and adds the new game's; the page shows it, unticked.
    const run = latestRun(projectPaths(loaded).runs);
    assert.deepEqual(run?.added?.sort(), ["com.dxx.firenow|jp|en", "com.dxx.firenow|us|en"]);
    assert.equal(run?.decks.length, 6);
    const page = (await w.get(`/p/${id}/views/gallery.html`)).text;
    assert.match(page, /id="addComp"/);
    const data = JSON.parse(/id="data">(.*?)<\/script>/s.exec(page)?.[1] ?? "{}");
    assert.deepEqual(
      data.named.map((a: { appId: string }) => a.appId),
      ["com.habby.capybara", "com.dxx.firenow"],
    );
    assert.deepEqual(data.selection, ["com.habby.capybara"]);
    const after = (await w.get(api(""))).json().competitors as Row[];
    assert.equal(after.find((c) => c.id === "com.dxx.firenow")?.downloaded, true);

    // A game not in the United States: the preview says it is left out of the core check.
    await w.post(api("/check"), { id: "com.jp.only" });
    await settle(id);
    const jpPreview = (await w.get(api("/preview?id=com.jp.only"))).json().preview as Preview;
    assert.match(jpPreview.notInCore ?? "", /not on Google Play in United States/);
  } finally {
    w.server.close();
  }
});

test("a saved game preview is refused once the game or countries changed", async () => {
  const { w, id } = await downloadedProject();
  try {
    await w.post(`/p/${id}/api/competitors/add`, { id: "com.dxx.firenow", tier: "direct" });
    await w.post(`/p/${id}/api/competitors/check`, { id: "com.dxx.firenow" });
    await settle(id);
    const loaded = loadProject(id, { root: w.root });
    const plan = readGamePlan(loaded, "com.dxx.firenow");
    assert.ok(plan);
    assert.equal(gamePlanProblem(loaded, plan, "com.dxx.firenow"), null);
    const edited = { ...plan, configHash: "x".repeat(64) };
    assert.match(gamePlanProblem(loaded, edited, "com.dxx.firenow") ?? "", /Check the store again/);
    const old = { ...plan, createdAt: "2020-01-01T00:00:00.000Z" };
    assert.match(gamePlanProblem(loaded, old, "com.dxx.firenow") ?? "", /hours old/);
  } finally {
    w.server.close();
  }
});

test("remove a competitor: out of the list and the pick, nothing deleted; store lane shared", async () => {
  const { w, id } = await downloadedProject();
  try {
    const api = (p: string) => `/p/${id}/api/competitors${p}`;
    const last = await w.post(api("/remove"), { id: "com.habby.capybara" });
    assert.match(last.body.problems?.[0] ?? "", /at least one competitor/);
    await w.post(api("/add"), { id: "com.dxx.firenow", tier: "direct" });

    // Another project holds the store lane: the check waits for it, in plain words.
    const held = tryAcquire(w.storage, LOCKS.store, { projectId: "other", kind: "download" });
    assert.ok(!("heldBy" in held));
    const busy = await w.post(api("/check"), { id: "com.dxx.firenow" });
    assert.equal(busy.status, 409);
    assert.match(busy.body.problems?.[0] ?? "", /other is downloading now/);
    held.release();

    const gone = await w.post(api("/remove"), { id: "com.habby.capybara" });
    assert.equal(gone.status, 200);
    assert.equal(gone.body.wasInPick, true);
    assert.match(String(gone.body.message), /and from your core pick.*stay in the shared library/);
    const loaded = loadProject(id, { root: w.root });
    assert.deepEqual(readRunConfig(projectPaths(loaded))?.coreCompetitors, []);
    assert.equal(latestRun(projectPaths(loaded).runs)?.decks.length, 4, "no deck is deleted");
    const page = (await w.get(`/p/${id}/views/gallery.html`)).text;
    const data = JSON.parse(/id="data">(.*?)<\/script>/s.exec(page)?.[1] ?? "{}");
    assert.deepEqual(data.named, [], "a removed competitor is hidden");
    const again = await w.post(api("/remove"), { id: "com.habby.capybara" });
    assert.equal(again.status, 409);
  } finally {
    w.server.close();
  }
});
