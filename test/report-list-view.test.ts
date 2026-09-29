import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { ReportSummary } from "../src/reports/list.ts";
import { FLAG_SCRIPT } from "../src/view/flags.ts";
import { NAV_SCRIPT } from "../src/view/gallery-nav.ts";
import { REPORT_SCRIPT } from "../src/view/gallery-report.ts";
import { REPORT_PARTS_SCRIPT } from "../src/view/gallery-report-parts.ts";
import { REPORT_LIST_SCRIPT } from "../src/view/report-list.ts";
import { REPORT_ROW_SCRIPT } from "../src/view/report-list-row.ts";
import { REPORTS_A_CSS } from "../src/view/report-style-a.ts";
import { REPORT_SUMMARY_SCRIPT } from "../src/view/report-summary.ts";

type Box = { innerHTML: string; classList: { toggle: () => void } };

function page() {
  const ctx: Record<string, unknown> = {
    IMG: "../images/",
    API: "/p/x/api",
    esc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    actEsc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    infoBtn: (id: string) => `<button class="info" data-info="${id}">i</button>`,
    storeTextHtml: () => "",
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { addEventListener: () => {}, getElementById: () => null },
    location: { hash: "", protocol: "file:" },
  };
  runInNewContext(
    `${FLAG_SCRIPT}\n${REPORT_SCRIPT}\n${REPORT_PARTS_SCRIPT}\n${REPORT_SUMMARY_SCRIPT}\n${REPORT_ROW_SCRIPT}\n${REPORT_LIST_SCRIPT}\nthis.renderReport = renderReport; this.card = reportCardHtml;`,
    ctx,
  );
  // The words as read: the country flag markup (tested in flags.test.ts) is left out here.
  const card = ctx.card as (r: ReportSummary) => string;
  ctx.rawCard = card;
  ctx.card = (r: ReportSummary) =>
    card(r).replace(/<span class="cty">(?:<img[^>]*>)?([^<]*)<\/span>/g, "$1");
  return ctx as typeof ctx & {
    renderReport: (box: Box, d: unknown, rid: string, stage: string, research?: string) => void;
    card: (r: ReportSummary) => string;
    rawCard: (r: ReportSummary) => string;
  };
}

const data = {
  games: [{ name: "Ours", ours: true, rows: [] }],
  oursVs: null,
  coverage: { used: 0, total: 0, missing: [] },
  ai: null,
  fit: null,
  synthesis: { state: "missing", reason: "r", howTo: "h" },
  approved: true,
  leftOut: [],
  patterns: null,
  examples: {},
};

const summary = (o: Partial<ReportSummary>): ReportSummary => ({
  id: "r-pilot",
  name: "Pilot report",
  type: "pilot",
  typeName: "Pilot",
  countries: "United States (English)",
  markets: ["us"],
  countryNames: ["United States"],
  countryLabels: ["United States"],
  sameAs: null,
  competitors: 2,
  competitorNames: ["Archero 2", "Capybara Go"],
  generatedAt: "2026-09-27T22:29:48.097Z",
  status: { kind: "ready", text: "Ready" },
  newer: null,
  archived: false,
  deletable: false,
  canNow: true,
  versions: [
    {
      id: "2026-09-27T22-29-48-097Z-pilot",
      generatedAt: "2026-09-27T22:29:48.097Z",
      archived: false,
      format: "data",
    },
    {
      id: "2026-09-27T16-56-00-426Z-pilot",
      generatedAt: "2026-09-27T16:56:00.426Z",
      archived: true,
      format: "markdown",
    },
  ],
  ...o,
});

const ids = (html: string) => [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);

test("two open reports never share an element id", () => {
  const p = page();
  const box = (): Box => ({ innerHTML: "", classList: { toggle: () => {} } });
  const a = box();
  const b = box();
  p.renderReport(a, data, "r-pilot", "pilot");
  p.renderReport(b, data, "r-core", "core");
  const ia = ids(a.innerHTML);
  const ib = ids(b.innerHTML);
  assert.ok(ia.length >= 6);
  assert.deepEqual(
    ia.filter((x) => ib.includes(x)),
    [],
  );
  assert.match(a.innerHTML, /data-goto="rep-r-pilot-patterns"/);
  assert.match(b.innerHTML, /class="primary reportApprove" data-stage="core"/);
  const ca = ids(p.card(summary({})));
  const cb = ids(p.card(summary({ id: "r-core", type: "core", typeName: "Full check" })));
  assert.deepEqual(
    ca.filter((x) => cb.includes(x)),
    [],
  );
});

test("What to research next is numbered 7, before the statistics, only when given", () => {
  const p = page();
  const box = (): Box => ({ innerHTML: "", classList: { toggle: () => {} } });
  const a = box();
  p.renderReport(a, data, "r-core", "core", "<ol><li>Run it</li></ol>");
  const titles = [...a.innerHTML.matchAll(/class="secno">(\d+)\.<\/span> ([^<]+)</g)].map(
    (m) => `${m[1]} ${m[2]}`,
  );
  assert.deepEqual(titles.slice(-3), [
    "6 Store text and keywords",
    "7 What to research next",
    "8 Detailed statistics",
  ]);
  assert.match(a.innerHTML, /data-goto="rep-r-core-research">What to research next/);
  const b = box();
  p.renderReport(b, data, "r-core", "core", "");
  assert.doesNotMatch(b.innerHTML, /What to research next/);
  assert.match(b.innerHTML, /class="secno">7\.<\/span> Detailed statistics/);
});

