import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { ReportSummary } from "../src/reports/list.ts";
import { renderGalleryHtml } from "../src/steps/deck-view.ts";
import { FLAG_SCRIPT } from "../src/view/flags.ts";
import { EXPAND_SCRIPT } from "../src/view/gallery-expand.ts";
import { REPORT_SCRIPT } from "../src/view/gallery-report.ts";
import { BUILDER_SCRIPT } from "../src/view/report-builder.ts";
import { REPORT_CARDS_SCRIPT } from "../src/view/report-cards.ts";
import { REPORT_LIST_SCRIPT } from "../src/view/report-list.ts";
import { REPORT_ROW_SCRIPT } from "../src/view/report-list-row.ts";
import { tempProject } from "./helpers/project.ts";

const rep = (o: Partial<ReportSummary> & { id: string }): ReportSummary => ({
  name: o.id,
  type: "country",
  typeName: "One country",
  countries: "Japan",
  markets: ["jp"],
  countryNames: ["Japan"],
  sameAs: null,
  competitors: 2,
  competitorNames: [],
  generatedAt: "2026-09-28T10:00:00.000Z",
  status: { kind: "ready", text: "Ready" },
  newer: null,
  archived: false,
  deletable: true,
  canNow: false,
  versions: [
    { id: `v-${o.id}`, generatedAt: "2026-09-28T10:00:00.000Z", archived: false, format: "data" },
  ],
  ...o,
});

const PILOT = rep({
  id: "r-pilot",
  name: "Pilot report",
  type: "pilot",
  typeName: "Pilot",
  markets: ["us"],
  countryNames: ["United States"],
  deletable: false,
  canNow: true,
});
const CORE = rep({
  id: "r-core",
  name: "Full check report",
  type: "core",
  typeName: "Full check",
  markets: ["us"],
  countryNames: ["United States"],
  deletable: false,
  canNow: true,
  generatedAt: "2026-09-27T10:00:00.000Z",
});
const cmp = (id: string, o: Partial<ReportSummary> = {}) =>
  rep({
    id,
    type: "compare",
    typeName: "Compare countries",
    markets: ["jp", "kr"],
    countryNames: ["Japan", "South Korea"],
    ...o,
  });
// The server's order: drafts first, then newest first.
const LIST = [
  cmp("r-cmp-draft", {
    name: "Japan, South Korea vs 2",
    generatedAt: null,
    versions: [],
    status: { kind: "draft", text: "Draft" },
  }),
  rep({
    id: "r-jp-2",
    name: "Japan vs 2 (2)",
    generatedAt: "2026-09-29T10:00:00.000Z",
    status: { kind: "partial", text: "Partial · 3 parts missing" },
  }),
  PILOT,
  CORE,
  rep({ id: "r-jp-1", name: "Japan vs 2" }),
  rep({
    id: "r-kr",
    name: "South Korea vs 2",
    markets: ["kr"],
    countryNames: ["South Korea"],
    countries: "South Korea",
  }),
  cmp("r-cmp-old", {
    name: "Japan, South Korea vs 2 (old)",
    generatedAt: "2026-09-20T10:00:00.000Z",
  }),
];

function page(opts: { hash?: string; kept?: string } = {}) {
  const boxes: Record<string, { innerHTML: string }> = {
    reportCards: { innerHTML: "" },
    reportList: { innerHTML: "" },
  };
  const store = new Map<string, string>(opts.kept ? [["ssr.report.open:/p/x/api", opts.kept]] : []);
  const hashes: string[] = [];
  const location = { hash: "", protocol: "http:" };
  const ctx: Record<string, unknown> = {
    API: "/p/x/api",
    esc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    actEsc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
    history: {
      replaceState: (_s: unknown, _t: string, h: string) => {
        hashes.push(h);
        location.hash = h;
      },
    },
    document: {
      addEventListener: () => {},
      getElementById: (id: string) => boxes[id] ?? null,
      querySelector: () => null,
    },
    window: { addEventListener: () => {} },
    location,
    pageFromHash: (h: string) => (String(h).startsWith("#report") ? "report" : "overview"),
  };
  runInNewContext(
    `${FLAG_SCRIPT}\n${REPORT_SCRIPT}\n${BUILDER_SCRIPT}\n${REPORT_ROW_SCRIPT}\n${REPORT_LIST_SCRIPT}\n${REPORT_CARDS_SCRIPT}\n${EXPAND_SCRIPT}
this.setList = (l) => { reportList = l; }; this.render = renderReportList; this.open = () => openRid; this.forget = forgetOpen;
this.setNext = (o) => { whatNext = o; };`,
    ctx,
  );
  location.hash = opts.hash ?? "#report";
  const t = ctx as typeof ctx & {
    setList: (l: ReportSummary[]) => void;
    render: (deep?: string | null) => Promise<void>;
    open: () => string | null;
    forget: (rid: string) => void;
    setNext: (o: unknown) => void;
  };
  return { t, boxes, store, hashes };
}

const titles = (html: string) =>
  [...html.matchAll(/<h4>(.*?)<\/h4>/g)].map((m) => (m[1] ?? "").replace(/<[^>]+>/g, ""));

