import assert from "node:assert/strict";
import { test } from "node:test";
import { loadCountries } from "../src/config/countries.ts";
import type { CountryReport } from "../src/reports/country-report-types.ts";
import { deriveCountry } from "../src/reports/derive-country.ts";
import { groupsPart } from "../src/reports/groups-part.ts";
import { renderCountry } from "./helpers/country-run.ts";
import { data, deck, PLAY, report } from "./helpers/groups-fixture.ts";

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
  assert.match(html, /Recommendations, as A\/B tests/);
  assert.match(html, /Play Console:/);
  assert.match(html, /class="geditor"/);
  assert.match(html, /Make country reports now/);
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

test("a country report from a comparison shows the band after its summary and the paid button behind the usual approval", () => {
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
  const html = renderCountry(
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
  assert.match(html, /Hong Kong shows the same images as South Korea for every game/);
  assert.match(html, /Part of the comparison “The comparison”/);
  assert.match(html, /data-rid="r-cmp-1">Open the comparison</);
  assert.match(html, /Also in it: <button[^>]*data-rid="r-cmp-1-jp">Japan</);
  assert.match(html, /class="rc-approve"[^>]*>Write A\/B tests for Hong Kong alone</);
  assert.match(html, /nothing runs until you approve/);
  assert.ok(
    html.indexOf("Part of the comparison") > html.indexOf('class="short"'),
    "after the summary",
  );
});
