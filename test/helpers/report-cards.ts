/** The Reports tab's cards in a sandbox (report-cards tests): sample reports and a fake page. */
import { runInNewContext } from "node:vm";
import type { ReportSummary } from "../../src/reports/list.ts";
import { FLAG_SCRIPT } from "../../src/view/flags.ts";
import { EXPAND_SCRIPT } from "../../src/view/gallery-expand.ts";
import { REPORT_SCRIPT } from "../../src/view/gallery-report.ts";
import { BUILDER_SCRIPT } from "../../src/view/report-builder.ts";
import { REPORT_CARDS_SCRIPT } from "../../src/view/report-cards.ts";
import { REPORT_LIST_SCRIPT } from "../../src/view/report-list.ts";
import { REPORT_ROW_SCRIPT } from "../../src/view/report-list-row.ts";

export const rep = (o: Partial<ReportSummary> & { id: string }): ReportSummary => ({
  name: o.id,
  type: "country",
  typeName: "One country",
  countries: "Japan",
  markets: ["jp"],
  countryNames: ["Japan"],
  countryLabels: ["Japan"],
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

export const PILOT = rep({
  id: "r-pilot",
  name: "Pilot report",
  type: "pilot",
  typeName: "Pilot",
  markets: ["us"],
  countryNames: ["United States"],
  countryLabels: ["United States"],
  deletable: false,
  canNow: true,
});
export const CORE = rep({
  id: "r-core",
  name: "Full check report",
  type: "core",
  typeName: "Full check",
  markets: ["us"],
  countryNames: ["United States"],
  countryLabels: ["United States"],
  deletable: false,
  canNow: true,
  generatedAt: "2026-09-27T10:00:00.000Z",
});
export const cmp = (id: string, o: Partial<ReportSummary> = {}) =>
  rep({
    id,
    type: "compare",
    typeName: "Compare countries",
    markets: ["jp", "kr"],
    countryNames: ["Japan", "South Korea"],
    countryLabels: ["Japan", "South Korea"],
    ...o,
  });
// The server's order: drafts first, then newest first.
export const LIST = [
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
    countryLabels: ["South Korea"],
    countries: "South Korea",
  }),
  cmp("r-cmp-old", {
    name: "Japan, South Korea vs 2 (old)",
    generatedAt: "2026-09-20T10:00:00.000Z",
  }),
];

export function page(opts: { hash?: string; kept?: string } = {}) {
  const boxes: Record<string, { innerHTML: string }> = {
    reportCards: { innerHTML: "" },
    reportList: { innerHTML: "" },
  };
  const store = new Map<string, string>(opts.kept ? [["ssr.report.open:/p/x/api", opts.kept]] : []);
  const hashes: string[] = [];
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
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
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        listeners[type] = [...(listeners[type] ?? []), fn];
      },
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
  // A dropdown choice, as the browser sends it.
  const choose = (group: string, value: string) => {
    const target = {
      classList: { contains: (c: string) => c === "rt-sel" },
      dataset: { group },
      value,
    };
    for (const fn of listeners.change ?? []) fn({ target });
  };
  return { t, boxes, store, hashes, choose };
}

export const titles = (html: string) =>
  [...html.matchAll(/<h4>(.*?)<\/h4>/g)].map((m) => (m[1] ?? "").replace(/<[^>]+>/g, ""));
