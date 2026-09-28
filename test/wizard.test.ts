import assert from "node:assert/strict";
import { test } from "node:test";
import { CountryCatalogueSchema, loadCountries } from "../src/config/countries.ts";
import { loadProject } from "../src/config/project.ts";
import { readRegistry } from "../src/config/registry.ts";
import type { Fetcher } from "../src/play/icon.ts";
import { wizardHtml } from "../src/view/wizard-html.ts";
import { OURS, wizardServer } from "./helpers/wizard.ts";

const LINK = `https://play.google.com/store/apps/details?id=${OURS}&hl=en&gl=US`;

test("country catalogue: valid, US first as the baseline, the Asia set ticked by default", () => {
  const cat = loadCountries();
  assert.ok(CountryCatalogueSchema.safeParse(cat).success);
  assert.ok(cat.countries.length >= 40);
  assert.deepEqual(cat.defaultTicked, ["jp", "kr", "tw", "hk", "th", "vn", "id", "ph"]);
  assert.equal(cat.countries.find((c) => c.gl === "hk")?.defaultHl, "zh-TW");
  assert.equal(cat.countries.find((c) => c.gl === "ph")?.defaultHl, "en");
});

test("wizard: look up, create, competitors, countries, charts, resume, create project", async () => {
  const w = await wizardServer();
  try {
    const name = await w.get("/api/play/lookup?q=Rogue%20Legend");
    assert.equal(name.status, 400);
    assert.match(name.json().problems[0], /A name is not enough/);
    const found = await w.get(`/api/play/lookup?q=${encodeURIComponent(LINK)}`);
    assert.equal(found.json().app.title, "Rogue Legend");
    assert.deepEqual(found.json().app.warnings, []);
    const missing = await w.get("/api/play/lookup?q=com.not.there");
    assert.equal(missing.status, 404);
    assert.match(missing.json().problems[0], /No game with this ID/);
    const tool = await w.get("/api/play/lookup?q=com.tool.app");
    assert.match(tool.json().app.warnings[0], /not a game category\. Charts will be switched off/);

    assert.equal(
      (await w.post("/api/projects", { appId: OURS, name: "Rogue Legend" }, {})).status,
      403,
    );
    const made = await w.post("/api/projects", { appId: OURS, name: "Rogue Legend" });
    assert.equal(made.status, 201);
    const id = made.body.id as string;
    assert.equal(id, "rogue-legend");
    const s0 = made.body.settings as {
      setupStep: number;
      markets: { gl: string }[];
      charts: { enabled: boolean };
      ourApp: { iconFile?: string };
    };
    assert.equal(s0.setupStep, 2);
    assert.deepEqual(
      s0.markets.map((m) => m.gl),
      ["us", "jp", "kr", "tw", "hk", "th", "vn", "id", "ph"],
    );
    assert.equal(s0.charts.enabled, true);
    assert.ok(s0.ourApp.iconFile, "icon saved");
    assert.equal((await w.get(`/p/${id}/icons/${s0.ourApp.iconFile}`)).status, 200);
    assert.equal(readRegistry(w.storage).projects[0]?.id, id);
    const again = await w.post("/api/projects", { appId: OURS, name: "Rogue Legend" });
    assert.equal(again.body.id, "rogue-legend-2", "a second project gets its own folder");

    // Resumable: the project opens on its setup steps, at the step where it stopped.
    assert.equal((await w.get(`/p/${id}/`)).location, `/p/${id}/setup`);
    assert.match((await w.get(`/p/${id}/setup`)).text, /wizardStart\(\)/);
    assert.match((await w.get(`/p/${id}/api/state`)).json().line, /step 2 of 5, competitors/);

    const set = (body: unknown) => w.post(`/p/${id}/api/settings`, body);
    const one = await set({ competitors: [{ id: "com.habby.capybara", tier: "direct" }] });
    assert.equal(one.status, 200);
    const c0 = (one.body.settings as { competitors: { name: string; iconFile?: string }[] })
      .competitors[0];
    assert.equal(c0?.name, "Capybara Go", "the name comes from Google Play, not the page");
    assert.ok(c0?.iconFile);
    assert.match((one.body.warnings as string[])[0] ?? "", /at least 5 competitors/);
    const dup = await set({
      competitors: [
        { id: "com.habby.capybara", tier: "direct" },
        { id: "com.habby.capybara", tier: "reference" },
      ],
    });
    assert.match(dup.body.problems?.[0] ?? "", /in your list already/);
    const own = await set({ competitors: [{ id: OURS, tier: "direct" }] });
    assert.match(own.body.problems?.[0] ?? "", /your own game/);
    const gone = await set({ competitors: [{ id: "com.not.there", tier: "direct" }] });
    assert.equal(gone.status, 404);
    const two = await set({
      competitors: [
        { id: "com.dxx.firenow", tier: "same_audience" },
        { id: "com.habby.capybara", tier: "reference" },
      ],
    });
    const order = (two.body.settings as { competitors: { id: string; tier: string }[] })
      .competitors;
    assert.deepEqual(
      order.map((c) => `${c.id}:${c.tier}`),
      ["com.dxx.firenow:same_audience", "com.habby.capybara:reference"],
    );

    const m = await set({
      markets: [
        { gl: "jp", hl: "en" },
        { gl: "ph", hl: "fil" },
      ],
    });
    const labels = (m.body.settings as { markets: { label: string }[] }).markets.map(
      (x) => x.label,
    );
    assert.deepEqual(labels, [
      "United States (English)",
      "Japan (English)",
      "Philippines (Filipino)",
    ]);
    assert.match(
      (await set({ markets: [{ gl: "jp", hl: "th" }] })).body.problems?.[0] ?? "",
      /not offered in Thai/,
    );
    assert.equal((await set({ markets: [{ gl: "zz", hl: "en" }] })).status, 400);
    assert.equal((await set({ charts: { enabled: true, depth: 99 } })).status, 400);
    const ch = await set({ charts: { enabled: true, depth: 20 }, setupStep: 5 });
    assert.equal((ch.body.settings as { charts: { depth: number } }).charts.depth, 20);
    assert.match((await w.get(`/p/${id}/api/state`)).json().line, /step 5 of 5/);
    assert.equal((await set({ bogus: 1 })).status, 400, "unknown fields are refused");

    const empty = await w.post(`/p/rogue-legend-2/api/settings/finish`, {});
    assert.match(empty.body.problems?.[0] ?? "", /Add at least one competitor/);
    const done = await w.post(`/p/${id}/api/settings/finish`, {});
    assert.equal(done.body.href, `/p/${id}/`);
    const loaded = loadProject(id, { root: w.root });
    assert.equal(loaded.config.charts.depth, 20);
    assert.equal(loaded.config.category, "GAME_ROLE_PLAYING");
    assert.equal((await w.get(`/p/${id}/`)).location, `/p/${id}/status`);
    const page = (await w.get(`/p/${id}/status`)).text;
    assert.match(page, /Next step: <strong>Download preview<\/strong>/);
    assert.match(page, /npm run preview -- --project rogue-legend/);
    assert.equal((await w.get(`/p/${id}/setup`)).location, `/p/${id}/`);
    assert.equal(
      (await set({ setupStep: 2 })).status,
      409,
      "a finished project is not changed here",
    );
  } finally {
    w.server.close();
  }
});

