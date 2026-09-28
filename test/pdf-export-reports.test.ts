import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { projectPaths } from "../src/config/load.ts";
import { exportReport } from "../src/export/job.ts";
import type { RenderRequest } from "../src/export/pdf.ts";
import {
  type ExportOptions,
  ExportOptionsSchema,
  exportOptions,
  parsePrintQuery,
  reportSource,
} from "../src/export/report-source.ts";
import { mainMarketRef } from "../src/reports/main-market.ts";
import { syncPresetReports } from "../src/reports/migrate.ts";
import { readDef, versionFileKey } from "../src/reports/store.ts";
import { buildPresetVersion } from "../src/reports/version.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { EXPORT_SCRIPT } from "../src/view/report-export.ts";
import { REPORT_LIST_SCRIPT } from "../src/view/report-list.ts";
import { reportPrintHtml } from "../src/view/report-print.ts";
import { tempProject } from "./helpers/project.ts";

/** The PDF export of one version of a report of the report list (R1 + R2). */
const OPTS: ExportOptions = { images: true, paper: "A4", landscape: true, hiddenSections: [] };
const CONFIG = (await tempProject({ Heroll: { phone: 1, tablet: 0 } })).config;

test("export per saved version: the version's own folder, name and date; unknown reports refused", async () => {
  const loaded = await tempProject({ Heroll: { phone: 2, tablet: 0 } });
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const vid = "2026-09-27T22-29-48-097Z-pilot";
  s.putText(versionFileKey(paths, vid, "report.md"), "# Old pilot\n");
  syncPresetReports(s, paths, mainMarketRef(loaded));
  const reqs: RenderRequest[] = [];
  const render = async (r: RenderRequest) => {
    reqs.push(r);
    return Buffer.from("%PDF-v");
  };
  const ref = { report: "r-pilot", version: vid };
  const r = exportReport(loaded, ref, OPTS, { origin: "x" }, { render });
  assert.ok(r.ok);
  const job = await r.done;
  assert.equal(job.state, "finished");
  assert.equal(job.fileName, "Pilot report 2026-09-27.pdf");
  assert.match(reqs[0]?.url ?? "", new RegExp(`report=r-pilot&version=${vid}&`));
  assert.equal([...s.list(`projects/${paths.projectId}/reports/${vid}/exports`)].length, 1);
  const other = exportReport(
    loaded,
    { report: "r-core", version: vid },
    OPTS,
    { origin: "x" },
    { render },
  );
  assert.equal(other.ok, false, "a version of another report");
  const gone = exportReport(
    loaded,
    { report: "r-nope", version: "now" },
    OPTS,
    { origin: "x" },
    { render },
  );
  assert.equal(gone.ok, false);
});

test("PDF defaults come from the Settings page; the dialog's choices win", async () => {
  const loaded = await tempProject({ Heroll: { phone: 2, tablet: 0 } });
  const config = {
    ...loaded.config,
    options: {
      ...loaded.config.options,
      pdf: { paper: "Letter" as const, orientation: "portrait" as const, images: false },
    },
  };
  assert.deepEqual(exportOptions(config, ExportOptionsSchema.parse({})), {
    images: false,
    paper: "Letter",
    landscape: false,
    hiddenSections: [],
  });
  assert.deepEqual(
    exportOptions(
      config,
      ExportOptionsSchema.parse({ paper: "A4", landscape: true, images: true }),
    ),
    { images: true, paper: "A4", landscape: true, hiddenSections: [] },
  );
  assert.deepEqual(exportOptions(loaded.config, ExportOptionsSchema.parse({})), OPTS);
});

test("each report card has Export PDF; the no-browser fallback opens that exact version's print page", () => {
  const ctx: Record<string, unknown> = {
    document: { addEventListener: () => {} },
    window: { addEventListener: () => {} },
    URLSearchParams,
  };
  runInNewContext(`${EXPORT_SCRIPT}\nthis.url = pdfPrintUrl;`, ctx);
  const url = (ctx as { url: (r: unknown, o: unknown) => string }).url(
    { report: "r-pilot", version: "2026-09-27T22-29-48-097Z-pilot" },
    { images: false, hiddenSections: ["positions"] },
  );
  assert.match(url, /^report-print\.html\?.+#autoprint$/);
  const q = new URLSearchParams(url.slice(url.indexOf("?") + 1, url.indexOf("#")));
  assert.deepEqual(parsePrintQuery(CONFIG, q), {
    ref: { report: "r-pilot", version: "2026-09-27T22-29-48-097Z-pilot" },
    options: { images: false, paper: "A4", landscape: true, hiddenSections: ["positions"] },
  });
  assert.equal(
    parsePrintQuery(CONFIG, new URLSearchParams("report=r-pilot&version=now&images=nope")),
    null,
  );
  assert.equal(
    parsePrintQuery(CONFIG, new URLSearchParams("report=r-pilot&version=now"))?.options.images,
    true,
    "no images parameter: the Settings default",
  );
  assert.match(REPORT_LIST_SCRIPT, /b\("rc-pdf", "Export PDF"\)/);
  assert.match(REPORT_LIST_SCRIPT, /exportReportPdf\(\{ report: rid, version \}/);
  const page = reportPrintHtml({
    title: "Pilot report",
    kind: "Pilot",
    facts: [],
    data: null,
    html: "<p>x</p>",
    captions: {},
    images: true,
    hiddenSections: [],
    reportId: "r-pilot",
    stage: "pilot",
  });
  assert.match(page, /"reportId":"r-pilot"/);
  assert.match(page, /#autoprint/);
});

test("a version's saved research list is section 7 of its markdown and reaches the print page", async () => {
  const loaded = await tempProject({ Heroll: { phone: 2, tablet: 0 } });
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  syncPresetReports(s, paths, mainMarketRef(loaded));
  const def = readDef(s, paths, "r-pilot");
  assert.ok(def);
  const item = { id: "s-1", title: "Run the Full check", costText: "free", why: "Why." };
  buildPresetVersion(loaded, def, new Date("2026-09-28T10:00:00Z"), () => ({
    lines: ["1. **Run the Full check** (free). Why.", ""],
    saved: { items: [item] },
  }));
  const vid = readDef(s, paths, "r-pilot")?.versions.at(-1)?.id ?? "";
  const md = s.getText(versionFileKey(paths, vid, "report.md")) ?? "";
  assert.match(
    md,
    /## 7\. What to research next\n\n1\. \*\*Run the Full check\*\*[\s\S]*## 8\. Detailed/,
  );
  const src = reportSource(loaded, { report: "r-pilot", version: vid }, OPTS);
  assert.ok("page" in src);
  assert.deepEqual(src.page.research, { items: [item] });
  assert.match(reportPrintHtml(src.page), /"research":\{"items":\[\{"id":"s-1"/);
});
