import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { ReportSummary } from "../src/reports/list.ts";
import { NAV_SCRIPT } from "../src/view/gallery-nav.ts";
import { REPORT_SCRIPT } from "../src/view/gallery-report.ts";
import { REPORT_PARTS_SCRIPT } from "../src/view/gallery-report-parts.ts";
import { REPORT_LIST_SCRIPT } from "../src/view/report-list.ts";
import { REPORT_SUMMARY_SCRIPT } from "../src/view/report-summary.ts";

type Box = { innerHTML: string; classList: { toggle: () => void } };

function page() {
  const ctx: Record<string, unknown> = {
    IMG: "../images/",
    API: "/p/x/api",
    esc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    infoBtn: (id: string) => `<button class="info" data-info="${id}">i</button>`,
    storeTextHtml: () => "",
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { addEventListener: () => {}, getElementById: () => null },
    location: { hash: "", protocol: "file:" },
  };
  runInNewContext(
    `${REPORT_SCRIPT}\n${REPORT_PARTS_SCRIPT}\n${REPORT_SUMMARY_SCRIPT}\n${REPORT_LIST_SCRIPT}\nthis.renderReport = renderReport; this.card = reportCardHtml;`,
    ctx,
  );
  return ctx as typeof ctx & {
    renderReport: (box: Box, d: unknown, rid: string, stage: string) => void;
    card: (r: ReportSummary) => string;
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

test("a report card is folded, shows its facts, and offers the right actions", () => {
  const p = page();
  const pilot = p.card(summary({ newer: "New or updated analyses since this version was made." }));
  assert.match(pilot, /^<details class="rcard t-pilot"/);
  assert.doesNotMatch(pilot, /<details class="rcard[^>]*\bopen\b/, "folded");
  assert.match(pilot, /<span class="rc-name">Pilot report<\/span>/);
  assert.match(
    pilot,
    /<span class="rc-desc">Pilot \u00b7 United States \(English\) \u00b7 2 competitors: Archero 2, Capybara Go \u00b7 [^<]*2026[^<]*<\/span>/,
  );
  assert.match(pilot, />Newer data</);
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