test("wizard: search gives matches or a card; a tools app has charts off", async () => {
  const w = await wizardServer();
  try {
    const hits = (await w.get("/api/play/search?q=capy")).json().hits as { appId: string }[];
    assert.deepEqual(
      hits.map((h) => h.appId),
      ["com.habby.capybara", "com.dxx.firenow"],
    );
    const card = (await w.get("/api/play/search?q=com.dxx.firenow")).json().app;
    assert.equal(card.installs, "1,000,000+");
    assert.equal((await w.get("/api/play/search?q=x")).status, 400);
    const dotted = (await w.get("/api/play/search?q=Survivor.io")).json();
    assert.ok(dotted.hits, "a name that looks like an ID is searched when no such ID exists");
    const link = await w.get(
      `/api/play/search?q=${encodeURIComponent("https://play.google.com/store/apps/details?id=a.b")}`,
    );
    assert.equal(link.status, 404, "a link is never turned into a search");
    const made = await w.post("/api/projects", { appId: "com.tool.app", name: "Tool" });
    const s = made.body.settings as { charts: { enabled: boolean }; category: string };
    assert.equal(s.charts.enabled, false);
    const on = await w.post(`/p/${made.body.id}/api/settings`, {
      charts: { enabled: true, depth: 10 },
    });
    assert.match(on.body.problems?.[0] ?? "", /game category/);
    assert.equal((await w.get("/api/countries")).json().countries[0].gl, "us");
  } finally {
    w.server.close();
  }
});