test("one card per report type: Full check first, the others by their newest report, the Pilot last", () => {
  const { t, boxes } = page();
  t.setList(LIST);
  t.render();
  const cards = boxes.reportCards?.innerHTML ?? "";
  assert.deepEqual(titles(cards), [
    "Full check",
    "Compare countries",
    "Japan",
    "South Korea",
    "Pilot",
  ]);
  // A one-country card carries the country's flag in its title.
  assert.match(
    cards,
    /<h4><span class="cty"><img class="flag"[^>]*src="\/flags\/jp.svg"[^>]*>Japan<\/span><\/h4>/,
  );
  assert.equal((cards.match(/class="rtcard /g) ?? []).length, 5);
  assert.equal((cards.match(/>Open<\/button>/g) ?? []).length, 5);
});

test("a dropdown only when a type has more than one report, newest first with date and status", () => {
  const { t, boxes } = page();
  t.setList(LIST);
  t.render();
  const cards = (boxes.reportCards?.innerHTML ?? "").split('<div class="rtcard ').slice(1);
  const withSel = cards.filter((c) => c.includes("<select"));
  assert.equal(withSel.length, 2, "Compare countries and Japan only");
  const japan = cards.find((c) => c.includes(">Japan</span></h4>")) ?? "";
  const opts = [...japan.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)</g)].map((m) => [
    m[1],
    m[2],
  ]);
  assert.deepEqual(
    opts.map((o) => o[0]),
    ["r-jp-2", "r-jp-1"],
  );
  assert.match(opts[0]?.[1] ?? "", /^Japan vs 2 \(2\) · [^·]*2026 · Partial$/);
  assert.match(opts[1]?.[1] ?? "", / · Ready$/);
  const compare = cards.find((c) => c.includes("<h4>Compare countries")) ?? "";
  assert.match(compare, /Not generated yet · Draft/);
  assert.match(compare, /class="pill none">Draft</, "the newest (the draft) is the default");
});

test("only one report is drawn: the newest one (Pilot only when alone), kept and in the hash", () => {
  const { t, boxes, store, hashes } = page();
  t.setList(LIST);
  t.render();
  const shown = boxes.reportList?.innerHTML ?? "";
  assert.equal((shown.match(/<section class="rcard /g) ?? []).length, 1);
  assert.match(shown, /id="rc-r-cmp-draft"/);
  assert.equal(t.open(), "r-cmp-draft");
  assert.equal(store.get("ssr.report.open:/p/x/api"), "r-cmp-draft");
  assert.equal(hashes.at(-1), "#report/r-cmp-draft");
  assert.match(shown, />Continue setting up</);
  assert.match(shown, /class="rc-delete danger"/);
  assert.match(boxes.reportCards?.innerHTML ?? "", /class="rtcard t-compare is-open"/);
  // The Pilot only when it is the only report.
  const one = page();
  one.t.setList([PILOT]);
  one.t.render();
  assert.match(one.boxes.reportList?.innerHTML ?? "", /id="rc-r-pilot"/);
});

test("the link wins, then the report kept in this browser; a removed report shows the next one", () => {
  const kept = page({ kept: "r-kr" });
  kept.t.setList(LIST);
  kept.t.render();
  assert.equal(kept.t.open(), "r-kr");
  const linked = page({ kept: "r-kr", hash: "#report/r-core" });
  linked.t.setList(LIST);
  linked.t.render("r-core");
  assert.equal(linked.t.open(), "r-core");
  // Deleted: the list no longer has it, and the default is shown instead.
  linked.t.forget("r-core");
  linked.t.setList(LIST.filter((r) => r.id !== "r-core"));
  linked.t.render();
  assert.equal(linked.t.open(), "r-cmp-draft");
  assert.doesNotMatch(linked.boxes.reportCards?.innerHTML ?? "", /<h4>Full check/);
  // Archived: hidden with the archived ones, so the next one shows.
  const arch = page({ kept: "r-kr" });
  arch.t.setList(LIST.map((r) => (r.id === "r-kr" ? { ...r, archived: true } : r)));
  arch.t.render();
  assert.equal(arch.t.open(), "r-cmp-draft");
  assert.match(arch.boxes.reportCards?.innerHTML ?? "", />Show archived \(1\)</);
});

test("the What next options follow the report cards in their own colour", () => {
  const { t, boxes } = page();
  t.setList(LIST);
  t.setNext({
    types: { country: { open: true } },
    coreReady: true,
    main: { gl: "us", hl: "en", label: "United States (English)" },
    pick: [],
  });
  t.render();
  const cards = boxes.reportCards?.innerHTML ?? "";
  assert.deepEqual(titles(cards).slice(-3), [
    "Pilot",
    "Compare countries",
    "Add more competitors in the United States",
  ]);
  assert.equal((cards.match(/class="rtcard rt-act /g) ?? []).length, 2);
  assert.equal((cards.match(/>Cost shown first</g) ?? []).length, 2);
});

test("the served Reports tab: cards row, no helper sentence, no What next block", async () => {
  const loaded = await tempProject({});
  const html = renderGalleryHtml(loaded, "t");
  assert.match(html, /<div id="reportCards" class="noprint"><\/div><div id="builder"/);
  assert.doesNotMatch(html, /All reports of this project|id="expansion"/);
  const script = html.split("<script>")[1]?.split("</script>")[0] ?? "";
  assert.doesNotThrow(() => new Function(script));
});
