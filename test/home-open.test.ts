import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser, Page, Route } from "playwright-core";
import { NoBrowserError, startBrowser } from "../src/export/pdf.ts";
import { homeHtml } from "../src/view/home-html.ts";

// The home page in a real browser, with the tool's answers scripted: each card has one button,
// Open, and no request of its own; opening a project takes one press, even when the cards are
// refreshed while the project page is still loading.
const ORIGIN = "http://tool.test";
const PROJECT = {
  id: "rl",
  name: "Rogue Legends",
  ourAppId: "com.example.rl",
  archived: false,
  competitors: 5,
  countries: 9,
  summary: { stage: "recommendations", line: "Full check done: optimised (92%)" },
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
    // The project page is slow to come.
    if (path === "/p/rl/") {
      await hold;
      return r.fulfill({ contentType: "text/html", body: "<title>Project</title>" });
    }
    return r.fulfill({ status: 404, body: "" });
  });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("home: each card has one button, Open, and asks the tool for nothing more", async (t) => {
  const browser = await browserOrSkip(t);
  if (!browser) return;
  try {
    const page = await browser.newPage();
    const hits: Record<string, number> = {};
    await homePage(page, hits, Promise.resolve());
    await page.goto(`${ORIGIN}/`);
    await page.locator('#cards a.btn.primary[href="/p/rl/"]').waitFor();
    await pause(300);
    const controls = await page
      .locator("#cards a, #cards button")
      .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
    assert.deepEqual(controls, ["Open"], "the card has other buttons");
    const text = (await page.locator("#cards article").textContent()) ?? "";
    assert.match(text, /Rogue Legends/);
    assert.match(text, /com\.example\.rl · 5 competitors · 9 countries/);
    assert.match(text, /Recommendations ready\s*Full check done: optimised \(92%\)/);
    assert.doesNotMatch(text, /Next:|Archive|Create a report|See the suggestions/);
    const perCard = Object.keys(hits).filter((p) => p.startsWith("/p/rl/"));
    assert.deepEqual(perCard, [], "the card asked the tool for more");
  } finally {
    await browser.close();
  }
});

// Playwright cannot run code in a page whose navigation is pending, so the page checks itself
// while the project page loads and keeps what it saw for after the navigation.
const CHECK_WHILE_OPENING = `window.addEventListener("click", () => setTimeout(async () => {
  const seen = (a) => ({ text: a.textContent, busy: a.getAttribute("aria-busy") });
  const first = seen(document.querySelector('a[href="/p/rl/"]'));
  // The cards are refreshed (a run ended): Open must still say it is opening.
  loadProjects();
  render();
  await new Promise((r) => setTimeout(r, 50));
  const link = document.querySelector('a[href="/p/rl/"]');
  const after = seen(link);
  const controls = [...document.querySelectorAll("#cards a, #cards button")].map((a) => a.textContent.trim());
  // A second press, on the link.
  link.click();
  sessionStorage.setItem("seen", JSON.stringify({ first, after, controls }));
  fetch("/checked");
}, 50), { once: true });`;

test("home: one press on Open opens the project; a refresh keeps it opening", async (t) => {
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
    await open.waitFor();
    await page.evaluate(CHECK_WHILE_OPENING);
    await open.click({ noWaitAfter: true });
    for (let i = 0; i < 100 && !hits["/checked"]; i++) await pause(50);
    await pause(200);
    release();
    await page.waitForURL(`${ORIGIN}/p/rl/`);
    const seen = JSON.parse(String(await page.evaluate("sessionStorage.getItem('seen')")));
    assert.deepEqual(seen.first, { text: "Opening...", busy: "true" }, "Open shows it is opening");
    assert.deepEqual(seen.after, { text: "Opening...", busy: "true" }, "the refresh said Open");
    assert.deepEqual(seen.controls, ["Opening..."], "the card changed after Open");
    assert.equal(hits["/p/rl/"], 1, "the project page was asked for once, not again");
  } finally {
    release();
    await browser.close();
  }
});
