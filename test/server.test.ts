import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request } from "node:http";
import { test } from "node:test";
import { projectPaths } from "../src/config/load.ts";
import {
  getSelection,
  postAnalysisPlan,
  postAnalysisRun,
  postSelection,
} from "../src/server/api.ts";
import { startAppServer } from "../src/server/app-server.ts";
import { staticKey } from "../src/server/static.ts";
import { quickRun, settle } from "./helpers/jobs.ts";
import { tempProject } from "./helpers/project.ts";

const FIVE = {
  "Capybara Go": { phone: 2, tablet: 2 },
  "Mini Tales": { phone: 2, tablet: 0 },
  Heroll: { phone: 2, tablet: 0 },
  Dicero: { phone: 2, tablet: 0 },
  "Archero 2": { phone: 3, tablet: 3 },
};
const PICK = ["Archero 2", "Capybara Go", "Mini Tales", "Heroll", "Dicero"];

test("saving a pick writes the run config in order and returns the fit", async () => {
  const loaded = await tempProject(FIVE);
  const r = postSelection(loaded, {
    coreCompetitors: ["Archero 2", "com.habby.capybara", "Mini Tales", "Heroll", "Dicero"],
  });
  assert.equal(r.status, 200);
  const saved = JSON.parse(readFileSync(projectPaths(loaded).runConfig, "utf8"));
  assert.deepEqual(saved.coreCompetitors.slice(0, 2), ["com.xq.archeroii", "com.habby.capybara"]);
  assert.equal(saved.source, "page");
  const body = r.body as { total: number; wholeDeckTotal: number; ok: boolean };
  assert.equal(body.total, 3 + 3 + 2 + 2 + 2 + 2);
  assert.equal(body.wholeDeckTotal, body.total + 3 + 2);
  assert.equal(body.ok, true);
  const again = getSelection(loaded).body as { coreCompetitors: string[] };
  assert.deepEqual(again.coreCompetitors, saved.coreCompetitors);
});

test("bad selections are refused and nothing is written", async () => {
  const loaded = await tempProject(FIVE);
  assert.equal(postSelection(loaded, { coreCompetitors: ["Not A Game"] }).status, 400);
  assert.equal(postSelection(loaded, { coreCompetitors: ["Heroll", "Heroll"] }).status, 400);
  assert.equal(postSelection(loaded, { coreCompetitors: "Heroll" }).status, 400);
  assert.equal(postSelection(loaded, { coreCompetitors: [], extra: 1 }).status, 400);
  assert.throws(() => readFileSync(projectPaths(loaded).runConfig));
});

test("an analysis run starts only for the exact plan that was shown", async () => {
  const loaded = await tempProject(FIVE);
  postSelection(loaded, { coreCompetitors: PICK });
  const fake = "a".repeat(64);
  assert.equal(postAnalysisRun(loaded, { stage: "pilot", planHash: fake }, quickRun).status, 409);
  const shown = postAnalysisPlan(loaded, { stage: "pilot" }).body as {
    plan: { planHash: string; counts: { full: number }; excluded: unknown[] };
  };
  assert.equal(shown.plan.counts.full, 3 + 3 + 2);
  assert.equal(shown.plan.excluded.length, 3 + 2);
  const hash = shown.plan.planHash;
  assert.equal(postAnalysisRun(loaded, { stage: "pilot", planHash: fake }, quickRun).status, 409);
  postSelection(loaded, {
    coreCompetitors: ["Mini Tales", ...PICK.filter((x) => x !== "Mini Tales")],
  });
  assert.equal(postAnalysisRun(loaded, { stage: "pilot", planHash: hash }, quickRun).status, 409);
  postSelection(loaded, { coreCompetitors: PICK });
  const ok = postAnalysisRun(loaded, { stage: "pilot", planHash: hash }, quickRun);
  assert.equal(ok.status, 202);
  await settle(loaded);
  assert.equal(postAnalysisRun(loaded, { stage: "pilot" }, quickRun).status, 400);
});

