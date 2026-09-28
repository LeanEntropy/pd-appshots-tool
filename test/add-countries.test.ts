import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPaths } from "../src/config/load.ts";
import { loadProject, readSettings } from "../src/config/project.ts";
import { storeRunning } from "../src/jobs/store-runner.ts";
import { countriesPlanProblem, readCountriesPlan } from "../src/steps/add-countries.ts";
import { latestRun } from "../src/view/model.ts";
import { downloadedProject, SHOTS } from "./helpers/competitors.ts";
import { OURS } from "./helpers/wizard.ts";

type Market = { gl: string; hl: string; label: string };
type Picker = {
  countries: Market[];
  addable: (Market & { region: string; language: string })[];
  notDownloaded: Market[];
  fixed: boolean;
};
type Preview = {
  gls: string[];
  planHash: string;
  countries: { gl: string; pages: number; found: number; images: number }[];
  images: number;
  inLibrary: number;
  toDownload: number;
  bytes: number;
  aiCalls: number;
  problem: string | null;
};

const u = (id: string) => `https://play-lh.googleusercontent.com/${id}`;

test("add countries: picker, saved to the project in their usual language, checked, downloaded (free)", async () => {
  SHOTS[OURS] = { ...SHOTS[OURS], kr: [u("o1"), u("k1")], hk: [u("o1")] };
  SHOTS["com.habby.capybara"] = { ...SHOTS["com.habby.capybara"], kr: [u("k2")] };
  const { w, id, store } = await downloadedProject();
  try {
    const api = (p: string) => `/p/${id}/api/project-countries${p}`;
    const pick = (await w.get(api(""))).json() as Picker;
    assert.equal(pick.fixed, false);
    assert.deepEqual(
      pick.countries.map((m) => m.gl),
      ["us", "jp"],
    );
    assert.ok(!pick.addable.some((c) => c.gl === "us" || c.gl === "jp"));
    const hk = pick.addable.find((c) => c.gl === "hk");
    assert.deepEqual([hk?.hl, hk?.language], ["zh-TW", "Traditional Chinese"]);
    assert.equal(pick.addable.find((c) => c.gl === "ph")?.hl, "en");
    assert.deepEqual(pick.notDownloaded, []);

    // Refused: no token, a country twice or unknown, one in the project already.
    assert.equal((await w.post(api("/add"), { gls: ["kr"] }, {})).status, 403);
    assert.equal((await w.post(api("/add"), { gls: ["xx"] })).status, 400);
    assert.match((await w.post(api("/add"), { gls: ["jp"] })).body.problems?.[0] ?? "", /already/);
    assert.equal((await w.post(api("/add"), { gls: [] })).status, 400);

    const add = await w.post(api("/add"), { gls: ["kr", "hk"] });
    assert.equal(add.status, 200);
    assert.match(
      String(add.body.message),
      /Added South Korea \(Korean\), Hong Kong \(Traditional Chinese\)/,
    );
    const saved = readSettings(w.storage, { projectId: id });
    assert.deepEqual(
      saved?.markets.map((m) => [m.gl, m.hl]),
      [
        ["us", "en"],
        ["jp", "en"],
        ["kr", "ko"],
        ["hk", "zh-TW"],
      ],
    );
    const after = (await w.get(api(""))).json() as Picker;
    assert.ok(!after.addable.some((c) => c.gl === "kr"));
    assert.deepEqual(
      after.notDownloaded.map((m) => m.gl),
      ["kr", "hk"],
    );

    // Their store pages only: no image, no AI.
    assert.equal((await w.get(api("/preview"))).status, 409);
    assert.equal((await w.post(api("/check"), { gls: ["fr"] })).status, 409);
    assert.equal((await w.post(api("/check"), { gls: ["kr", "hk"] })).status, 202);
    await storeRunning.get(id)?.done;
    assert.equal((await w.get(api("/job"))).json().job.state, "finished");
    assert.equal(store.fetched.length, 0);
    const p = (await w.get(api("/preview"))).json().preview as Preview;
    assert.deepEqual(
      p.countries.map((c) => [c.gl, c.pages, c.found, c.images]),
      [
        ["kr", 2, 2, 3],
        ["hk", 2, 1, 1],
      ],
    );
    assert.deepEqual([p.images, p.inLibrary, p.toDownload, p.aiCalls], [3, 1, 2, 0]);
    assert.ok(p.bytes > 0);
    assert.equal(p.problem, null);

    assert.equal((await w.post(api("/download"), { planHash: "0".repeat(64) })).status, 409);
    assert.equal((await w.post(api("/download"), { planHash: p.planHash })).status, 202);
    await storeRunning.get(id)?.done;
    assert.equal((await w.get(api("/job"))).json().job.state, "finished");
    assert.deepEqual(
      store.fetched.map((f) => f.replace(/.*\//, "")).sort(),
      ["k1=s0", "k2=s0"],
      "only images not in the shared library",
    );
    const loaded = loadProject(id, { root: w.root });
    const run = latestRun(projectPaths(loaded).runs);
    assert.ok(run?.decks.some((d) => d.gl === "kr" && d.appId === OURS));
    assert.ok(
      run?.decks.some((d) => d.gl === "us"),
      "the other decks are kept",
    );
    assert.deepEqual(((await w.get(api(""))).json() as Picker).notDownloaded, []);
    const replay = await w.post(api("/download"), { planHash: p.planHash });
    assert.match(replay.body.problems?.[0] ?? "", /downloaded already/);

    // A saved check goes stale when the project's countries change again.
    const plan = readCountriesPlan(loaded);
    assert.ok(plan);
    await w.post(api("/add"), { gls: ["th"] });
    const later = loadProject(id, { root: w.root });
    assert.match(countriesPlanProblem(later, plan) ?? "", /Check the store again/);
  } finally {
    w.server.close();
  }
});
