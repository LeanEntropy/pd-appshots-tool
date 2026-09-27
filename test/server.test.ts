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
import { startGalleryServer, staticFile } from "../src/server/gallery-server.ts";
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
  const started: string[] = [];
  const starter = async (_l: unknown, _s: unknown, hash: string) => {
    started.push(hash);
  };
  const fake = "a".repeat(64);
  assert.equal(postAnalysisRun(loaded, { stage: "pilot", planHash: fake }, starter).status, 409);
  const shown = postAnalysisPlan(loaded, { stage: "pilot" }).body as {
    plan: { planHash: string; counts: { full: number }; excluded: unknown[] };
  };
  assert.equal(shown.plan.counts.full, 3 + 3 + 2);
  assert.equal(shown.plan.excluded.length, 3 + 2);
  const hash = shown.plan.planHash;
  assert.equal(postAnalysisRun(loaded, { stage: "pilot", planHash: fake }, starter).status, 409);
  postSelection(loaded, {
    coreCompetitors: ["Mini Tales", ...PICK.filter((x) => x !== "Mini Tales")],
  });
  assert.equal(postAnalysisRun(loaded, { stage: "pilot", planHash: hash }, starter).status, 409);
  postSelection(loaded, { coreCompetitors: PICK });
  assert.equal(postAnalysisRun(loaded, { stage: "pilot", planHash: hash }, starter).status, 202);
  assert.deepEqual(started, [hash]);
  assert.equal(postAnalysisRun(loaded, { stage: "pilot" }, starter).status, 400);
});

test("static files are limited to the image, view and own folders", async () => {
  const loaded = await tempProject({});
  const base = projectPaths(loaded).base;
  assert.ok(staticFile(base, "/images/db.json"));
  assert.equal(staticFile(base, "/run-config.json"), null);
  assert.equal(staticFile(base, "/images/../run-config.json"), null);
  assert.equal(staticFile(base, "/images/%2e%2e/%2e%2e/configs/t.json"), null);
});

test("the server saves over HTTP and refuses other hosts and non-JSON posts", async () => {
  const loaded = await tempProject(FIVE);
  const { server, url } = await startGalleryServer(loaded, 0, "test-token");
  try {
    const origin = new URL(url).origin;
    const page = await fetch(url);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Comparison grid/);
    assert.match(html, /name="ssr-token" content="test-token"/);
    const json = { "Content-Type": "application/json", "X-SSR-Token": "test-token" };
    const body = JSON.stringify({ coreCompetitors: ["Heroll"] });
    const sel = `${origin}/api/selection`;
    const ok = await fetch(sel, { method: "POST", headers: json, body });
    assert.equal(ok.status, 200);
    const noToken = await fetch(sel, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.equal(noToken.status, 403);
    const otherSite = await fetch(sel, {
      method: "POST",
      headers: { ...json, Origin: "https://evil.example" },
      body,
    });
    assert.equal(otherSite.status, 403);
    const text = await fetch(sel, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "X-SSR-Token": "test-token" },
      body: "{}",
    });
    assert.equal(text.status, 415);
    const otherPage = await fetch(`${origin}/views/decks/x.html`);
    assert.equal(otherPage.status, 404);
    const status = await new Promise<number | undefined>((resolve) => {
      const u = new URL(`${origin}/api/selection`);
      request(
        { host: u.hostname, port: u.port, path: u.pathname, headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      ).end();
    });
    assert.equal(status, 403);
  } finally {
    server.close();
  }
});
