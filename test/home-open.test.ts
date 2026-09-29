import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser, Page, Route } from "playwright-core";
import { NoBrowserError, startBrowser } from "../src/export/pdf.ts";
import { homeHtml } from "../src/view/home-html.ts";

// The home page in a real browser, with the tool's answers scripted: opening a project takes
// one press, even when its card is refreshed while the project page is still loading.
const ORIGIN = "http://tool.test";
const PROJECT = {
  id: "rl",
  name: "Rogue Legends",
  ourAppId: "com.example.rl",
  archived: false,
  competitors: 5,
  countries: 9,
  summary: { stage: "core", line: "Core check ready" },
};
const STATE = {
  stage: "core",
  substate: "",
  line: "Core check ready",
  progress: null,
  next: { href: "/p/rl/views/gallery.html#core", label: "Continue" },
  notices: [],
  suggestion: null,
};

async function browserOrSkip(t: { skip: (m: string) => void }): Promise<Browser | null> {
  try {
    return (await startBrowser(null)) as unknown as Browser;
  } catch (e) {
    if (e instanceof NoBrowserError) t.skip("no Chrome or Edge on this machine");
    else throw e;
    return null;
  }
}

async function homePage(page: Page, hits: Record<string, number>, hold: Promise<void>) {
  const json = (r: Route, body: unknown) =>
    r.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  await page.route(`${ORIGIN}/**`, async (r) => {
    const u = new URL(r.request().url());
    const path = u.pathname + u.search;
    hits[path] = (hits[path] ?? 0) + 1;
    if (path === "/") return r.fulfill({ contentType: "text/html", body: homeHtml("t") });
    if (path === "/api/projects") return json(r, { projects: [PROJECT] });
    if (path === "/api/jobs") return json(r, { lanes: [] });
    if (path === "/api/import") return json(r, { found: [], importing: null });
    if (path === "/p/rl/api/state?home=1") return json(r, STATE);
    // The project page is slow to come (the tool works out the project's state first).
    if (path === "/p/rl/") {
      await hold;
      return r.fulfill({ contentType: "text/html", body: "<title>Project</title>" });
    }
    return r.fulfill({ status: 404, body: "" });
  });
}

// Playwright cannot run code in a page whose navigation is pending, so the page checks itself
// while the project page loads and keeps what it saw for after the navigation.
const CHECK_WHILE_OPENING = `window.addEventListener("click", () => setTimeout(async () => {
  const seen = (a) => ({ text: a.textContent, busy: a.getAttribute("aria-busy") });
  const first = seen(document.querySelector('a[href="/p/rl/"]'));
  // The card is refreshed (new state, polling): the Open link must still say it is opening.
  states.rl = { ...states.rl, line: "Core check: 3 new images" };
  render();
  loadState("rl");
  await new Promise((r) => setTimeout(r)); // as the user sees it: after the page's own updates
  const link = document.querySelector('a[href="/p/rl/"]');
  const after = seen(link);
  // A second press, on the refreshed link.
  link.click();
  sessionStorage.setItem("seen", JSON.stringify({ first, after }));
  fetch("/checked");
}, 50), { once: true });`;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("home: one press on Open opens the project; a card refresh keeps it opening", async (t) => {
  const browser = await browserOrSkip(t);
  if (!browser) return;
  let release = () => {};
  const hold = new Promise<void>((r) => {
    release = r;
  });
  try {
    const page = await browser.newPage();
    const hits: Record<string, number> = {};
    await homePage(page, hits, hold);
    await page.goto(`${ORIGIN}/`);
    const open = page.locator('#cards a.btn[href="/p/rl/"]');
    await page.locator('#cards a.btn[href="/p/rl/views/gallery.html#core"]').waitFor();
    await pause(300);
    assert.equal(
      hits["/p/rl/api/state?home=1"],
      1,
      "the card's state is asked for once, not twice",
    );

    // Refreshing a card that did not change leaves its buttons in place (a click is not lost).
    const before = await open.elementHandle();
    await page.evaluate("render()");
    assert.equal(await before?.evaluate((a) => a.isConnected), true, "the Open link was rebuilt");

    await page.evaluate(CHECK_WHILE_OPENING);
    await open.click({ noWaitAfter: true });
    for (let i = 0; i < 100 && !hits["/checked"]; i++) await pause(50);
    await pause(200);
    release();
    await page.waitForURL(`${ORIGIN}/p/rl/`);
    const seen = JSON.parse(String(await page.evaluate("sessionStorage.getItem('seen')")));
    assert.deepEqual(seen.first, { text: "Opening...", busy: "true" }, "Open shows it is opening");
    assert.deepEqual(
      seen.after,
      { text: "Opening...", busy: "true" },
      "the refresh said Open again",
    );
    assert.equal(hits["/p/rl/api/state?home=1"], 1, "no more state requests while opening");
    assert.equal(hits["/p/rl/"], 1, "the project page was asked for once, not again");
  } finally {
    release();
    await browser.close();
  }
});