test("the plan and run endpoints refuse a pick that fails the fit rule", async () => {
  const loaded = await tempProject({ Heroll: { phone: 2, tablet: 0 } });
  postSelection(loaded, { coreCompetitors: ["Heroll"] });
  const r = postAnalysisPlan(loaded, { stage: "pilot" });
  assert.equal(r.status, 409);
  assert.match(JSON.stringify(r.body), /Pick at least 2 competitors/);
  const core = postAnalysisPlan(loaded, { stage: "core" });
  assert.match(JSON.stringify(core.body), /Pick at least 5 competitors/);
  const run = postAnalysisRun(loaded, { stage: "pilot", planHash: "b".repeat(64) }, quickRun);
  assert.equal(run.status, 409);
});

test("static files are limited to data files in the image, view, own and icon folders", async () => {
  const loaded = await tempProject({});
  const paths = projectPaths(loaded);
  assert.equal(staticKey(paths, "/images/db.json"), `projects/${paths.projectId}/images/db.json`);
  assert.equal(staticKey(paths, "/run-config.json"), null);
  assert.equal(staticKey(paths, "/images/../run-config.json"), null);
  assert.equal(staticKey(paths, "/images/%2e%2e/%2e%2e/configs/t.json"), null);
  assert.equal(staticKey(paths, "/views/gallery.html"), null);
});

function rawGet(origin: string, path: string, host: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const u = new URL(`${origin}${path}`);
    request(
      { host: u.hostname, port: u.port, path: u.pathname, headers: { Host: host } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    ).end();
  });
}

test("one server serves each project under /p/<id>/ with its API base, and guards writes", async () => {
  const loaded = await tempProject(FIVE);
  const id = projectPaths(loaded).projectId;
  const { server, origin, app } = await startAppServer({
    root: loaded.root,
    projects: [loaded],
    token: "test-token",
  });
  try {
    const page = await fetch(`${origin}/p/${id}/views/gallery.html`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Comparison grid/);
    assert.match(html, /name="ssr-token" content="test-token"/);
    assert.ok(html.includes(`"apiBase":"/p/${id}/api"`));
    assert.match(html, /All projects/);
    const json = { "Content-Type": "application/json", "X-SSR-Token": "test-token" };
    const body = JSON.stringify({ coreCompetitors: ["Heroll"] });
    const sel = `${origin}/p/${id}/api/selection`;
    assert.equal((await fetch(sel, { method: "POST", headers: json, body })).status, 200);
    const noToken = { "Content-Type": "application/json" };
    assert.equal((await fetch(sel, { method: "POST", headers: noToken, body })).status, 403);
    const evil = { ...json, Origin: "https://evil.example" };
    assert.equal((await fetch(sel, { method: "POST", headers: evil, body })).status, 403);
    const text = { "Content-Type": "text/plain", "X-SSR-Token": "test-token" };
    assert.equal((await fetch(sel, { method: "POST", headers: text, body: "{}" })).status, 415);
    assert.equal((await fetch(`${origin}/p/${id}/views/decks/x.html`)).status, 404);
    assert.equal((await fetch(`${origin}/p/nope/api/selection`)).status, 404);
    assert.equal((await fetch(`${origin}/p/..%2F..%2Fconfigs/api/state`)).status, 404);
    assert.equal(await rawGet(origin, `/p/${id}/api/selection`, "evil.example"), 403);
    // Old unprefixed paths: reads go to the latest project, writes are refused.
    const old = await fetch(`${origin}/api/selection`, { redirect: "manual" });
    assert.equal(old.status, 302);
    assert.equal(old.headers.get("location"), `/p/${id}/api/selection`);
    const oldPost = await fetch(`${origin}/api/selection`, { method: "POST", headers: json, body });
    assert.equal(oldPost.status, 410);
    const health = (await (await fetch(`${origin}/api/health`)).json()) as { nonce: string };
    assert.equal(health.nonce, app.nonce);
    const home = await (await fetch(`${origin}/`)).text();
    assert.match(home, /Your projects/);
    assert.match(home, /\+ New project/);
    assert.match(await (await fetch(`${origin}/new`)).text(), /wizardStart\(\)/);
    const land = await fetch(`${origin}/p/${id}/`, { redirect: "manual" });
    assert.equal(land.status, 302);
    assert.match(land.headers.get("location") ?? "", new RegExp(`^/p/${id}/views/gallery.html#`));
    const state = (await (await fetch(`${origin}/p/${id}/api/state`)).json()) as { stage: string };
    assert.equal(state.stage, "pick");
  } finally {
    server.close();
  }
});
