import assert from "node:assert/strict";
import { test } from "node:test";
import { countryMarkdown } from "../src/reports/country-md.ts";
import type { CountryReport } from "../src/reports/country-report-types.ts";
import { reportApproval } from "../src/reports/report-job.ts";
import {
  japanProject,
  japanReport,
  latestCountry,
  renderCountry,
  run,
} from "./helpers/country-run.ts";
import { reportFake } from "./helpers/report-fakes.ts";

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

/** The Japan version with a second country (South Korea) made from it: a compare report. */
function withKorea(c: CountryReport): CountryReport {
  const jp = c.countries[0];
  assert.ok(jp);
  const kr = { ...structuredClone(jp), gl: "kr", hl: "ko", label: "South Korea", isMain: false };
  const kp = "Opens with Title screen / full-screen art: 5 of 8 competitors; ours: Gameplay.";
  for (const x of [jp, kr]) if (x.data.fit) x.data.fit.keyPoints = [kp, ...x.data.fit.keyPoints];
  return { ...c, type: "compare", countries: [jp, kr] };
}

const inOrder = (s: string, parts: string[]) => {
  const at = parts.map((t) => s.indexOf(t));
  assert.ok(
    at.every((i, k) => i >= 0 && (k === 0 || i > (at[k - 1] as number))),
    JSON.stringify(at),
  );
};

test("the country report reads overall recommendations, contents, across countries, then per country", async () => {
  const c = await japanVersion();
  const html = renderCountry(c, true);
  const id = (s: string) => `id="rep-r-japan-1-${s}"`;
  inOrder(html, [
    id("summary"),
    'class="card toc ctoc"',
    id("across"),
    id("local"),
    id("abtests"),
    id("sorting"),
    id("countries"),
    "Recommendations",
    "Patterns and our fit",
    id("pos-jp"),
  ]);
  assert.match(html, /<span class="secno">1\.<\/span> Overall recommendations/);
  assert.match(html, /<span class="secno">3\.<\/span> Per country/);
  assert.match(html, /<img class="flag" alt="jp">Japan/);
  assert.match(html, /バトル開始/);
  assert.match(html, /battle start/);
  assert.match(html, /\[X\] different|\[V\] same/);
  assert.doesNotMatch(html, /\bC\d+\b/);
  // One country: no tabs, its panel shown.
  assert.doesNotMatch(html, /role="tablist"/);
  assert.doesNotMatch(renderCountry(c, false), /class="flag"/);
});

test("Per country is open, with one tab per country; the first is selected unless another is remembered", async () => {
  const c = withKorea(await japanVersion());
  const html = renderCountry(c, true);
  assert.match(html, /<details class="sec"[^>]* open data-sec="countries"/);
  assert.match(html, /role="tablist" aria-label="Countries"/);
  assert.equal(html.match(/role="tab" /g)?.length, 2);
  assert.match(html, /id="rep-r-japan-1-ctab-jp"[^>]*aria-selected="true" tabindex="0"/);
  assert.match(html, /id="rep-r-japan-1-ctab-kr"[^>]*aria-selected="false" tabindex="-1"/);
  assert.match(html, /role="tabpanel"[^>]*id="rep-r-japan-1-cpanel-jp">/);
  assert.match(html, /role="tabpanel"[^>]*id="rep-r-japan-1-cpanel-kr" hidden>/);
  assert.match(html, /id="rep-r-japan-1-pos-kr">Position by position/);
  assert.match(html, /data-cpart="pos">Position tables per country</);
  // The gap both countries have is listed once, across countries.
  assert.match(
    html,
    /<h3>Across countries<\/h3>[\s\S]*Opens with Title screen \/ full-screen art<\/strong> <span class="meta">all 2 countries/,
  );
  const kr = renderCountry(c, true, "kr");
  assert.match(kr, /id="rep-r-japan-1-ctab-kr"[^>]*aria-selected="true"/);
  assert.match(kr, /id="rep-r-japan-1-cpanel-jp" hidden>/);
});

test("the markdown (and PDF) keeps the same order and lists every country in sequence", async () => {
  const md = countryMarkdown(withKorea(await japanVersion()), ["1. Look at Vietnam."]);
  inOrder(md, [
    "## 1. Overall recommendations",
    "### Across countries",
    "### Key points per country",
    "## Contents",
    "## 2. Across countries",
    "### What to research next",
    "## 3. Per country",
    "\n### Japan",
    "\n### South Korea",
  ]);
  assert.match(md, /\*\*Opens with Title screen \/ full-screen art\*\* \(all 2 countries\)/);
});
