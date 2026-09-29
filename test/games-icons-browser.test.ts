import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser } from "playwright-core";
import sharp from "sharp";
import { NoBrowserError, startBrowser } from "../src/export/pdf.ts";
import type { GamePage } from "../src/server/game-view.ts";
import { gameHtml } from "../src/view/game-html.ts";
import { gamesHtml } from "../src/view/games-html.ts";

// The games directory and a game page in a real browser with the tool's answers scripted: the
// cards show their letters at once, missing icons arrive in the background (at most three asked
// at a time), and a broken icon falls back to the letter.
const ORIGIN = "http://tool.test";
const src = (c: string) => `/app-icons/${c.repeat(64)}.webp`;
const game = (n: number, extra: object) => ({
  appId: `com.example.g${n}`,
  name: `Game ${n}`,
  icon: null,
  iconStale: true,
  category: "Action",
  pages: [{ gl: "us", hl: "en", images: 5, checked: "2026-09-29", status: "ok" }],
  images: 10 - n,
  countries: 1,
  analysed: 0,
  aso: "",
  asoDiffers: 0,
  keywords: [],
  uses: [{ projectId: "p", project: "P", role: "chart game", archived: false, ranks: [] }],
  latestCheck: "2026-09-29",
  search: `game ${n}`,
  ...extra,
});

async function browserOr(t: { skip: (m: string) => void }): Promise<Browser | null> {
  try {
    return (await startBrowser(null)) as unknown as Browser;
  } catch (e) {
    if (e instanceof NoBrowserError) {
      t.skip("no Chrome or Edge on this machine");
      return null;
    }
    throw e;
  }
}

test("games directory: letters first, icons fill in the background, three at a time", async (t) => {
  const browser = await browserOr(t);
  if (!browser) return;
  const webp = await sharp({
    create: { width: 128, height: 128, channels: 3, background: { r: 30, g: 160, b: 60 } },
  })
    .webp()
    .toBuffer();
  const games = [
    ...[1, 2, 3, 4, 5, 6].map((n) => game(n, {})),
    game(7, { icon: src("b"), iconStale: false }),
  ];
  let release = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  let inFlight = 0;
  let most = 0;
  const asked: string[] = [];
  try {
    const page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, async (r) => {
      const path = new URL(r.request().url()).pathname;
      const json = (body: unknown) =>
        r.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/games") return r.fulfill({ contentType: "text/html", body: gamesHtml("t") });
      if (path === "/api/games")
        return json({ games, builtAt: new Date().toISOString(), progress: null });
      if (path === "/api/games/icon") {
        const id = JSON.parse(String(r.request().postData())).appId as string;
        asked.push(id);
        inFlight++;
        most = Math.max(most, inFlight);
        await hold;
        inFlight--;
        return json({ src: id === "com.example.g6" ? null : src("a") });
      }
      if (path === src("a")) return r.fulfill({ contentType: "image/webp", body: webp });
      return r.fulfill({ status: 404, body: "" });
    });
    await page.goto(`${ORIGIN}/games`);
    const tile = (n: number) => page.locator(`#gc-com\\.example\\.g${n} .app-icon`);
    await tile(1).waitFor();
    // The whole list is there while every icon request is still open.
    assert.equal(await page.locator(".gcard").count(), 7);
    assert.equal(await tile(1).locator("img").count(), 0, "the letter while it is fetched");
    assert.equal(await tile(1).innerText(), "G");
    await page.waitForFunction(() => document.querySelectorAll(".gcard").length === 7);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(most, 3, "at most three icon requests at a time");
    release();
    await page.waitForFunction(
      `document.querySelector('#gc-com\\\\.example\\\\.g1 .app-icon img')?.naturalWidth === 128`,
    );
    await page.waitForFunction(
      `[...document.querySelectorAll('.gcard .app-icon img')].filter((i) => i.naturalWidth === 128).length === 5`,
    );
    assert.deepEqual(asked.sort(), [1, 2, 3, 4, 5, 6].map((n) => `com.example.g${n}`).sort());
    assert.equal(await tile(6).innerText(), "G", "no icon: the letter stays");
    // A stored icon that cannot be loaded: the letter tile again.
    await page.waitForFunction(
      `!document.querySelector('#gc-com\\\\.example\\\\.g7 .app-icon img')`,
    );
    assert.equal(await tile(7).innerText(), "G");
    // The Google Play mark with its countries.
    assert.equal(
      await page.locator("#gc-com\\.example\\.g1 .store-mark.play").getAttribute("title"),
      "Google Play: United States",
    );
  } finally {
    release();
    await browser.close();
  }
});

test("game page: the header letter until the icon arrives", async (t) => {
  const browser = await browserOr(t);
  if (!browser) return;
  const webp = await sharp({
    create: { width: 128, height: 128, channels: 3, background: { r: 200, g: 60, b: 60 } },
  })
    .webp()
    .toBuffer();
  const data = {
    appId: "com.example.g1",
    name: "Game 1",
    icon: null,
    iconStale: true,
    stores: [{ platform: "play", countries: ["United States", "Japan"] }],
    category: "Action",
    images: 0,
    analysed: 0,
    project: { id: "p", name: "P" },
    choices: [],
    uses: [],
    notice: "",
    strips: [],
    storeText: [],
    info: {},
  } as GamePage;
  let release = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  try {
    const page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, async (r) => {
      const path = new URL(r.request().url()).pathname;
      if (path === "/games/com.example.g1")
        return r.fulfill({ contentType: "text/html", body: gameHtml(data, "t") });
      if (path === "/api/games/icon") {
        await hold;
        return r.fulfill({ contentType: "application/json", body: `{"src":"${src("c")}"}` });
      }
      if (path === src("c")) return r.fulfill({ contentType: "image/webp", body: webp });
      return r.fulfill({ status: 404, body: "" });
    });
    await page.goto(`${ORIGIN}/games/com.example.g1`);
    const tile = page.locator(".ghead2 .app-icon");
    assert.equal(await tile.innerText(), "G");
    assert.equal(await tile.locator("img").count(), 0);
    assert.equal(
      await page.locator(".ghead2 .store-mark.play").getAttribute("title"),
      "Google Play: United States, Japan",
    );
    release();
    await page.waitForFunction(
      `document.querySelector('.ghead2 .app-icon img')?.naturalWidth === 128`,
    );
  } finally {
    release();
    await browser.close();
  }
});
