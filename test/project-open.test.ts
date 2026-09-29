import assert from "node:assert/strict";
import { mkdtempSync, utimesSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type AnalysisRecord, readRecords, writeRecord } from "../src/analysis/records.ts";
import { projectPaths } from "../src/config/load.ts";
import { startAppServer } from "../src/server/app-server.ts";
import { Computed } from "../src/server/computed.ts";
import { viewModel } from "../src/steps/deck-view.ts";
import { dataStamp, flushDataChanges, markerPath } from "../src/storage/changes.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { tempProject } from "./helpers/project.ts";

// Opening a project: the page goes out at once, the heavy parts are computed once per data
// change and shared by every request that needs them.

const FIVE = {
  "Capybara Go": { phone: 2, tablet: 0 },
  "Mini Tales": { phone: 2, tablet: 0 },
  Heroll: { phone: 2, tablet: 0 },
  Dicero: { phone: 2, tablet: 0 },
  "Archero 2": { phone: 2, tablet: 0 },
};

test("computed: requests that ask at the same time share one computation", async () => {
  const c = new Computed(() => "s1");
  let runs = 0;
  const work = () => {
    runs++;
    return { n: runs };
  };
  const [a, b, d] = await Promise.all([
    c.get("ws", "p:reports", work),
    c.get("ws", "p:reports", work),
    c.get("ws", "p:reports", work),
  ]);
  assert.equal(runs, 1, "computed more than once");
  assert.equal(a, b);
  assert.equal(b, d);
  assert.deepEqual(await c.get("ws", "p:reports", work), { n: 1 }, "not kept for the same data");
  assert.equal(runs, 1);
});

test("computed: a data change, the time limit and a failure each mean a fresh computation", async () => {
  let stamp = "s1";
  let now = 0;
  const c = new Computed(
    () => stamp,
    1000,
    () => now,
  );
  let runs = 0;
  const work = () => ++runs;
  assert.equal(await c.get("ws", "k", work), 1);
  assert.equal(c.peek("ws", "k"), 1);
  stamp = "s2";
  assert.equal(c.peek("ws", "k"), undefined, "an old value was offered after a data change");
  assert.equal(await c.get("ws", "k", work), 2);
  now = 1000;
  assert.equal(await c.get("ws", "k", work), 3, "kept past its time limit");
  const boom = () => {
    throw new Error("unreadable");
  };
  now = 5000;
  await assert.rejects(c.get("ws", "k", boom), /unreadable/);
  assert.equal(await c.get("ws", "k", work), 4, "a failure was kept");
  // Nothing starts before the asking request has had its turn.
  let started = false;
  stamp = "s3";
  const p = c.get("ws", "k", () => {
    started = true;
    return 0;
  });
  assert.equal(started, false);
  await p;
  assert.equal(started, true);
});

test("data stamp: data writes change it, the project registry does not", () => {
  const ws = mkdtempSync(join(tmpdir(), "ssr-stamp-"));
  const s = workspaceStorage(ws);
  const a = dataStamp(ws);
  s.putJson("projects/p1/project.json", { x: 1 });
  const b = dataStamp(ws);
  assert.notEqual(a, b);
  s.putJson("registry/projects.json", { version: 1, projects: [] });
  assert.equal(dataStamp(ws), b, "opening a project (a registry write) dropped the cached data");
  // The same-screen check's many small results count once, when it ends.
  s.putJsonOnce("library/same-screen/aa/bb.v1.json", { same: false });
  assert.equal(dataStamp(ws), b);
  flushDataChanges();
  const c = dataStamp(ws);
  assert.notEqual(c, b);
  // Another process (a terminal command) wrote: it touched the marker.
  const later = new Date(Date.now() + 60_000);
  utimesSync(markerPath(ws), later, later);
  assert.notEqual(dataStamp(ws), c, "a write by another process was not seen");
});

test("analysis records: read once per data change, and a new record is seen at once", async () => {
  const loaded = await tempProject(FIVE);
  const paths = projectPaths(loaded);
  const before = readRecords(paths);
  const record = {
    imageId: "img-new",
    status: "failed",
    updatedAt: "2026-09-29T00:00:00.000Z",
  } as unknown as AnalysisRecord;
  // A copy is handed out: changing it does not change what the next reader gets.
  const first = readRecords(paths);
  first.set("x", record);
  assert.equal(readRecords(paths).has("x"), false);
  writeRecord(paths, record);
  const after = readRecords(paths);
  assert.equal(after.size, before.size + 1, "the cached records were used after a write");
  assert.equal(after.get("img-new")?.status, "failed");
});

