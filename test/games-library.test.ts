import assert from "node:assert/strict";
import { test } from "node:test";
import { indexStale, readIndex } from "../src/library/games-index.ts";
import { latestRunId } from "../src/library/project-decks.ts";
import { projectKey } from "../src/storage/index.ts";
import { downloadedProject } from "./helpers/competitors.ts";
import { headers } from "./helpers/wizard.ts";

type Game = {
  appId: string;
  images: number;
  countries: number;
  uses: { role: string }[];
  pages: { gl: string }[];
};

async function listed(w: Awaited<ReturnType<typeof downloadedProject>>["w"]): Promise<Game[]> {
  for (let i = 0; i < 100; i++) {
    const r = (await w.get("/api/games")).json();
    if (r.games && !r.progress?.running) return r.games;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("the list never finished");
}

test("games directory: the saved list, counts, roles, a forced update with progress", async () => {
  const { w, id } = await downloadedProject();
  try {
    const page = await w.get("/games");
    assert.equal(page.status, 200);
    assert.match(page.text, /id="gRebuild"/);
    const games = await listed(w);
    const capy = games.find((g) => g.appId === "com.habby.capybara");
    assert.ok(capy);
    // United States: c1 and the shared picture; Japan: c1 again. Distinct pictures count once.
    assert.equal(capy.images, 2);
    assert.equal(capy.countries, 2);
    assert.equal(capy.uses[0]?.role, "direct competitor");
    assert.ok(readIndex(w.storage), "saved to shared/index/games.v1.json");
    assert.equal(indexStale(w.storage, readIndex(w.storage)), false);
    // A change to the project's decks makes the saved list stale (seen on the next open).
    w.storage.putJson(projectKey({ projectId: id }, "state", "refreshes.json"), { x: 1 });
    assert.equal(indexStale(w.storage, readIndex(w.storage)), true);
    // "Update the list": token required, then progress and a result line.
    assert.equal(
      (await w.post("/api/games/rebuild", {}, { "Content-Type": "application/json" })).status,
      403,
    );
    const r = await w.post("/api/games/rebuild", {}, headers);
    assert.equal(r.status, 202);
    await listed(w);
    const done = (await w.get("/api/games")).json();
    assert.match(done.progress.message, /^List updated: \d+ games? changed$/);
    // The home page's top bar links to the library (never a project card).
    assert.match(
      (await w.get("/")).text,
      /<header class="appbar">[\s\S]*href="\/games">Games library</,
    );
  } finally {
    w.server.close();
  }
});

test("game page: strips link every picture to its image page in a new tab; marks and failed slots", async () => {
  const { w, id } = await downloadedProject();
  try {
    // One failed download in the Japanese page of our game.
    const run = latestRunId(w.storage, id) as string;
    const mk = projectKey({ projectId: id }, "runs", run, "manifest.json");
    const m = w.storage.getJson(mk) as {
      decks: { appId: string; gl: string; slots: { imageId: string | null }[] }[];
    };
    const jp = m.decks.find((d) => d.appId === "com.pockethaven.roguelegend" && d.gl === "jp");
    assert.ok(jp);
    jp.slots.push({ ...jp.slots[0], imageId: null, position: 2 } as never);
    w.storage.putJson(mk, m);
    const d = (await w.get(`/api/games/com.habby.capybara?project=${id}`)).json();
    assert.deepEqual(
      d.strips.map((s: { gl: string; main: boolean }) => [s.gl, s.main]),
      [
        ["us", true],
        ["jp", false],
      ],
    );
    const jpThumb = d.strips[1].thumbs[0];
    assert.equal(jpThumb.mark, "Same file as United States");
    assert.match(
      jpThumb.href,
      /^\/image\/[0-9a-f]{64}\?project=.+&app=com\.habby\.capybara&gl=jp&hl=en&pos=1$/,
    );
    const html = (await w.get(`/games/com.habby.capybara?project=${id}`)).text;
    assert.match(
      html,
      /<a href="\/image\/[0-9a-f]{64}\?project=[^"]+" target="_blank" rel="noopener"/,
    );
    assert.match(html, /<details class="fold"><summary>Store text per country/);
    // Flags only in the strip headings, never in the marks.
    assert.doesNotMatch(html, /<figcaption>(?:(?!<\/figcaption>)[\s\S])*<img class="flag"/);
    const ours = (await w.get("/games/com.pockethaven.roguelegend")).text;
    assert.match(ours, /Screenshot could not be saved/);
    // The image page it links to answers for that context.
    const img = (await w.get(`/api${jpThumb.href}`)).json();
    assert.equal(img.context.gl, "jp");
    assert.equal(img.notice, "");
    // Validation and not-found.
    assert.equal((await w.get("/api/games/not an app")).status, 400);
    assert.equal((await w.get("/api/games/com.habby.capybara?project=BAD")).status, 400);
    assert.equal((await w.get("/api/games/com.unknown.game")).status, 404);
    assert.equal((await w.get("/api/games/com.habby.capybara?project=other")).status, 404);
    const other = await w.get("/games/com.habby.capybara?project=other");
    assert.match(other.text, /does not hold this game/);
  } finally {
    w.server.close();
  }
});
