import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import {
  appIconKey,
  appIconSrc,
  appIconStale,
  ensureAppIcon,
  noteIconUrl,
  resetAppIconRetries,
} from "../src/library/app-icon.ts";
import type { Fetcher } from "../src/play/icon.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { fakeFetcher, ICON } from "./helpers/play.ts";
import { OURS, wizardServer } from "./helpers/wizard.ts";

const scratch = () => workspaceStorage(mkdtempSync(join(tmpdir(), "ssr-icon-")));
const details = (icon: string) => {
  const calls: string[] = [];
  const get = async (id: string) => {
    calls.push(id);
    return { icon };
  };
  return { calls, details: get };
};

test("app icon: downloaded once into the library as a 128 px WebP, then served from the cache", async () => {
  resetAppIconRetries();
  const storage = scratch();
  const { fetcher, calls } = await fakeFetcher();
  const d = details(ICON);
  assert.equal(appIconSrc(storage, OURS), null, "no icon before the first fetch");
  assert.equal(appIconStale(storage, OURS), true);
  const src = await ensureAppIcon(storage, OURS, { details: d.details, fetcher });
  const sha = src?.match(/^\/app-icons\/([0-9a-f]{64})\.webp$/)?.[1] ?? "";
  assert.ok(sha, `a local URL: ${src}`);
  const bytes = storage.getBytes(appIconKey(sha));
  const meta = await sharp(bytes).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["webp", 128, 128]);
  assert.equal(appIconSrc(storage, OURS), src);
  assert.equal(appIconStale(storage, OURS), false);
  assert.equal(await ensureAppIcon(storage, OURS, { details: d.details, fetcher }), src);
  assert.deepEqual([calls.length, d.calls.length], [1, 1], "no second download or store read");
  // A week later the store page is checked again; the same icon is not downloaded again.
  const later = Date.now() + 8 * 24 * 3_600_000;
  assert.equal(appIconStale(storage, OURS, later), true);
  assert.equal(await ensureAppIcon(storage, OURS, { details: d.details, fetcher }, later), src);
  assert.deepEqual([calls.length, d.calls.length], [1, 2]);
});

test("app icon: a store read with a different icon URL refreshes the copy", async () => {
  resetAppIconRetries();
  const storage = scratch();
  const { fetcher } = await fakeFetcher();
  const d = details(ICON);
  const first = await ensureAppIcon(storage, OURS, { details: d.details, fetcher });
  noteIconUrl(storage, OURS, ICON);
  assert.equal(appIconStale(storage, OURS), false, "the same URL changes nothing");
  const blue = await sharp({
    create: { width: 512, height: 512, channels: 3, background: { r: 20, g: 40, b: 220 } },
  })
    .png()
    .toBuffer();
  const urls: string[] = [];
  const newIcon: Fetcher = async (url) => {
    urls.push(url);
    return new Response(new Uint8Array(blue), { headers: { "content-type": "image/png" } });
  };
  noteIconUrl(storage, OURS, `${ICON}-v2`);
  assert.equal(appIconStale(storage, OURS), true);
  assert.equal(appIconSrc(storage, OURS), first, "the old copy shows until the new one is in");
  const second = await ensureAppIcon(storage, OURS, { details: d.details, fetcher: newIcon });
  assert.ok(second && second !== first, "a new content-addressed copy");
  assert.deepEqual(urls, [`${ICON}-v2`]);
  assert.equal(d.calls.length, 1, "the new URL came from the store read, not another one");
  assert.equal(appIconSrc(storage, OURS), second);
});

