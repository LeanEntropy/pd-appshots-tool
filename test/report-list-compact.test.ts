import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { shortRange } from "../src/reports/builder-status.ts";
import type { ReportSummary } from "../src/reports/list.ts";
import { sameScope, scopeKey } from "../src/reports/same-scope.ts";
import type { ReportDef, ReportScope } from "../src/reports/types.ts";
import { FLAG_SCRIPT } from "../src/view/flags.ts";
import { REPORT_SCRIPT } from "../src/view/gallery-report.ts";
import { BUILDER_SCRIPT } from "../src/view/report-builder.ts";
import { REPORT_LIST_SCRIPT } from "../src/view/report-list.ts";
import { REPORT_ROW_SCRIPT } from "../src/view/report-list-row.ts";
import { REPORTS_A_CSS } from "../src/view/report-style-a.ts";

const m = (gl: string, hl: string, label: string) => ({ gl, hl, label });
const JP = m("jp", "ja", "Japan");
const KR = m("kr", "ko", "South Korea");
const TW = m("tw", "zh-TW", "Taiwan");
const HK = m("hk", "zh-TW", "Hong Kong (Traditional Chinese)");
const TH = m("th", "th", "Thailand");

const scope = (markets = [JP, KR, TW, HK, TH], competitors = ["a", "b"]): ReportScope => ({
  type: "compare",
  markets,
  competitors,
  includeCharts: [],
});
const def = (id: string, s: ReportScope, o: Partial<ReportDef> = {}): ReportDef => ({
  id,
  name: id,
  type: s.type,
  scope: s,
  createdAt: `2026-09-28T23:0${id.length % 10}:00.000Z`,
  archived: false,
  versions: [],
  ...o,
});

test("the same setup is found whatever the order; archived reports and presets never count", () => {
  assert.equal(scopeKey(scope()), scopeKey(scope([TH, HK, TW, KR, JP], ["b", "a"])));
  assert.notEqual(scopeKey(scope()), scopeKey(scope([JP, KR, TW, HK])));
  assert.notEqual(
    scopeKey(scope()),
    scopeKey({ ...scope(), leftOut: [{ appId: "a", gl: "jp" }] }),
    "games left out make a different setup",
  );
  const ran = def("r-ran", scope(), {
    versions: [{ id: "v-r-ran", generatedAt: "2026-09-28T23:20:48.061Z", archived: false }],
  });
  const defs = [
    ran,
    def("r-draft", scope([TH, JP, KR, TW, HK])),
    def("r-other", scope([JP, KR, TW, HK, m("id", "id", "Indonesia")])),
    def("r-old", scope(), { archived: true }),
  ];
  // Drafts first (the builder reopens one), then the reports that ran.
  assert.deepEqual(sameScope(defs, scope()), [
    { id: "r-draft", name: "r-draft", draft: true },
    { id: "r-ran", name: "r-ran", draft: false },
  ]);
  assert.deepEqual(
    sameScope(defs, scope(), "r-draft").map((x) => x.id),
    ["r-ran"],
  );
  assert.deepEqual(sameScope(defs, { ...scope(), type: "core" }), []);
});

test("a draft's cost is short: whole dollars from $10, cents below", () => {
  assert.equal(shortRange(15.62, 29.05), "~$16–29");
  assert.equal(shortRange(0.58, 1.53), "~$0.58–1.53");
  assert.equal(shortRange(2, 2), "~$2.00");
  assert.equal(shortRange(9.95, 10.05), "~$9.95–10", "each end rounded on its own");
});

function page() {
  const ctx: Record<string, unknown> = {
    esc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    actEsc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    document: { addEventListener: () => {}, getElementById: () => null },
    location: { hash: "", protocol: "file:" },
  };
  runInNewContext(
    `${FLAG_SCRIPT}\n${REPORT_SCRIPT}\n${REPORT_ROW_SCRIPT}\n${REPORT_LIST_SCRIPT}\nthis.card = reportCardHtml; this.shortTitle = shortTitle;`,
    ctx,
  );
  return ctx as typeof ctx & {
    card: (r: ReportSummary) => string;
    shortTitle: (r: Partial<ReportSummary>) => string;
  };
}

const partial: ReportSummary = {
  id: "r-japan-vs-8-competitors-3",
  name: "Japan, South Korea, Taiwan, Hong Kong, Thailand vs 8 competitors (2)",
  type: "compare",
  typeName: "Compare countries",
  countries: "Japan, South Korea, Taiwan, Hong Kong (Traditional Chinese), Thailand",
  markets: ["jp", "kr", "tw", "hk", "th"],
  countryNames: ["Japan", "South Korea", "Taiwan", "Hong Kong", "Thailand"],
  countryLabels: ["Japan", "South Korea", "Taiwan", "Hong Kong (Traditional Chinese)", "Thailand"],
  sameAs: "Japan, South Korea, Taiwan, Hong Kong, Thailand vs 8 competitors",
  competitors: 8,
  competitorNames: [],
  generatedAt: "2026-09-28T23:20:48.061Z",
  status: { kind: "partial", text: "Partial · 11 parts missing" },
  newer: null,
  archived: false,
  deletable: true,
  canNow: false,
  versions: [
    {
      id: "2026-09-28T23-20-48-061Z-r-japan-vs-8-competitors-3",
      generatedAt: "2026-09-28T23:20:48.061Z",
      archived: false,
      format: "data",
    },
  ],
};

