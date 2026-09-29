import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCountries } from "../src/config/countries.ts";
import type { CountryReport } from "../src/reports/country-report-types.ts";
import { deriveCountry } from "../src/reports/derive-country.ts";
import { groupsPart } from "../src/reports/groups-part.ts";
import { renderCountry } from "./helpers/country-run.ts";
import { data, deck, PLAY, report } from "./helpers/groups-fixture.ts";
import { openView } from "./helpers/open-view.ts";

const US = { gl: "us", hl: "en", label: "United States (English)" };
const names = ["A", "B", "C", "D", "E", "F"];
const games = (gl: string, ours: boolean) => [
  deck("ours", "Rogue", { ids: `ours-${gl}`, titleArt: ours, logo: ours }, true),
  ...names.map((n, i) => deck(n, n, { ids: `${n}-${gl}`, titleArt: i < 4, logo: i < 4 })),
];

function compare(): CountryReport {
  const r = report([
    { gl: "jp", hl: "ja", label: "Japan", isMain: false, data: data(games("jp", false)) },
    { gl: "kr", hl: "ko", label: "South Korea", isMain: false, data: data(games("kr", false)) },
  ]);
  const groups = groupsPart({
    report: r,
    main: { market: US, games: games("us", true) },
    saved: undefined,
    regions: loadCountries().groupRegions,
    play: { ...PLAY, reportMarkets: [r.countries[0], r.countries[1]] as never },
  });
  return {
    ...r,
    groups,
    links: { countryReports: [{ gl: "jp", id: "r-cmp-1-jp" }] },
  } as CountryReport;
}

test("the comparison shows the group part first in Across countries, with sketches, numbers and flags only in headings", () => {
  const html = renderCountry(compare(), true);
  const across = html.indexOf('id="rep-r-japan-1-across"');
  const groups = html.indexOf('id="rep-r-japan-1-groups"');
  assert.ok(across > 0 && groups > across, "inside Across countries");
  assert.match(html, /Patterns across your countries/);
  assert.match(html, /<strong>Across your countries:<\/strong>/, "one line in the summary");
  assert.match(html, /Our pages differ: opens with title art/);
  assert.match(
    html,
    /<svg class="sketch"[^>]*aria-label="image 1: title art, schematic, not measured"/,
  );
  assert.match(html, /Japan: 4 of 6 · ours no/);
  assert.match(html, /Recommended A\/B tests<\/h4><div class="abcards">/);
  assert.match(html, /Play Console:/);
  assert.match(html, /class="geditor"/);
  assert.match(html, /class="linkbtn g-derive"[^>]*>Make country reports again</);
  assert.match(html, /Open Japan as its own report/);
  // Flags only in headings (h3/h4 and tabs), never in the running text of the group part.
  const part = html.slice(
    groups,
    html.indexOf('id="rep-r-japan-1-local"') > 0
      ? html.indexOf('id="rep-r-japan-1-local"')
      : undefined,
  );
  for (const p of part.match(/<p[ >][\s\S]*?<\/p>/g) ?? [])
    assert.doesNotMatch(p, /class="flag"/, p);
  assert.doesNotMatch(html, /\[(JP|KR|US)\]/);
});

function derivedHk(): string {
  const c = compare();
  const hk = deriveCountry(
    {
      ...c,
      countries: [
        ...c.countries,
        {
          ...(c.countries[1] as CountryReport["countries"][number]),
          gl: "hk",
          label: "Hong Kong (Traditional Chinese)",
        },
      ],
    },
    "hk",
    {
      reportId: "r-cmp-1",
      versionId: "v",
      name: "Japan, South Korea, Hong Kong vs 6 competitors",
      generatedAt: "2026-09-29T07:08:42.508Z",
    },
    PLAY,
  ) as CountryReport;
  return renderCountry(
    {
      ...hk,
      links: {
        derived: {
          parentId: "r-cmp-1",
          parentName: "The comparison",
          siblings: [{ gl: "jp", id: "r-cmp-1-jp" }],
        },
      },
    } as CountryReport,
    true,
  );
}

test("a country report from a comparison shows a one-line band at the top and the paid button behind the usual approval", () => {
  const html = derivedHk();
  assert.match(html, /Hong Kong shows the same images as South Korea for every game/);
  assert.match(html, /From the comparison: <strong>The comparison<\/strong>/);
  assert.match(html, /data-rid="r-cmp-1">Open it</);
  assert.match(
    html,
    /Other countries: <button[^>]*data-rid="r-cmp-1-jp"><img class="flag" alt="jp">Japan</,
  );
  assert.match(html, /class="rc-approve"[^>]*>Write A\/B tests for Hong Kong alone</);
  assert.match(html, /nothing runs until you approve/);
  assert.ok(
    html.indexOf("From the comparison:") < html.indexOf('class="short"'),
    "at the top, before the summary",
  );
});

test("declutter: the group part opens with the bottom line, finding rows and compact A/B cards", () => {
  const html = renderCountry(compare(), true);
  const at = html.indexOf('id="rep-r-japan-1-groups"');
  const part = html.slice(at, html.indexOf('id="rep-r-japan-1-', at + 10));
  const open = openView(part);
  // One sentence, the rows (finding + our status), the cards (title, why, one variable), Edit groups.
  assert.match(open, /<p class="gline">[^.<]+\.<\/p>/);
  assert.match(
    open,
    /<\/h4><strong>Our pages differ: opens with title art<\/strong><span class="pill slightly">ours: yes in 1 of 3<\/span><strong>/,
  );
  assert.match(open, /<div class="abcard"><h4><span class="abno">1<\/span>/);
  assert.match(open, /<strong>One variable:<\/strong>/);
  // Only the fold titles: "Edit groups" (a small button) and "Details".
  assert.match(open, /<div class="gfoot">Edit groupsDetails<\/div>/);
  assert.match(open, /Country reports: <button[^>]*>Japan<\/button>/);
  for (const noise of [
    /Play Console/,
    /Hypothesis:/,
    /Traffic/,
    /class="gper"/,
    /<svg class="sketch"/,
    /class="gthumbs"/,
    /Not a pattern/,
    /Exploratory numbers/,
    /schematic, not measured/,
    /Make country reports/,
    /Tick at least 2 countries/,
    /No group difference found on the main dimensions/,
  ])
    assert.doesNotMatch(open, noise, String(noise));
  // Still there, behind folds (the PDF opens every fold).
  for (const kept of [
    /Play Console:/,
    /Hypothesis:/,
    /class="gper"/,
    /<svg class="sketch"/,
    /Make country reports again/,
  ])
    assert.match(part, kept, String(kept));
});

test("declutter: a derived country report's band is one line; the date, notes and paid button fold", () => {
  const html = derivedHk();
  const band = html.slice(html.indexOf('<div class="gband">'), html.indexOf('<div class="banner'));
  const open = openView(band);
  assert.match(
    open,
    /From the comparison: <strong>The comparison<\/strong> · <button[^>]*>Open it<\/button> · Other countries: /,
  );
  for (const noise of [/Write A\/B tests/, /no AI call/, /Optional and paid/, /<p>/])
    assert.doesNotMatch(open, noise, String(noise));
  assert.match(band, /Write A\/B tests for Hong Kong alone/);
});

test("a comparison without the group part still offers to remake its country reports", () => {
  const html = renderCountry({ ...compare(), groups: undefined } as CountryReport, true);
  assert.match(html, /Country reports: <button[^>]*>Japan<\/button>/);
  assert.match(html, /class="linkbtn g-derive"[^>]*>Make country reports again</);
});