test("app icon: no icon (not on Play, refused host, failed download) leaves the letter, retried later", async () => {
  resetAppIconRetries();
  const storage = scratch();
  const notOnPlay = async () => {
    throw new Error("not on Google Play");
  };
  assert.equal(await ensureAppIcon(storage, "com.a.none", { details: notOnPlay }), null);
  const d = details("https://evil.example.com/icon.png");
  const { fetcher, calls } = await fakeFetcher();
  assert.equal(await ensureAppIcon(storage, "com.a.evil", { details: d.details, fetcher }), null);
  assert.equal(calls.length, 0, "only Google's image hosts are fetched");
  const broken: Fetcher = async () => new Response("nope", { status: 500 });
  const good = details(ICON);
  const now = Date.now();
  assert.equal(await ensureAppIcon(storage, OURS, { ...good, fetcher: broken }, now), null);
  assert.equal(await ensureAppIcon(storage, OURS, { ...good, fetcher }, now + 1000), null);
  assert.equal(calls.length, 0, "a failure is not retried at once");
  const src = await ensureAppIcon(storage, OURS, { ...good, fetcher }, now + 11 * 60_000);
  assert.ok(src, "retried after the pause");
});

test("app icon routes: the home lists it, the page asks for it, the tool serves it locally", async () => {
  resetAppIconRetries();
  const s = await wizardServer();
  try {
    const made = await s.post("/api/projects", { name: "Rogue Legend", appId: OURS });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const id = String(made.body.id);
    const list = async () =>
      (await s.get("/api/projects")).json().projects[0] as {
        appIcon: string | null;
        iconStale: boolean;
      };
    // The project wizard's store read noted the icon URL; the copy is fetched lazily.
    const before = await list();
    assert.deepEqual([before.appIcon, before.iconStale], [null, true]);
    const refused = await s.post(
      "/api/app-icon",
      { projectId: id },
      { "Content-Type": "application/json" },
    );
    assert.equal(refused.status, 403, "only the tool's page may ask");
    assert.equal((await s.post("/api/app-icon", { projectId: "nope" })).status, 404);
    const r = await s.post("/api/app-icon", { projectId: id });
    assert.equal(r.status, 200);
    const src = String(r.body.src);
    assert.match(src, /^\/app-icons\/[0-9a-f]{64}\.webp$/);
    const after = await list();
    assert.deepEqual([after.appIcon, after.iconStale], [src, false]);
    const img = await fetch(`${s.origin}${src}`);
    assert.equal(img.headers.get("content-type"), "image/webp");
    assert.match(String(img.headers.get("cache-control")), /immutable/);
    assert.ok((await img.arrayBuffer()).byteLength > 0);
    assert.equal((await s.get(`/app-icons/${"0".repeat(64)}.webp`)).status, 404);
    assert.equal((await s.get("/app-icons/../x.webp")).status, 404);
  } finally {
    s.server.close();
  }
});

test("app icon markup: the letter tile under the icon, alt text is the game's name", async () => {
  const { runInNewContext } = await import("node:vm");
  const { APP_ICON_SCRIPT } = await import("../src/view/app-icon.ts");
  const { HOME_SCRIPT } = await import("../src/view/home-script.ts");
  const { homeHtml } = await import("../src/view/home-html.ts");
  const esc = (v: string) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const ctx = { esc, document: { addEventListener: () => {} }, out: {} as Record<string, string> };
  runInNewContext(
    `${APP_ICON_SCRIPT}; out.icon = appIconHtml("Rogue Legend", "/app-icons/ab.webp"); out.none = appIconHtml("Rogue Legend", "");`,
    ctx,
  );
  assert.equal(
    ctx.out.icon,
    '<span class="icon app-icon"><span aria-hidden="true">R</span><img alt="Rogue Legend" src="/app-icons/ab.webp" data-app-icon="1"></span>',
  );
  assert.equal(
    ctx.out.none,
    '<span class="icon app-icon"><span aria-hidden="true">R</span></span>',
  );
  assert.match(HOME_SCRIPT, /appIconHtml\(p\.name, p\.appIcon/);
  assert.match(HOME_SCRIPT, /fetchAppIcons\(/);
  assert.match(homeHtml("t"), /\.app-icon img \{[^}]*border-radius: inherit/);
});