test("the shown report shows its facts and offers the right actions", () => {
  const p = page();
  const pilot = p.card(summary({ newer: "New or updated analyses since this version was made." }));
  assert.match(pilot, /^<section class="rcard t-pilot"/);
  assert.match(pilot, /<span class="rc-name">Pilot report<\/span>/);
  assert.match(
    pilot,
    /<span class="rc-desc">Pilot \u00b7 United States \(English\) \u00b7 2 competitors: Archero 2, Capybara Go \u00b7 [^<]*2026[^<]*<\/span>/,
  );
  assert.match(pilot, />Newer data</);
  // Flags in the card title only; the description names the countries without flags.
  const cmp = p.rawCard(
    summary({
      name: "Japan and Korea",
      type: "compare",
      typeName: "Compare countries",
      countries: "Japan, South Korea, Taiwan, Hong Kong",
    }),
  );
  assert.match(cmp, /<span class="rc-name"><span class="cty">Japan<\/span> and /);
  assert.match(
    cmp,
    /<span class="rc-desc">Compare countries · Japan, South Korea, Taiwan, Hong Kong ·/,
  );
  assert.doesNotMatch(cmp.split('class="rc-desc"')[1] ?? "", /class="cty"/);
  assert.match(pilot, /<option value="now">Now/);
  assert.match(
    pilot,
    /<optgroup label="Earlier versions \(archived\)"><option value="2026-09-27T16-56-00-426Z-pilot">[^<]*\(older format\)/,
  );
  assert.doesNotMatch(pilot, /rc-delete/, "the Pilot cannot be deleted");
  assert.match(pilot, /can be archived, not deleted/);
  const mine = p.card(
    summary({
      id: "r-jp-1",
      name: "<img src=x>",
      type: "country",
      typeName: "One country",
      deletable: true,
      canNow: false,
      archived: true,
    }),
  );
  assert.match(mine, /class="rc-delete danger"/);
  assert.match(mine, />Restore</);
  assert.doesNotMatch(mine, /<img src=x>/);
  assert.doesNotMatch(mine, /value="now"/);
});

test("the open page's step bar follows the saved reports without a reload", async () => {
  const bar = { innerHTML: "<li>old</li>" };
  const ctx: Record<string, unknown> = {
    API: "/p/x/api",
    esc: (s: unknown) => String(s),
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { addEventListener: () => {}, getElementById: () => null, querySelector: () => bar },
    getJson: async (url: string) => {
      assert.equal(url, "/p/x/api/state");
      return {
        steps: [
          { label: "Core check", state: "done" },
          { label: "Recommendations", state: "done" },
        ],
      };
    },
  };
  runInNewContext(`${REPORT_SCRIPT}\n${REPORT_LIST_SCRIPT}\nthis.refresh = refreshSteps;`, ctx);
  await (ctx.refresh as () => Promise<void>)();
  assert.equal(
    bar.innerHTML,
    '<li class="done">Core check<span class="sr"> (done)</span></li><li class="done">Recommendations<span class="sr"> (done)</span></li>',
  );
});

test("the menu keeps #report/<id> deep links on the Report page", () => {
  const ctx: Record<string, unknown> = { window: { addEventListener: () => {} } };
  runInNewContext(`${NAV_SCRIPT}\nthis.f = pageFromHash;`, ctx);
  const f = ctx.f as (h: string) => string;
  assert.equal(f("#report/r-pilot"), "report");
  assert.equal(f("#report"), "report");
});

test("the Reports tab look: an open card's header band holds the bar, sections carry their kind", () => {
  const p = page();
  const card = p.card(summary({}));
  assert.match(card, /<div class="rc-b"><div class="rc-top"><div class="rc-bar">/);
  assert.match(card, /id="rh-r-pilot"><\/p><\/div><div class="rbox" id="rb-r-pilot">/);
  const box: Box = { innerHTML: "", classList: { toggle: () => {} } };
  p.renderReport(box, data, "r-core", "core", "<ol><li>Run it</li></ol>");
  const kinds = [
    ...box.innerHTML.matchAll(/<details class="sec[^"]*"[^>]* data-sec="([a-z]+)"/g),
  ].map((m) => m[1]);
  assert.deepEqual(kinds, [
    "summary",
    "patterns",
    "positions",
    "recs",
    "abtests",
    "store",
    "research",
    "stats",
  ]);
  // Scoped to the Reports tab: the other tabs and the print page keep their own styles.
  const rules = REPORTS_A_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@(media|container)[^{]*\{/g, "")
    .split("}")
    .map((r) => r.split("{")[0]?.trim() ?? "");
  for (const sel of rules.filter((r) => r && !r.startsWith(":root") && !r.startsWith("--"))) {
    for (const part of sel.split(/,(?![^(]*\))/))
      assert.match(part.trim(), /section\[data-page="report"\]/, `unscoped: ${part.trim()}`);
  }
  assert.doesNotMatch(REPORTS_A_CSS, /border-left:\s*[1-9]/, "no side bands");
});
