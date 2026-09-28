import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { renderGalleryHtml } from "../src/steps/deck-view.ts";
import { FLAG_SCRIPT } from "../src/view/flags.ts";
import { EXPAND_SCRIPT } from "../src/view/gallery-expand.ts";
import { REPORT_SCRIPT } from "../src/view/gallery-report.ts";
import { BUILDER_SCRIPT } from "../src/view/report-builder.ts";
import { BUILDER_REVIEW_SCRIPT } from "../src/view/report-builder-review.ts";
import { SUGGEST_SCRIPT } from "../src/view/report-suggest.ts";
import { tempProject } from "./helpers/project.ts";

type Ctx = Record<string, unknown> & {
  bld: Record<string, unknown>;
  builderHtml: () => string;
  needsHtml: (p: unknown) => string;
  reviewHtml: (p: unknown) => string;
  suggestionCard: (s: unknown) => string;
  raw_suggestionCard: (s: unknown) => string;
  researchHtml: (saved: unknown) => string;
  whatNextHtml: (o: unknown) => string;
};

function page(): Ctx {
  const ctx: Record<string, unknown> = {
    IMG: "../images/",
    API: "/p/x/api",
    esc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    actEsc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    money: (n: number) => `$${Number(n || 0).toFixed(2)}`,
    document: { addEventListener: () => {}, getElementById: () => null },
    window: { addEventListener: () => {} },
    location: { hash: "", protocol: "file:" },
    pageFromHash: () => "overview",
  };
  runInNewContext(
    `${FLAG_SCRIPT}\n${REPORT_SCRIPT}\n${BUILDER_SCRIPT}\n${BUILDER_REVIEW_SCRIPT}\n${SUGGEST_SCRIPT}\n${EXPAND_SCRIPT}\nthis.bld = bld; this.builderHtml = builderHtml; this.needsHtml = needsHtml; this.reviewHtml = reviewHtml; this.suggestionCard = suggestionCard; this.researchHtml = researchHtml; this.whatNextHtml = whatNextHtml;`,
    ctx,
  );
  // The words as read: the country flag markup (tested in flags.test.ts) is left out here.
  for (const k of ["builderHtml", "needsHtml", "reviewHtml", "suggestionCard", "whatNextHtml"]) {
    const f = ctx[k] as (...a: unknown[]) => string;
    ctx[`raw_${k}`] = f;
    ctx[k] = (...a: unknown[]) => unflag(f(...a));
  }
  return ctx as Ctx;
}

const unflag = (h: string) => h.replace(/<span class="cty">(?:<img[^>]*>)?([^<]*)<\/span>/g, "$1");

const US = { gl: "us", hl: "en", label: "United States (English)" };
const TW = { gl: "tw", hl: "zh-TW", label: "Taiwan" };
const closed = { open: false, reason: "Available after the Pilot." };
const opts = (open: boolean) => ({
  types: {
    pilot: { open: true, reason: "" },
    core: open ? { open: true, reason: "" } : closed,
    country: open ? { open: true, reason: "" } : closed,
    compare: open ? { open: true, reason: "" } : closed,
  },
  warning: open
    ? "Highly recommended: run the Full check of the United States first (8 competitors, about $7 to $13)."
    : null,
  main: US,
  markets: [US, TW],
  pick: ["a.app"],
  presets: { pilot: "r-pilot", core: "r-core" },
  ours: { appId: "ours.app", name: "Rogue <Legend>" },
  competitors: [
    { appId: "a.app", name: "Capybara Go", inPick: true, sold: { us: "ok", tw: "not-sold" } },
  ],
  charts: [],
});

