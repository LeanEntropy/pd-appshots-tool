import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { latestFile } from "../src/analysis/final-report.ts";
import { analysisKey, currentPipeline } from "../src/analysis/pipeline.ts";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import type { ReportData } from "../src/analysis/report-data.ts";
import { buildReportData } from "../src/analysis/report-data.ts";
import { reportInputs } from "../src/analysis/report-inputs.ts";
import { runAnalysis } from "../src/analysis/run.ts";
import { projectPaths } from "../src/config/load.ts";
import { coreDeck, savePick } from "../src/core/selection.ts";
import { newerReason } from "../src/reports/stale.ts";
import { REPORT_SCRIPT } from "../src/view/gallery-report.ts";
import { REPORT_PARTS_SCRIPT } from "../src/view/gallery-report-parts.ts";
import { REPORT_SUMMARY_SCRIPT } from "../src/view/report-summary.ts";
import { fakeProvider } from "./helpers/fake-provider.ts";
import { tempProject } from "./helpers/project.ts";

const DECKS = {
  "Archero 2": { phone: 3, tablet: 0 },
  "Capybara Go": { phone: 3, tablet: 0 },
};
const PICK = ["com.xq.archeroii", "com.habby.capybara"];
const US = { gl: "us", hl: "en" };

async function setup() {
  const loaded = await tempProject(DECKS);
  savePick(loaded, PICK, "cli");
  const ours = new Set(
    (coreDeck(loaded, loaded.config.ourApp.id)?.slots ?? []).map((s) => s.imageId),
  );
  // Our deck leads with the title screen; the competitors lead with battle gameplay.
  const read = (path: string) => {
    const id = /[0-9a-f]{64}/.exec(path.replace(/\\/g, "/"))?.[0] ?? "";
    return { screenType: ours.has(id) ? "title_image" : "gameplay", headline: "FIGHT" };
  };
  const deps = () => ({
    producer: fakeProvider({ read }),
    reviewer: null,
    adjudicator: fakeProvider({ read }),
    writer: fakeProvider({ read }),
    recommendationReviewer: null,
    abWriter: fakeProvider({ read }),
    onProgress: () => {},
  });
  return { loaded, deps };
}

test("the per-image prompts and every analysis key are unchanged by the new voice", async () => {
  const loaded = await tempProject({});
  const spec = currentPipeline(loaded.config);
  assert.deepEqual(spec.prompts, {
    fullAnalysis: "full-analysis.v4",
    review: "full-analysis.v4",
    adjudicate: "adjudicate.v3",
  });
  // The key of the fixture project on master before the reports update (2026-09-28).
  assert.equal(analysisKey(spec), "6f6c9fd9c7bdae6f25fc5461930cbbe7");
});

test("a run writes the summary and the A/B tests first, in the page data and the markdown", async () => {
  const { loaded, deps } = await setup();
  const plan = buildAnalysisPlan(loaded, "pilot");
  assert.ok(plan.estimate.passes.some((p) => p.role === "A/B tests to run next" && p.calls === 1));
  const d = deps();
  const out = await runAnalysis(loaded, plan, d);
  assert.equal(d.abWriter.calls.length, 1, "one A/B call");
  assert.match(d.abWriter.calls[0]?.system.text ?? "", /Chief Marketing Officer/);
  const dir = join(projectPaths(loaded).reports, out.runId);
  assert.ok(existsSync(join(dir, "ab-tests.json")));
  const data = JSON.parse(readFileSync(join(dir, "report-data.json"), "utf8")) as ReportData;
  assert.ok(data.summary && data.abTests);
  assert.match(data.summary.shortAnswer, /^Our store page is /);
  assert.ok(data.summary.dates.generated);
  const tests = data.abTests.tests;
  assert.ok(tests.length >= 2 && tests.length <= 5);
  assert.equal(tests[0]?.source, "ai");
  assert.equal(tests[0]?.title, "Battle first");
  assert.deepEqual(tests[0]?.positions, [1]);
  assert.equal(tests[0]?.control.length, 3);
  assert.match(tests[0]?.setup.line ?? "", /Localised experiment for English/);
  const md = readFileSync(out.report, "utf8");
  assert.ok(md.indexOf("## 1. Summary: the bottom line") < md.indexOf("## Contents"));
  assert.ok(md.indexOf("### A/B tests to run next") < md.indexOf("## 2. Patterns"));
  assert.match(md, /### Test 1: Battle first/);
  assert.match(md, /Unique user install clicks/);

  // The page: the summary section comes first, before the contents; its cards link to the details.
  const ctx: Record<string, unknown> = {
    IMG: "../images/",
    esc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    infoBtn: () => "",
    storeTextHtml: () => "",
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { addEventListener: () => {}, getElementById: () => null },
  };
  runInNewContext(
    `${REPORT_SCRIPT}\n${REPORT_PARTS_SCRIPT}\n${REPORT_SUMMARY_SCRIPT}\nthis.render = renderReport;`,
    ctx,
  );
  const box = { innerHTML: "", classList: { toggle: () => {} } };
  (ctx.render as (b: typeof box, d: unknown, r: string, s: string) => void)(
    box,
    data,
    "r-pilot",
    "pilot",
  );
  const html = box.innerHTML;
  assert.ok(html.indexOf('id="rep-r-pilot-summary"') < html.indexOf('class="card toc"'));
  assert.match(html, /<div class="abcard"><h4><span class="abno">1<\/span>Battle first/);
  assert.match(html, /data-goto="rep-r-pilot-abt-1"/);
  assert.match(html, /id="rep-r-pilot-abt-1"/);
  assert.match(html, /id="rep-r-pilot-abtests"/);
});

test("AI parts from the older style: a text-only run with no image call rewrites them", async () => {
  const { loaded, deps } = await setup();
  const paths = projectPaths(loaded);
  const first = await runAnalysis(
    loaded,
    buildAnalysisPlan(loaded, "pilot", { save: true }),
    deps(),
  );
  // Pretend the run was written before the new voice: older prompt versions, older data hash.
  const vfile = join(paths.reports, first.runId, "version.json");
  const v = JSON.parse(readFileSync(vfile, "utf8"));
  v.versions.prompts = { ...v.versions.prompts, patterns: "patterns.v2", abTests: undefined };
  writeFileSync(vfile, JSON.stringify(v));
  const lf = latestFile(paths, "pilot");
  writeFileSync(lf, JSON.stringify({ ...JSON.parse(readFileSync(lf, "utf8")), dataHash: "old" }));
  const stale = buildReportData(reportInputs(loaded, "pilot"));
  assert.equal(stale.synthesis.state, "stale");
  assert.match(stale.synthesis.reason, /older style/);
  assert.match(stale.synthesis.howTo, /0 images/);
  assert.match(stale.abTests?.note ?? "", /older data/);
  // The report list's badge says so too, even though the analyses did not change.
  const x = reportInputs(loaded, "pilot");
  assert.match(newerReason(x, US, v, x.dataHash) ?? "", /older style/);

  const again = buildAnalysisPlan(loaded, "pilot");
  assert.equal(again.counts.newImages, 0);
  assert.equal(again.synthesisNeeded, true);
  const d = deps();
  const out = await runAnalysis(loaded, again, d);
  assert.equal(d.producer.calls.length, 0, "no image is analysed again");
  assert.ok(out.synthesis?.recommendations && out.synthesis.abTests);
  const now = buildReportData(reportInputs(loaded, "pilot"));
  assert.equal(now.synthesis.state, "current");
  assert.equal(now.abTests?.tests[0]?.source, "ai");
});