/** The page's bytes as they arrive: up to its loading line (or the end), then the whole page. */
function stream(url: string): Promise<{ first: Promise<string>; all: Promise<string> }> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let text = "";
      let gotFirst: (s: string) => void = () => {};
      const first = new Promise<string>((r) => {
        gotFirst = r;
      });
      const all = new Promise<string>((r) => {
        res.on("data", (c: Buffer) => {
          text += c.toString("utf8");
          if (text.includes('id="boot"')) gotFirst(text);
        });
        res.on("end", () => {
          gotFirst(text);
          r(text);
        });
      });
      resolve({ first, all });
    }).on("error", reject);
  });
}

test("project page: the top goes out before the view is ready; the view is computed once", async () => {
  const loaded = await tempProject(FIVE);
  const { server, app, origin } = await startAppServer({
    root: loaded.root,
    projects: [loaded],
    token: "tok",
  });
  try {
    const id = projectPaths(loaded).projectId;
    const ws = projectPaths(loaded).workspace;
    // The view model is held back: the page must not wait for it before sending its top.
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    let computed = 0;
    void app.computed.get(ws, `${id}:view`, async () => {
      computed++;
      await held;
      return viewModel(loaded);
    });
    const page = await stream(`${origin}/p/${id}/views/gallery.html`);
    const top = await page.first;
    assert.match(top, /Loading the project/);
    assert.match(top, /class="steps/, "the step bar is not in the first part");
    assert.doesNotMatch(top, /id="data"/, "the page waited for the view model");
    // A second visit meanwhile shares the same computation.
    const again = await stream(`${origin}/p/${id}/views/gallery.html`);
    release();
    const [html, html2] = await Promise.all([page.all, again.all]);
    assert.equal(computed, 1, "the view model was computed twice");
    for (const h of [html, html2]) {
      assert.match(h, /document\.getElementById\("boot"\)\.remove\(\)/);
      assert.match(h, /<script type="application\/json" id="data">/);
      assert.match(h, /<\/html>\s*$/);
    }
  } finally {
    server.close();
  }
});

test("reports and suggestions share one report list per data change", async () => {
  const loaded = await tempProject(FIVE);
  const { server, app, origin } = await startAppServer({
    root: loaded.root,
    projects: [loaded],
    token: "tok",
  });
  try {
    const id = projectPaths(loaded).projectId;
    const api = `${origin}/p/${id}/api`;
    const first = await Promise.all([fetch(`${api}/reports`), fetch(`${api}/suggestions`)]);
    assert.deepEqual(
      first.map((r) => r.status),
      [200, 200],
    );
    const ws = projectPaths(loaded).workspace;
    // The first list writes the Pilot and Full check entries once (a data change of its own).
    await fetch(`${api}/reports`);
    const list = app.computed.peek(ws, `${id}:reports`);
    assert.ok(list, "the report list was not kept");
    await fetch(`${api}/reports`);
    assert.equal(
      app.computed.peek(ws, `${id}:reports`),
      list,
      "the report list was computed again",
    );
    // A data write: the next ask computes it again.
    workspaceStorage(ws).putJson(`projects/${id}/touch.json`, { at: 1 });
    assert.equal(app.computed.peek(ws, `${id}:reports`), undefined);
  } finally {
    server.close();
  }
});

test("same-screen check: page reads do not wait for it; the page is told while it runs", async () => {
  const loaded = await tempProject(FIVE);
  const { server, app, origin } = await startAppServer({
    root: loaded.root,
    projects: [loaded],
    token: "tok",
  });
  try {
    const id = projectPaths(loaded).projectId;
    const ws = projectPaths(loaded).workspace;
    const api = `${origin}/p/${id}/api`;
    // Its first run takes minutes: here it is held until the end of the test.
    let release: () => void = () => {};
    const held = new Promise<number>((r) => {
      release = () => r(0);
    });
    void app.computed.get(ws, `${id}:same-screens`, () => held);
    const quick = await Promise.race([
      Promise.all([
        fetch(`${api}/reports/builder`),
        fetch(`${api}/analysis/status`),
        fetch(`${api}/reports`),
      ]),
      new Promise<null>((r) => setTimeout(() => r(null), 20_000)),
    ]);
    assert.ok(quick, "a page read waited for the same-screen check");
    assert.deepEqual(
      quick.map((r) => r.status),
      [200, 200, 200],
    );
    assert.deepEqual(await (await fetch(`${api}/same-screens`)).json(), { running: true });
    release();
    await held;
    // Done (a data change meanwhile runs the quick check once more first).
    let running = true;
    for (let i = 0; i < 200 && running; i++) {
      running = ((await (await fetch(`${api}/same-screens`)).json()) as { running: boolean })
        .running;
      if (running) await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(running, false, "the check never reported done");
  } finally {
    server.close();
  }
});
