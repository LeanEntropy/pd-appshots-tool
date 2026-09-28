import assert from "node:assert/strict";
import { test } from "node:test";
import { saveExpansion } from "../src/analysis/expansion.ts";
import { projectPaths } from "../src/config/load.ts";
import { draftsFromExpansion } from "../src/reports/drafts.ts";
import { listReports } from "../src/reports/list.ts";
import { buildScopePlan } from "../src/reports/scope-plan.ts";
import { listDefs, readDef, runFolders } from "../src/reports/store.ts";
import { startAppServer } from "../src/server/app-server.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import {
  addDeck,
  analyse,
  builderProject,
  headers,
  idsOf,
  picture,
  readyReport,
  TOKEN,
} from "./helpers/builder.ts";

const US = { gl: "us", hl: "en" };
const JP = { gl: "jp", hl: "ja" };

test("builder API: options, drafts, plans, instant build and refusals", async () => {
  const loaded = await builderProject();
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const three = idsOf(loaded, ["Capybara Go", "Mini Tales", "Heroll"]);
  analyse(loaded, [loaded.config.ourApp.name, "Capybara Go", "Mini Tales", "Heroll"]);
  await addDeck(loaded, "Capybara Go", "jp", "ja", [await picture(600)]);
  const { server, origin } = await startAppServer({
    root: loaded.root,
    projects: [loaded],
    token: TOKEN,
  });
  const api = `${origin}/p/${paths.projectId}/api`;
  const post = (path: string, body: unknown, method = "POST") =>
    fetch(`${api}${path}`, { method, headers, body: JSON.stringify(body) });
  try {
    const scope = { type: "country", markets: [US], competitors: three, includeCharts: [] };
    // Before a Ready Pilot, only the Pilot is open: the API refuses the others.
    const early = await post("/reports", { scope });
    assert.equal(early.status, 409);
    assert.match(JSON.stringify(await early.json()), /Available after the Pilot/);
    assert.equal((await post("/reports/plan", { scope })).status, 409);
    readyReport(loaded, "pilot");
    const opts = await (await fetch(`${api}/reports/builder`)).json();
    assert.equal(opts.types.country.open, true);
    assert.match(opts.warning, /Highly recommended/);
    assert.equal(
      opts.competitors.find((c: { name: string }) => c.name === "Capybara Go").sold.jp,
      "ok",
    );
    // Bad scopes and unknown values are refused with a plain reason.
    assert.equal(
      (await post("/reports", { scope: { ...scope, markets: [{ gl: "zz", hl: "x" }] } })).status,
      400,
    );
    assert.equal(
      (await post("/reports", { scope: { ...scope, competitors: ["com.nope"] } })).status,
      400,
    );
    const badOut = { ...scope, leftOut: [{ appId: three[0], gl: "jp" }] };
    assert.equal(
      (await post("/reports", { scope: badOut })).status,
      400,
      "left out: not a picked country",
    );
    const oursOut = { ...scope, leftOut: [{ appId: loaded.config.ourApp.id, gl: "us" }] };
    assert.equal(
      (await post("/reports", { scope: oursOut })).status,
      400,
      "our game is never left out",
    );
    // An unfinished choice is saved as a draft too; it has no numbers until it is complete.
    const partial = await post("/reports", { scope: { ...scope, type: "compare" } });
    assert.equal(partial.status, 201);
    const pid = (await partial.json()).id;
    assert.equal((await (await fetch(`${api}/reports/${pid}/plan`)).json()).plan, null);
    assert.equal((await post(`/reports/${pid}/build`, {})).status, 409);
    assert.equal(
      (await post("/reports/plan", { scope: { ...scope, type: "compare" } })).status,
      400,
    );
    await post(`/reports/${pid}`, {}, "DELETE");
    assert.equal(await post("/reports", { scope }, "POST").then((r) => r.status), 201);
    const draft = listDefs(s, paths).find((d) => d.type === "country");
    assert.ok(draft);
    assert.equal(draft.name, "United States with 3 competitors");
    const list = await (await fetch(`${api}/reports`)).json();
    const card = list.reports.find((r: { id: string }) => r.id === draft.id);
    assert.equal(card.status.kind, "draft");
    assert.equal(card.status.text, "Draft: ready to build, free");
    // Plan: code only, the same numbers as the planner.
    const plan = await (await fetch(`${api}/reports/${draft.id}/plan`)).json();
    assert.equal(plan.plan.instant, true);
    assert.equal(plan.plan.planHash, buildScopePlan(loaded, draft.scope).planHash);
    // Build: a new immutable version at once, with the research list saved with it.
    const built = await post(`/reports/${draft.id}/build`, {});
    assert.equal(built.status, 200);
    const { versionId } = await built.json();
    const files = runFolders(s, paths).get(versionId);
    for (const f of ["report-data.json", "report.md", "version.json", "suggestions.json"])
      assert.ok(files?.has(f), f);
    const v = await (await fetch(`${api}/reports/${draft.id}/versions/${versionId}`)).json();
    assert.ok(v.data.games.length === 4);
    assert.match(v.data.synthesis.reason, /Built on the Pilot only/);
    assert.ok(Array.isArray(v.research.items));
    // Autosave of a new scope (and name) for a report of the builder.
    const jpScope = { type: "country", markets: [JP], competitors: three, includeCharts: [] };
    const saved = await post(
      `/reports/${draft.id}`,
      { scope: jpScope, name: "Japan only" },
      "PATCH",
    );
    assert.equal(saved.status, 200);
    assert.equal(readDef(s, paths, draft.id)?.name, "Japan only");
    assert.equal(readDef(s, paths, draft.id)?.scope.markets[0]?.gl, "jp");
    // A report that needs new analyses is not built: the refusal says what and how much.
    const refused = await post(`/reports/${draft.id}/build`, {});
    assert.equal(refused.status, 409);
    assert.match(
      JSON.stringify(await refused.json()),
      /needs 1 new image analysed first .*Nothing was sent/,
    );
    // Writes need the page's token; unknown reports are 404.
    const noToken = await fetch(`${api}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    });
    assert.equal(noToken.status, 403);
    assert.equal((await fetch(`${api}/reports/r-nope-1/plan`)).status, 404);
    assert.equal((await post("/reports/r-nope-1/build", {})).status, 404);
    // The Pilot and Full check are presets: never created from the builder.
    assert.equal((await post("/reports", { scope: { ...scope, type: "pilot" } })).status, 400);
  } finally {
    server.close();
  }
});

test("saved expansion choices become draft reports once", async () => {
  const loaded = await builderProject();
  const slime = idsOf(loaded, ["Legend of Slime"])[0] as string;
  await addDeck(loaded, "Capybara Go", "jp", "ja", [await picture(610)]);
  await addDeck(loaded, "Capybara Go", "kr", "ko", [await picture(611)]);
  const r = saveExpansion(loaded, { competitors: [slime], countries: ["jp", "kr"] });
  assert.ok(!("problem" in r));
  const made = draftsFromExpansion(loaded);
  assert.deepEqual(made.map((d) => d.type).sort(), ["compare", "country"]);
  const compare = made.find((d) => d.type === "compare");
  assert.deepEqual(
    compare?.scope.markets.map((m) => m.gl),
    ["jp", "kr"],
  );
  assert.equal(compare?.scope.competitors.length, 5);
  const more = made.find((d) => d.type === "country");
  assert.equal(more?.scope.markets[0]?.gl, "us");
  assert.ok(more?.scope.competitors.includes(slime));
  assert.deepEqual(draftsFromExpansion(loaded), [], "only once");
  const drafts = listReports(loaded).filter((x) => x.status.kind === "draft");
  assert.equal(drafts.length, 2);
});