test("builder: types greyed with the reason before the Pilot; availability and the Full check warning after", () => {
  const p = page();
  Object.assign(p.bld, { opts: opts(false), type: "pilot", markets: [], comps: [] });
  const before = p.builderHtml();
  assert.match(
    before,
    /value="compare" disabled> Compare countries <span class="meta">\(Available after the Pilot\.\)/,
  );
  assert.doesNotMatch(before, /Highly recommended/);
  Object.assign(p.bld, { opts: opts(true), type: "compare", markets: [US, TW], comps: ["a.app"] });
  const after = p.builderHtml();
  assert.match(after, /Highly recommended: run the Full check/);
  assert.match(after, /not sold in Taiwan/);
  assert.match(after, /Rogue &#60;Legend&#62; \(always included\)/, "names are escaped");
  assert.match(after, /used as the reference for what changed/);
});

const plan = {
  counts: { identical: 61, layerDiff: 38, full: 9, newImages: 47 },
  images: { usd: [2.1, 4.2] },
  text: {
    parts: [{ label: "Country advice (text only): 3 countries", usd: [0.4, 0.9] }],
    usd: [0.4, 0.9],
    later: true,
  },
  usd: [2.5, 5.1],
  limitUsd: 30,
  overLimit: false,
  drop: {
    leaveOut: [{ appId: "m", name: "Mini Tales", gl: "tw", country: "Taiwan" }],
    savesUsd: 4.1,
    fits: true,
  },
  cap: null,
  decks: [{ name: "Heroll", country: "Taiwan", state: "not-sold", orderDate: "2026-09-27" }],
  items: [
    {
      name: "Capybara Go",
      country: "Taiwan",
      gl: "tw",
      position: 2,
      tier: "layer-diff",
      thumb: "t/x.webp",
      reason: "same picture as the analysed image in the United States, new text",
    },
    {
      name: "Capybara Go",
      country: "Taiwan",
      gl: "tw",
      position: 3,
      tier: "full",
      thumb: null,
      reason: "no main-country version: full analysis",
    },
  ],
};

test("builder: what the report needs, the proposal to leave out, and the exact images (nothing is sent)", () => {
  const p = page();
  const html = p.needsHtml(plan);
  assert.match(
    html,
    /Already analysed or identical to an analysed image \(free\)<\/td><td class="n">61/,
  );
  assert.match(html, /Total about \$2\.50 to \$5\.10/);
  assert.match(
    html,
    /leave out Mini Tales in Taiwan, saves about \$4\.10\. <button type="button" id="bLeave">Leave these out/,
  );
  assert.match(html, /Heroll \(not sold in Taiwan\)/);
  const review = p.reviewHtml(plan);
  assert.match(review, /2 images<\/strong>: full analysis 9, text comparison 38/);
  assert.match(review, /#2 text comparison/);
  assert.match(review, /Nothing has been sent/);
  assert.doesNotMatch(review, /id="approve"/, "no paid step can start from this dialog");
});

test("suggestions and the report section: plain words, escaped, the buttons only open the builder", () => {
  const p = page();
  const card = p.suggestionCard({
    id: "s-0123456789ab",
    category: "localise",
    title: "A Japan <report>",
    why: "Competitors change 70% of their images in Japan.",
    what: "Japan: our game and 5 picked competitors",
    costText: "12 images, about $2.10 to $3.40",
    rankWhy: "High value; low cost: $2.75",
    older: true,
    action: { label: "Set up this report", scope: { type: "country" } },
    second: null,
  });
  assert.match(card, /A Japan &#60;report&#62;/);
  assert.match(card, /based on older data/);
  assert.match(card, /class="sgo primary"[^>]*>Set up this report/);
  assert.match(card, />Dismiss</);
  // Slim card: the chip and a short line up front, the rest behind a closed Details.
  const slim = p.raw_suggestionCard({
    id: "s-1",
    category: "localise",
    title: "A Japan report",
    short: "Competitors change 5 of 5 images here.",
    why: "Competitors change 5 of 5 images in Japan (long reason).",
    what: "Japan: our game and 5 picked competitors",
    costText: "12 images, about $2.10 to $3.40",
    costChip: "about $2.75",
    rankWhy: "High value",
    older: false,
    action: { label: "Set up this report", scope: { type: "country" } },
    second: { label: "Also this", scope: { type: "country" } },
  });
  assert.match(slim, /<span class="chip">about \$2\.75<\/span>/);
  assert.match(slim, /<p class="why">Competitors change 5 of 5 images here\.<\/p>/);
  assert.match(
    slim,
    /<details class="offer-more"><summary>Details<\/summary><p>Competitors change 5 of 5 images in Japan/,
  );
  assert.doesNotMatch(slim, /<details class="offer-more" open/);
  const [front, inside] = slim.split('<details class="offer-more">');
  assert.doesNotMatch(
    front ?? "",
    /Also this|12 images/,
    "second button and cost range only under Details",
  );
  assert.match(inside ?? "", /Also this/);
  // Flags only in titles, never in the running text.
  assert.equal((slim.match(/class="cty"/g) ?? []).length, 1);
  assert.match(front ?? "", /<h4>A <span class="cty">Japan<\/span> report<\/h4>/);
  const research = p.researchHtml({
    items: [{ id: "s-1", title: "Run the Full check", costText: "free", why: "Why." }],
  });
  assert.match(research, /What to research next/);
  assert.match(research, /Run the Full check<\/strong> \(free\)/);
  const next = p.whatNextHtml({ coreReady: false, main: US });
  assert.match(next, /Run the Full check/);
  assert.match(next, /Add more competitors in the United States/);
});

test("the served page carries the builder, the suggestions and a script that parses", async () => {
  const loaded = await tempProject({});
  const html = renderGalleryHtml(loaded, "t");
  assert.match(
    html,
    /<button type="button" id="newReport" class="primary">\+ New report<\/button>/,
  );
  assert.match(html, /<div id="builder" class="card noprint" hidden><\/div>/);
  assert.match(html, /<div id="suggestPanel" class="noprint"><\/div>/);
  const script = html.split("<script>")[1]?.split("</script>")[0] ?? "";
  assert.doesNotThrow(() => new Function(script));
});
