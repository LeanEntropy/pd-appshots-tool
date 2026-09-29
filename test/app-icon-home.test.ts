import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser } from "playwright-core";
import sharp from "sharp";
import { NoBrowserError, startBrowser } from "../src/export/pdf.ts";
import { homeHtml } from "../src/view/home-html.ts";

// The home page in a real browser with the tool's answers scripted: a card shows its letter
// first, the game's icon once the background fetch has it, and the letter again if it fails.
const ORIGIN = "http://tool.test";
const GOOD = `/app-icons/${"a".repeat(64)}.webp`;
const BAD = `/app-icons/${"b".repeat(64)}.webp`;
const card = (id: string, name: string, extra: object) => ({
  id,
  name,
  ourAppId: `com.example.${id}`,
  archived: false,
  competitors: 1,
  countries: 1,
  lastOpenedAt: "2026-09-29T00:00:00Z",
  ...extra,
});

test("home: the letter tile until the game's icon arrives, and again when it fails", async (t) => {
  let browser: Browser;
  try {
    browser = (await startBrowser(null)) as unknown as Browser;
  } catch (e) {
    if (e instanceof NoBrowserError) return t.skip("no Chrome or Edge on this machine");
    throw e;
  }
  const webp = await sharp({
    create: { width: 128, height: 128, channels: 3, background: { r: 30, g: 160, b: 60 } },
  })
    .webp()
    .toBuffer();
  let release = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  const asked: string[] = [];
  try {
    const page = await browser.newPage();
    await page.route(`${ORIGIN}/**`, async (r) => {
      const path = new URL(r.request().url()).pathname;
      const json = (body: unknown) =>
        r.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
      if (path === "/") return r.fulfill({ contentType: "text/html", body: homeHtml("t") });
      if (path === "/api/projects")
        return json({
          projects: [
            card("rl", "Rogue Legend", { appIcon: null, iconStale: true }),
            card("gone", "Gone Game", { appIcon: BAD, iconStale: false }),
          ],
        });
      if (path === "/api/jobs") return json({ lanes: [] });
      if (path === "/api/import") return json({ found: [], importing: null });
      if (path === "/api/app-icon") {
        asked.push(String(r.request().postData()));
        await hold;
        return json({ src: GOOD });
      }
      if (path === GOOD) return r.fulfill({ contentType: "image/webp", body: webp });
      return r.fulfill({ status: 404, body: "" });
    });
    await page.goto(`${ORIGIN}/`);
    const tile = (id: string) => page.locator(`article[aria-labelledby="t-${id}"] .app-icon`);
    await tile("rl").waitFor();
    assert.equal(await tile("rl").locator("img").count(), 0, "the letter while it is fetched");
    assert.equal(await tile("rl").innerText(), "R");
    release();
    const img = tile("rl").locator('img[alt="Rogue Legend"]');
    await img.waitFor();
    await page.waitForFunction(
      `document.querySelector('article[aria-labelledby="t-rl"] img')?.naturalWidth === 128`,
    );
    const box = await img.boundingBox();
    const tileBox = await tile("rl").boundingBox();
    assert.deepEqual([box?.width, box?.height], [tileBox?.width, tileBox?.height], "same size");
    assert.equal(
      await img.evaluate((i) => getComputedStyle(i).borderRadius),
      "10px",
      "rounded square",
    );
    // An icon that cannot be loaded: the letter tile stays.
    await page.waitForFunction(`!document.querySelector('article[aria-labelledby="t-gone"] img')`);
    assert.equal(await tile("gone").innerText(), "G");
    assert.deepEqual(asked, ['{"projectId":"rl"}'], "only the card without an icon asked");
  } finally {
    release();
    await browser.close();
  }
});
