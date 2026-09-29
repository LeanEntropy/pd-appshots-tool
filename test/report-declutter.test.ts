import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { buildReportData } from "../src/analysis/report-data.ts";
import { reportInputs } from "../src/analysis/report-inputs.ts";
import { runAnalysis } from "../src/analysis/run.ts";
import { coreDeck, savePick } from "../src/core/selection.ts";
import type { CountryReport } from "../src/reports/country-report-types.ts";
import { reportApproval } from "../src/reports/report-job.ts";
import { REPORT_SCRIPT } from "../src/view/gallery-report.ts";
import { REPORT_PARTS_SCRIPT } from "../src/view/gallery-report-parts.ts";
import { REPORT_SUMMARY_SCRIPT } from "../src/view/report-summary.ts";
import {
  japanProject,
  japanReport,
  latestCountry,
  renderCountry,
  run,
} from "./helpers/country-run.ts";
import { fakeProvider } from "./helpers/fake-provider.ts";
import { tempProject } from "./helpers/project.ts";
import { reportFake } from "./helpers/report-fakes.ts";

/** What a reader sees without opening anything: every closed <details> keeps only its summary. */
function openView(html: string): string {
  const out: string[] = [];
  const re = /<details\b[^>]*>|<\/details>|<summary\b[^>]*>|<\/summary>/g;
  const stack: { open: boolean; inSummary: boolean }[] = [];
  const shown = () => stack.every((s) => s.open || s.inSummary);
  let last = 0;
  for (const m of html.matchAll(re)) {
    if (shown()) out.push(html.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("<details")) stack.push({ open: /\sopen[\s>]/.test(t), inSummary: false });
    else if (t === "</details>") stack.pop();
    else if (t.startsWith("<summary")) {
      const top = stack[stack.length - 1];
      if (top) top.inSummary = true;
    } else {
      const top = stack[stack.length - 1];
      if (top) top.inSummary = false;
    }
    last = (m.index ?? 0) + t.length;
  }
  if (shown()) out.push(html.slice(last));
  return out.join("");
}

async function pilotHtml(): Promise<string> {
  const loaded = await tempProject({
    "Archero 2": { phone: 3, tablet: 0 },
    "Capybara Go": { phone: 3, tablet: 0 },
  });
  savePick(loaded, ["com.xq.archeroii", "com.habby.capybara"], "cli");
  const ours = new Set(
    (coreDeck(loaded, loaded.config.ourApp.id)?.slots ?? []).map((s) => s.imageId),
  );
  const read = (path: string) => {
    const id = /[0-9a-f]{64}/.exec(path.replace(/\\/g, "/"))?.[0] ?? "";
    return { screenType: ours.has(id) ? "title_image" : "gameplay", headline: "FIGHT" };
  };
  await runAnalysis(loaded, buildAnalysisPlan(loaded, "pilot"), {
    producer: fakeProvider({ read }),
    reviewer: null,
    adjudicator: fakeProvider({ read }),
    writer: fakeProvider({ read }),
    recommendationReviewer: null,
    abWriter: fakeProvider({ read }),
    onProgress: () => {},
  });
  const data = buildReportData(reportInputs(loaded, "pilot"));
  // A cross-check, as the recommendation reviewer saves it.
  if (data.ai) {
    data.ai.review = {
      verdict: "ok",
      findings: [
        { severity: "minor", position: 1, issue: "Review finding.", suggestion: "Do it." },
      ],
    } as unknown as NonNullable<typeof data.ai>["review"];
  }
  const ctx: Record<string, unknown> = {
    IMG: "../images/",
    esc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    infoBtn: () => "",
    storeTextHtml: () => "<p>STORE TABLE</p>",
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { addEventListener: () => {}, getElementById: () => null },
  };
  runInNewContext(
    `${REPORT_SCRIPT}\n${REPORT_PARTS_SCRIPT}\n${REPORT_SUMMARY_SCRIPT}\nthis.render = renderReport;`,
    ctx,
  );
  const box = { innerHTML: "", classList: { toggle: () => {} } };
  (ctx.render as (b: typeof box, d: unknown, r: string, s: string, x: string) => void)(
    box,
    data,
    "r-pilot",
    "pilot",
    "<ol><li>RESEARCH ITEM</li></ol>",
  );
  return box.innerHTML;
}