test("the shown report's header band: full name, kind, status, date and description", () => {
  const p = page();
  assert.equal(
    p.shortTitle(partial),
    "Japan, South Korea, Taiwan +2 vs 8 competitors (2)",
    "more than three countries: the first three, then +N",
  );
  assert.equal(p.shortTitle({ ...partial, name: "My own name" }), "My own name");
  assert.equal(p.shortTitle({ ...partial, countryNames: ["Japan", "South Korea"] }), partial.name);
  const html = p.card(partial);
  assert.match(html, /^<section class="rcard t-compare" data-rid="r-japan-vs-8-competitors-3"/);
  const head = html.split('<div class="rc-b">')[0] ?? "";
  assert.match(
    head,
    /<div class="rc-head"><span class="rc-name">.*Thailand<\/span> vs 8 competitors \(2\)<\/span>/,
  );
  assert.match(head, />Partial · 11 parts missing</);
  assert.match(head, /class="pill same" title="Set up exactly like/);
  assert.match(head, /<span class="rc-date" title="[^"]+">[^<]*2026<\/span>/);
  assert.match(head, /class="rc-desc">Compare countries · Japan/);
  assert.doesNotMatch(head.split('class="rc-desc"')[1] ?? "", /class="cty"/);
  assert.doesNotMatch(html, /<details class="rcard|<summary/, "never folded");
  assert.match(REPORTS_A_CSS, /\.rc-head \{ gap: 8px; background: var\(--a-head\);/);
});

test("Delete asks in the page and says what is kept; no browser dialog", () => {
  const p = page();
  const html = p.card(partial);
  assert.match(html, /class="rc-delete danger"/);
  assert.match(
    html,
    /<div class="rc-del" id="rd-r-japan-vs-8-competitors-3" hidden[^>]*><p><strong>Delete “Japan, South Korea/,
  );
  assert.match(html, /Only this report and its version, with its written parts, will be removed/);
  assert.match(html, /stay in the shared library and are reused for free by later reports/);
  assert.match(
    html,
    /class="rc-delyes danger"[^>]*>Delete<\/button> <button type="button" class="rc-delno"/,
  );
  const draft = p.card({ ...partial, versions: [], status: { kind: "draft", text: "Draft" } });
  assert.match(draft, /Only this draft \(its saved choices; it has no written report yet\)/);
  assert.doesNotMatch(REPORT_LIST_SCRIPT, /confirm\(/);
  const running = p.card({ ...partial, status: { kind: "running", text: "Analysing 5 of 80" } });
  assert.doesNotMatch(running, /rc-delete|rc-del"/, "a running report offers no Delete");
  assert.match(running, /Stop the run before deleting this report/);
  const pilot = p.card({ ...partial, id: "r-pilot", type: "pilot", deletable: false });
  assert.doesNotMatch(pilot, /rc-del/, "the Pilot and Full check are archived, never deleted");
});

test("the builder says when a draft for this setup exists, and warns about a copy", () => {
  const box = { innerHTML: "" };
  const ctx: Record<string, unknown> = {
    esc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    document: {
      addEventListener: () => {},
      getElementById: (id: string) => (id === "bSame" ? box : null),
    },
  };
  runInNewContext(
    `${BUILDER_SCRIPT}\nthis.bld = bld; this.adoptDraft = adoptDraft; this.renderSame = renderSame;`,
    ctx,
  );
  const t = ctx as typeof ctx & {
    bld: Record<string, unknown>;
    adoptDraft: (d: { id: string; name: string }, keep: boolean) => void;
    renderSame: () => void;
  };
  t.adoptDraft({ id: "r-a-1", name: "Japan vs 8" }, false);
  t.bld.same = [
    { id: "r-a-1", name: "Japan vs 8", draft: true },
    { id: "r-a-2", name: "Japan vs 8 (2)", draft: false },
  ];
  t.renderSame();
  assert.equal(t.bld.id, "r-a-1");
  assert.match(box.innerHTML, /You already have a draft for this: “Japan vs 8”/);
  assert.match(box.innerHTML, /id="bSameOk">Continue</);
  assert.match(box.innerHTML, /“Japan vs 8 \(2\)” is set up exactly like this/);
  assert.doesNotMatch(box.innerHTML, /data-rid="r-a-1"/, "never points at itself");
  t.bld.adopted = null;
  t.bld.same = [];
  t.renderSame();
  assert.equal(box.innerHTML, "");
});
