import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPaths } from "../src/config/load.ts";
import { settingsKey } from "../src/config/project.ts";
import { readRegistry, upsertEntry } from "../src/config/registry.ts";
import { draftState, projectState } from "../src/projects/state.ts";
import { startAppServer } from "../src/server/app-server.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { HOME_SCRIPT } from "../src/view/home-script.ts";
import { legacyProject } from "./helpers/imported.ts";
import { tempProject } from "./helpers/project.ts";

const TOKEN = "home-token";
const json = { "Content-Type": "application/json", "X-SSR-Token": TOKEN };

async function waitFor<T>(get: () => Promise<T>, done: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = await get();
    if (done(v)) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out");
}

test("the home offers the import, runs it only on request, then lists the project with its state", async () => {
  const { loaded, root } = await legacyProject();
  const id = projectPaths(loaded).projectId;
  const { server, origin } = await startAppServer({ root, token: TOKEN });
  try {
    const get = async () =>
      (await (await fetch(`${origin}/api/import`)).json()) as {
        found: { id: string; images: number; analyses: number }[];
        importing: { state: string; text: string } | null;
      };
    const offer = await get();
    assert.equal(offer.found[0]?.id, id);
    assert.ok((offer.found[0]?.images ?? 0) > 0);
    assert.equal(offer.found[0]?.analyses, 9);
    const storage = workspaceStorage(projectPaths(loaded).workspace);
    assert.equal(storage.exists(settingsKey({ projectId: id })), false, "nothing on start");
    const dry = await fetch(`${origin}/api/import`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ id, dryRun: true }),
    });
    assert.match(((await dry.json()) as { text: string }).text, /DRY RUN/);
    assert.equal(storage.exists(settingsKey({ projectId: id })), false, "a dry run writes nothing");
    const go = await fetch(`${origin}/api/import`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ id }),
    });
    assert.equal(go.status, 202);
    const end = await waitFor(get, (v) => v.importing?.state !== "running");
    assert.equal(end.importing?.state, "done", end.importing?.text);
    assert.deepEqual(end.found, []);

    const list = (await (await fetch(`${origin}/api/projects`)).json()) as {
      projects: { id: string; competitors: number; countries: number }[];
    };
    assert.equal(list.projects[0]?.id, id);
    assert.ok((list.projects[0]?.competitors ?? 0) > 0);
    const state = (await (await fetch(`${origin}/p/${id}/api/state`)).json()) as {
      stage: string;
      line: string;
      steps: { label: string; state: string }[];
    };
    // The fake pilot wrote no recommendations: its images are done, its report is not.
    assert.equal(state.stage, "pilot", state.line);
    assert.equal(state.line, "Pilot ready: all images analysed, the report is still to write");
    assert.deepEqual(
      state.steps.map((s) => s.state),
      ["done", "done", "done", "current", "todo", "todo"],
    );
    assert.equal(readRegistry(storage).projects[0]?.summary?.stage, "pilot", "summary cached");
    const land = await fetch(`${origin}/p/${id}/`, { redirect: "manual" });
    assert.equal(land.headers.get("location"), `/p/${id}/views/gallery.html#analysis`);
    const page = await (await fetch(`${origin}/p/${id}/views/gallery.html`)).text();
    assert.match(page, /class="steps"/);
    const img = page.match(/"thumb":"(thumb\/[0-9a-f]{64}\.webp)"/)?.[1];
    assert.ok(img);
    const served = await fetch(`${origin}/p/${id}/images/${img}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/webp");

    const arch = await fetch(`${origin}/p/${id}/api/archive`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ archived: true }),
    });
    assert.equal(arch.status, 200);
    assert.equal(readRegistry(storage).projects[0]?.archived, true);
  } finally {
    server.close();
  }
});

test("a draft project opens on its status page and refuses analysis", async () => {
  const loaded = await tempProject({});
  const storage = workspaceStorage(projectPaths(loaded).workspace);
  const now = new Date().toISOString();
  storage.putJson(settingsKey({ projectId: "draft-game" }), {
    schemaVersion: 1,
    id: "draft-game",
    name: "Draft Game",
    createdAt: now,
    updatedAt: now,
    ourApp: { id: "com.example.draft", name: "Draft Game" },
    competitors: [],
    markets: [{ gl: "us", hl: "en", label: "United States (English)" }],
    charts: { enabled: false, collection: "GROSSING", depth: 10 },
    category: "auto",
  });
  upsertEntry(storage, {
    id: "draft-game",
    name: "Draft Game",
    ourAppId: "com.example.draft",
    createdAt: now,
    lastOpenedAt: now,
    archived: false,
  });
  const { server, origin } = await startAppServer({ root: loaded.root, token: TOKEN });
  try {
    const s = (await (await fetch(`${origin}/p/draft-game/api/state`)).json()) as { stage: string };
    assert.equal(s.stage, "setup");
    assert.match(
      await (await fetch(`${origin}/p/draft-game/`)).text(),
      /add at least one competitor/,
    );
    const plan = await fetch(`${origin}/p/draft-game/api/analysis/plan`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ stage: "pilot" }),
    });
    assert.equal(plan.status, 409);
  } finally {
    server.close();
  }
  assert.equal(draftState("x").steps[0]?.state, "current");
});

test("state: nothing downloaded, pick, pilot ready", async () => {
  const one = await tempProject({ Heroll: { phone: 2, tablet: 0 } });
  assert.equal(projectState(one).stage, "pick");
  const five = await tempProject({
    "Archero 2": { phone: 2, tablet: 0 },
    "Capybara Go": { phone: 2, tablet: 0 },
  });
  const s = projectState(five);
  assert.equal(s.stage, "pilot");
  assert.equal(s.substate, "ready");
  assert.equal(s.line, "Pilot ready: 7 images to analyse");
  assert.deepEqual(s.progress, { done: 0, total: 7, label: "0 of 7 pilot images analysed" });
  assert.equal(s.next.href, `/p/${projectPaths(five).projectId}/views/gallery.html#analysis`);
});

test("the home page script parses", () => {
  assert.doesNotThrow(() => new Function(HOME_SCRIPT));
});