test("Pilot and Full check: essentials open, method notes and long specs folded", async () => {
  const html = await pilotHtml();
  const open = openView(html);
  // Essentials: the verdict, key points and recommendations, the A/B test cards, the tables.
  assert.match(open, /class="vword"/);
  assert.match(open, /Key points to optimise/);
  assert.match(open, /<div class="abcard/);
  assert.match(open, /table class="rt fit"/);
  assert.match(open, /table class="rt pos"/);
  // The sample-size caveat once, in the verdict line.
  assert.equal(open.match(/small sample/g)?.length, 1);
  assert.match(open, /class="meta">\d+ of \d+ pattern points · 2 competitors \(a small sample/);
  // Moved into folds: method notes, definitions, dates, the cross-check, each slot's spec.
  for (const noise of [
    /Computed from \d+ of \d+ screenshots/,
    /Row N shows/,
    /partial pattern\)/,
    /What it is<\/th>/,
    /Analyses as of/,
    /Cross-check of the recommendations<\/h3>|Verdict: no major problems/,
    /Screen to capture<\/dt>/,
    /Setup:<\/strong>/,
    /STORE TABLE/,
    /RESEARCH ITEM/,
    /\(United States \(English\)\): /,
  ])
    assert.doesNotMatch(open, noise, String(noise));
  // Still in the report, behind folds (and so in the PDF, which opens every fold).
  for (const kept of [
    /Computed from \d+ of \d+ screenshots/,
    /Row N shows/,
    /Analyses as of/,
    /Review finding\./,
    /Screen to capture<\/dt>/,
    /STORE TABLE/,
    /What do these types mean\?/,
  ])
    assert.match(html, kept, String(kept));
});

async function japanVersion(): Promise<CountryReport> {
  const loaded = await japanProject();
  const def = japanReport(loaded);
  const a = reportApproval(loaded, def);
  assert.ok(!("problem" in a));
  const r = run(loaded, def.id, a.plan.planHash, reportFake());
  assert.ok(r.ok);
  await r.done;
  return latestCountry(loaded, def.id);
}

test("One country and Compare countries: essentials open, details folded", async () => {
  const one = await japanVersion();
  const jp = one.countries[0];
  assert.ok(jp);
  const kr = { ...structuredClone(jp), gl: "kr", hl: "ko", label: "South Korea", isMain: false };
  const compare: CountryReport = { ...one, type: "compare", countries: [jp, kr] };
  for (const [c, multi] of [
    [one, false],
    [compare, true],
  ] as const) {
    const html = renderCountry(c, true);
    const open = openView(html);
    assert.match(open, /class="vcard/);
    assert.match(open, /What to change, most important first/);
    assert.match(open, /table class="rt pos"/);
    assert.equal(open.match(/small sample/g)?.length ?? 0, open.includes("small sample") ? 1 : 0);
    assert.equal(/role="tablist"/.test(open), multi);
    for (const noise of [
      /Analyses as of/,
      /computed gap/,
      /Screen to capture<\/th>/,
      /Second opinion:/,
      /Computed from \d+ of \d+ screenshots/,
      /partial pattern\)/,
      /For each localisation habit/,
      /Localised experiment for/,
    ])
      assert.doesNotMatch(open, noise, String(noise));
    assert.match(html, /Analyses as of/);
    assert.match(html, /Screen to capture<\/th>/);
    // The per-country patterns link to the report's one "How we sort images".
    assert.match(open, /data-goto="rep-r-japan-1-sorting">What do these types mean\?/);
  }
});
