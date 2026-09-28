import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { fetchIcon, iconUrlAllowed } from "../src/play/icon.ts";
import { parsePlayInput } from "../src/play/input.ts";
import { PlayProblem } from "../src/play/lookup.ts";
import { PlayQueue } from "../src/play/queue.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { app, fakeFetcher, fakeScraper, ICON, lookup } from "./helpers/play.ts";

const storage = () => workspaceStorage(mkdtempSync(join(tmpdir(), "ssr-play-")));

test("input: Play links, market links and package IDs give an ID; other Play pages are refused", () => {
  const id = (s: string) => {
    const r = parsePlayInput(s);
    return r.kind === "id" ? r.appId : r.kind;
  };
  const rl = "com.pockethaven.roguelegend";
  assert.equal(id(`https://play.google.com/store/apps/details?id=${rl}&hl=ja&gl=JP`), rl);
  assert.equal(id(`https://m.play.google.com/store/apps/details/?gl=us&id=${rl}`), rl);
  assert.equal(id(`play.google.com/store/apps/details?id=${rl}`), rl);
  assert.equal(id(`market://details?id=${rl}`), rl);
  assert.equal(id(`  ${rl}  `), rl);
  assert.equal(id("com.DoorTeam.BagMaster"), "com.DoorTeam.BagMaster");
  assert.equal(id("https://play.google.com/store/apps/dev?id=123"), "bad");
  assert.equal(id("https://play.google.com/store/search?q=rpg"), "bad");
  assert.equal(id("https://example.com/store/apps/details?id=a.b"), "bad");
  // Looks like an ID; the competitor search falls back to a name search when no such ID exists.
  assert.equal(id("Survivor.io"), "Survivor.io");
  assert.equal(id("Capybara Go"), "search");
  assert.equal(id("x"), "bad");
  assert.equal(id(""), "bad");
  const bad = parsePlayInput("https://play.google.com/store/apps/dev?id=1");
  assert.match(bad.kind === "bad" ? bad.message : "", /not a game's page/);
});

test("queue: one request at a time, spaced, interactive ahead of background", async () => {
  const q = new PlayQueue(30);
  const order: string[] = [];
  const at: number[] = [];
  const job = (name: string) => async () => {
    order.push(name);
    at.push(Date.now());
    return name;
  };
  const all = [
    q.run(job("bg1"), "background"),
    q.run(job("bg2"), "background"),
    q.run(job("bg3"), "background"),
  ];
  all.push(q.run(job("ui"), "interactive"));
  await Promise.all(all);
  assert.equal(order[0], "bg1");
  assert.equal(order[1], "ui", "the interactive request jumps the waiting background ones");
  for (let i = 1; i < at.length; i++)
    assert.ok((at[i] ?? 0) - (at[i - 1] ?? 0) >= 25, "requests are spaced");
  await assert.rejects(
    q.run(() => Promise.reject(new Error("x"))),
    /x/,
  );
  assert.equal(await q.run(async () => 5), 5, "a failure does not stop the queue");
});

test("details: mapped, cached for a day, 404 is a plain answer, errors retried once and never cached", async () => {
  const s = storage();
  const f = fakeScraper([app("com.dxx.firenow", "Survivor.io", "GAME_ADVENTURE")]);
  let now = Date.parse("2026-09-28T00:00:00Z");
  const play = lookup(s, f.scraper, () => now);
  const d = await play.details("com.dxx.firenow");
  assert.equal(d.title, "Survivor.io");
  assert.equal(d.installs, "1,000,000+");
  assert.equal(d.isGame, true);
  assert.equal(d.url, "https://play.google.com/store/apps/details?id=com.dxx.firenow");
  await play.details("com.dxx.firenow");
  assert.equal(f.calls.app, 1, "second read from the cache");
  now += 25 * 3_600_000;
  await play.details("com.dxx.firenow");
  assert.equal(f.calls.app, 2, "read again after a day");

  await assert.rejects(play.details("com.missing.game"), (e: unknown) => {
    assert.ok(e instanceof PlayProblem);
    assert.equal(e.kind, "unavailable");
    assert.match(e.message, /No game with this ID on Google Play in the United States/);
    return true;
  });
  const before = f.calls.app;
  await assert.rejects(play.details("com.missing.game"));
  assert.equal(f.calls.app, before, "not on Google Play is a cached answer");

  f.fail.push(Object.assign(new Error("429"), { status: 429 }));
  now += 25 * 3_600_000;
  assert.equal((await play.details("com.dxx.firenow")).title, "Survivor.io", "retried once");
  f.fail.push(new Error("net"), new Error("net"));
  now += 25 * 3_600_000;
  await assert.rejects(play.details("com.dxx.firenow"), /Google Play did not answer/);
  const calls = f.calls.app;
  assert.equal((await play.details("com.dxx.firenow")).title, "Survivor.io");
  assert.equal(f.calls.app, calls + 1, "the failure was not cached");
});

test("details and search: an unexpected answer is a plain problem, not a crash", async () => {
  const f = fakeScraper([], [{ nope: true }]);
  f.scraper.app = async () => ({ title: 5 });
  const play = lookup(storage(), f.scraper);
  await assert.rejects(play.details("a.b"), /answered in an unexpected way/);
  await assert.rejects(play.search("capy"), /answered in an unexpected way/);
});

test("search: top matches in store order, cached, and a plain message for no hits", async () => {
  const hits = [app("com.habby.capybara", "Capybara Go"), app("com.other.capy", "Capy Clone")];
  const f = fakeScraper([], hits);
  const play = lookup(storage(), f.scraper);
  const r = await play.search("Capybara");
  assert.deepEqual(
    r.map((h) => h.appId),
    ["com.habby.capybara", "com.other.capy"],
  );
  assert.deepEqual(Object.keys(r[0] ?? {}).sort(), [
    "appId",
    "developer",
    "icon",
    "score",
    "title",
  ]);
  await play.search("  capybara ");
  assert.equal(f.calls.search, 1, "same term (any case or spacing) from the cache");
  const none = fakeScraper([], []);
  await assert.rejects(lookup(storage(), none.scraper).search("zzqx"), /No games found for "zzqx"/);
});

test("icons: Google hosts only, no redirects, image only, size and pixel limits", async () => {
  assert.ok(iconUrlAllowed(ICON));
  assert.ok(iconUrlAllowed("https://lh3.ggpht.com/x"));
  assert.ok(!iconUrlAllowed("http://play-lh.googleusercontent.com/x"));
  assert.ok(!iconUrlAllowed("https://evil.com/googleusercontent.com"));
  const s = storage();
  const ctx = { projectId: "p1" };
  const { fetcher, calls } = await fakeFetcher();
  const file = await fetchIcon(s, ctx, "com.a_b.c", ICON, fetcher);
  assert.equal(file, "com.a@b.c.png");
  const meta = await sharp(s.getBytes(`projects/p1/icons/${file}`)).metadata();
  assert.equal(meta.width, 128);
  assert.equal(await fetchIcon(s, ctx, "com.a_b.c", ICON, fetcher), file);
  assert.equal(calls.length, 1, "downloaded once");
  assert.equal(await fetchIcon(s, ctx, "x.y", "https://evil.com/i.png", fetcher), null);
  let init: RequestInit | undefined;
  const redirect = async (_u: string, i: RequestInit) => {
    init = i;
    return new Response(null, { status: 302, headers: { location: "https://evil.com" } });
  };
  assert.equal(await fetchIcon(s, ctx, "r.d", ICON, redirect), null);
  assert.equal(init?.redirect, "manual");
  const html = async () =>
    new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
  assert.equal(await fetchIcon(s, ctx, "h.t", ICON, html), null);
  const huge = async () =>
    new Response(new Uint8Array(2 * 1024 * 1024), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  assert.equal(await fetchIcon(s, ctx, "b.g", ICON, huge), null, "over 1 MB is cut off");
  const giant = await sharp({
    create: { width: 2500, height: 2500, channels: 3, background: "#000" },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const big = async () =>
    new Response(new Uint8Array(giant), { status: 200, headers: { "content-type": "image/png" } });
  assert.equal(await fetchIcon(s, ctx, "p.x", ICON, big), null, "over 4 megapixels is refused");
});