test("wizard: the project is saved before its icon is fetched (a slow icon never loses it)", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const slow: Fetcher = async () => {
    await gate;
    return new Response(null, { status: 404 });
  };
  const w = await wizardServer(slow);
  try {
    const pending = w.post("/api/projects", { appId: OURS, name: "Slow Icon" });
    let saved = false;
    for (let i = 0; i < 50 && !saved; i++) {
      saved = w.storage.exists("projects/slow-icon/project.json");
      if (!saved) await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(saved, "project.json exists while the icon is still loading");
    assert.equal(readRegistry(w.storage).projects[0]?.id, "slow-icon");
    release();
    assert.equal((await pending).status, 201);
  } finally {
    w.server.close();
  }
});

test("wizard: a competitor not on Google Play in the US is allowed, with its reference country", async () => {
  const w = await wizardServer();
  try {
    const made = await w.post("/api/projects", { appId: OURS, name: "Ref" });
    const id = made.body.id as string;
    const card = (await w.get(`/api/play/search?q=com.jp.only&project=${id}`)).json().app;
    assert.deepEqual(card.reference, { gl: "jp", hl: "ja", label: "Japan (Japanese)" });
    assert.match(
      card.warnings[0],
      /^Not on Google Play in the United States; using Japan \(Japanese\) as its reference/,
    );
    const noProject = await w.get("/api/play/search?q=com.jp.only");
    assert.ok(!noProject.json().app, "without the project's countries it is not found as an ID");
    const r = await w.post(`/p/${id}/api/settings`, {
      competitors: [{ id: "com.jp.only", tier: "direct" }],
    });
    assert.equal(r.status, 200);
    const c = (r.body.settings as { competitors: { name: string; reference?: unknown }[] })
      .competitors[0];
    assert.equal(c?.name, "Japan Only");
    assert.deepEqual(c?.reference, { gl: "jp", hl: "ja", label: "Japan (Japanese)" });
    assert.ok((r.body.warnings as string[]).some((x) => /^Japan Only: Not on Google Play/.test(x)));
    const untick = await w.post(`/p/${id}/api/settings`, { markets: [{ gl: "kr", hl: "ko" }] });
    assert.ok(
      (untick.body.warnings as string[]).some((x) =>
        /Japan \(Japanese\) is no longer ticked/.test(x),
      ),
    );
    // A competitor that exists only in a country added in the same save is found there.
    const both = await w.post(`/p/${id}/api/settings`, {
      markets: [{ gl: "jp", hl: "ja" }],
      competitors: [
        { id: "com.jp.only", tier: "direct" },
        { id: "com.jp.two", tier: "reference" },
      ],
    });
    assert.equal(both.status, 200, both.body.problems?.[0]);
    assert.equal((await w.post(`/p/${id}/api/settings/finish`, {})).status, 200);
    assert.equal(loadProject(id, { root: w.root }).config.competitors[0]?.id, "com.jp.only");
  } finally {
    w.server.close();
  }
});

test("wizard page: every button that starts work goes through act()", () => {
  const html = wizardHtml("t", null);
  for (const re of [
    /function lookup\(btn\) \{[\s\S]{0,80}return act\(btn,/,
    /function createProject\(btn\) \{[\s\S]{0,120}return act\(btn,/,
    /function search\(btn\) \{[\s\S]{0,80}return act\(btn,/,
    /function saveComps\(btn, busy, list, done\) \{\s*return act\(btn,/,
    /if \(t\.dataset\.add\) \{[\s\S]{0,60}saveComps\(t,/,
    /if \(t\.dataset\.remove\) \{[\s\S]{0,200}saveComps\(t,/,
    /t\.id !== "finish"\) return;\s*act\(t,/,
  ])
    assert.match(html, re);
  assert.doesNotMatch(html, /milestone/i, "no internal codes on the page");
});
