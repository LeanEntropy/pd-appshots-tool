import assert from "node:assert/strict";
import { test } from "node:test";
import type { CountryAdvice } from "../src/analysis/country-advice-schema.ts";
import type { GameOrder } from "../src/analysis/report-data.ts";
import { loadCountries } from "../src/config/countries.ts";
import { commonFinding, type GroupData, groupDifference } from "../src/reports/group-findings.ts";
import { groupsMarkdown, withGroupsMd } from "../src/reports/group-md.ts";
import { groupSetupLine } from "../src/reports/group-recs.ts";
import { DEFAULT_RULES } from "../src/reports/group-types.ts";
import { groupProblem, suggestGroups } from "../src/reports/groups.ts";
import { groupsPart } from "../src/reports/groups-part.ts";
import { type DeckFlags, data, deck, PLAY, pages, report } from "./helpers/groups-fixture.ts";

const NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];
const US = { gl: "us", hl: "en", label: "United States (English)" };
const JP = { gl: "jp", hl: "ja", label: "Japan" };
const KR = { gl: "kr", hl: "ko", label: "South Korea" };
const TW = { gl: "tw", hl: "zh-TW", label: "Taiwan" };
const HK = { gl: "hk", hl: "zh-TW", label: "Hong Kong (Traditional Chinese)" };

/** 8 competitors; `yes` lists who opens with title art in that country (others: no). */
function country(
  m: typeof US,
  yes: string[],
  o: { ours?: DeckFlags; extra?: Record<string, DeckFlags> } = {},
) {
  const games: GameOrder[] = [
    deck("ours", "Rogue", { ids: `ours-${m.gl}`, ...(o.ours ?? {}) }, true),
    ...NAMES.map((n) =>
      deck(n, n, { ids: `${n}-${m.gl}`, titleArt: yes.includes(n), ...(o.extra?.[n] ?? {}) }),
    ),
  ];
  return pages(m.gl, m.hl, m.label, games);
}
const gd = (main: ReturnType<typeof country>, ...ps: ReturnType<typeof country>[]): GroupData => ({
  pages: ps,
  main,
  competitors: NAMES.map((n) => ({ appId: n, name: n })),
});
const group = { name: "East Asia", gls: ["jp", "kr"] };
const LOGOS = Object.fromEntries(
  ["A", "B", "C", "D", "E"].map((n) => [n, { titleArt: true, logo: true }]),
);
const vsUs = (x: GroupData) => ({
  pages: [x.main as NonNullable<GroupData["main"]>],
  name: "the United States",
});

test("group difference: 3 changed and none back, holding in every country, is worth testing; 5 is clear", () => {
  const base = ["A", "B"];
  const x = gd(
    country(US, base),
    country(JP, [...base, "C", "D", "E"]),
    country(KR, [...base, "C", "D", "E"]),
  );
  const r = groupDifference(x, group, vsUs(x), "titleArt", DEFAULT_RULES);
  assert.equal(r.finding?.strength, "suggestive");
  assert.deepEqual(r.finding?.counts?.changed, ["C", "D", "E"]);
  assert.match(
    r.finding?.text ?? "",
    /Worth testing: .*3 of 8 competitors open with title art where they do not in the United States/,
  );
  assert.equal(r.finding?.fewGames, true, "removing one game drops it below the threshold");
  assert.match(r.finding?.weakest ?? "", /5 of 8/);
  const y = gd(
    country(US, []),
    country(JP, ["A", "B", "C", "D", "E"]),
    country(KR, ["A", "B", "C", "D", "E"]),
  );
  const clear = groupDifference(y, group, vsUs(y), "titleArt", DEFAULT_RULES).finding;
  assert.equal(clear?.strength, "clear");
  assert.match(clear?.text ?? "", /^Clear: /);
});

test("group difference: 3 changed and 2 the other way is 'no difference found', never 'the same'", () => {
  const x = gd(
    country(US, ["F", "G", "A", "B"]),
    country(JP, ["A", "B", "C", "D", "E"]),
    country(KR, ["A", "B", "C", "D", "E"]),
  );
  const r = groupDifference(x, group, vsUs(x), "titleArt", DEFAULT_RULES);
  assert.equal(r.finding, null);
  assert.match(
    r.line,
    /no difference found .*3 of 8 competitors changed this way, 2 the other way/,
  );
  assert.doesNotMatch(r.line, /the same/);
});

test("a game that differs between the group's pages is mixed: shown, never counted as yes", () => {
  const x = gd(
    country(US, ["A", "B"]),
    country(JP, ["A", "B", "C", "D", "E", "F"]),
    country(KR, ["A", "B", "C", "D", "E"]),
  );
  const r = groupDifference(x, group, vsUs(x), "titleArt", DEFAULT_RULES);
  assert.equal(r.finding?.counts?.mixed, 1);
  assert.deepEqual(r.finding?.counts?.changed, ["C", "D", "E"]);
  assert.match(r.finding?.text ?? "", /1 mixed/);
});

test("positions not analysed never count as 'no'; fewer than 5 known games is 'not enough games here'", () => {
  const unknown = Object.fromEntries(["D", "E", "F", "G"].map((n) => [n, { unknown: true }]));
  const x = gd(
    country(US, []),
    country(JP, ["A", "B", "C"], { extra: unknown }),
    country(KR, ["A", "B", "C"], { extra: unknown }),
  );
  const r = groupDifference(x, group, vsUs(x), "titleArt", DEFAULT_RULES);
  assert.equal(r.finding, null);
  assert.match(r.line, /not enough games here \(4 with a known value\)/);
});

test("common in every country (main included) is a roll-out, not a group habit; the same games everywhere is descriptive", () => {
  const five = ["A", "B", "C", "D", "E"];
  const x = gd(
    country(US, five, { ours: { titleArt: true } }),
    country(JP, five),
    country(KR, [...five, "F"]),
  );
  const c = commonFinding(x, "titleArt", DEFAULT_RULES);
  assert.equal(c?.kind, "common");
  assert.match(
    c?.text ?? "",
    /In all 3 countries, 5 to 6 of 8 competitors open with title art\. Our page does not in Japan and South Korea\./,
  );
  const land = { A: { landscape: true }, B: { landscape: true } };
  const y = gd(
    country(US, [], { extra: land }),
    country(JP, [], { extra: land }),
    country(KR, [], { extra: land }),
  );
  const d = commonFinding(y, "landscape", DEFAULT_RULES);
  assert.equal(d?.kind, "descriptive");
  assert.match(
    d?.text ?? "",
    /The same 2 of 8 competitors \(A and B\) use a landscape image in the United States and in all 2 compared countries/,
  );
});

test("groups are suggested by region and language; Taiwan with Hong Kong alone is refused with the reason", () => {
  const s = suggestGroups(
    [JP, KR, TW, HK, { gl: "th", hl: "th", label: "Thailand" }],
    loadCountries().groupRegions,
  );
  assert.deepEqual(
    s.map((g) => g.name),
    ["All compared countries", "East Asia", "Chinese (Taiwan) listings"],
  );
  const same = [country(TW, ["A"]), { ...country(TW, ["A"]), gl: "hk", label: HK.label }];
  assert.match(
    groupProblem({ name: "Chinese", countries: ["tw", "hk"] }, same) ?? "",
    /Taiwan and Hong Kong show the same pages for 8 of 8 competitors/,
  );
  assert.equal(
    groupProblem({ name: "East Asia", countries: ["jp", "kr"] }, [
      country(JP, []),
      country(KR, []),
    ]),
    null,
  );
});

test("Play setup per group: own languages give a localised experiment; a shared language needs a custom store listing", () => {
  const play = { ...PLAY, reportMarkets: [JP, KR, TW, HK] };
  assert.match(
    groupSetupLine([JP, KR], play),
    /are theirs alone: test with a localised experiment/,
  );
  assert.match(
    groupSetupLine([JP, TW], play),
    /Hong Kong uses the same language, so create one custom store listing targeting Japan and Taiwan/,
  );
});

test("the group part: our pages first, one-variable recommendations, a contradiction with a country's advice shown", () => {
  const five = ["A", "B", "C", "D", "E"];
  const r = report(
    [
      {
        gl: "jp",
        hl: "ja",
        label: "Japan",
        isMain: false,
        data: data(country(JP, five, { extra: LOGOS }).games),
      },
      {
        gl: "kr",
        hl: "ko",
        label: "South Korea",
        isMain: false,
        data: data(country(KR, five, { extra: LOGOS }).games),
      },
    ],
    {
      advice: [
        {
          gl: "jp",
          label: "Japan",
          state: "current",
          review: null,
          revised: false,
          note: "",
          advice: {
            deck: [{ position: 1, screen: "Gameplay / Battle", logo: { show: false } }],
          } as unknown as CountryAdvice,
        },
      ],
    },
  );
  const g = groupsPart({
    report: r,
    main: {
      market: US,
      games: country(US, five, { ours: { titleArt: true, logo: true }, extra: LOGOS }).games,
    },
    saved: undefined,
    regions: loadCountries().groupRegions,
    play: { ...PLAY, reportMarkets: [JP, KR] },
  });
  assert.ok(g);
  assert.deepEqual(
    g.ours.map((f) => f.dim),
    ["titleArt", "logo"],
  );
  assert.match(
    g.ours[0]?.text ?? "",
    /Our United States page opens with title art; our Japan and South Korea pages do not/,
  );
  assert.ok(g.ours[0]?.sketch?.includes("schematic, not measured"));
  const rec = g.recommendations[0];
  assert.equal(g.recommendations.length, 1, "the logo comes with our title art: one test, not two");
  assert.equal(rec?.variable, "screenshot");
  assert.deepEqual(rec?.positions, [1]);
  assert.match(rec?.text ?? "", /also puts the logo first/);
  assert.match(rec?.conflicts[0] ?? "", /Japan's advice keeps "Gameplay \/ Battle" at image 1/);
  assert.ok(g.recommendations.every((x) => x.kind !== "descriptive"));
  assert.match(
    g.bottomLine,
    /no group difference found .*What differs is ours: opens with title art, logo early/,
  );
  const md = groupsMarkdown(g).join("\n");
  assert.match(md, /#### Our pages differ between countries/);
  assert.doesNotMatch(md, /\[(JP|KR|US)\]|🇯🇵/u, "no bracketed codes or flag emoji");
  const saved = "# R\n\n## 1. Overall recommendations\n\nShort.\n\n## 2. Per country\n\nX\n";
  const out = withGroupsMd(saved, g);
  assert.match(out, /## 1\. Overall recommendations\n\n\*\*Across your countries:\*\*/);
  assert.match(
    out,
    /## Across countries\n\n### Patterns across your countries[\s\S]*## 2\. Per country/,
  );
});

test("at most 5 findings per group, and a finding holding in the widest group is not repeated in a smaller one", () => {
  const five = ["A", "B", "C", "D", "E"];
  const r = report(
    ["jp", "kr", "tw"].map((gl) => {
      const m = gl === "jp" ? JP : gl === "kr" ? KR : { ...TW, hl: "zh-TW" };
      return {
        ...m,
        isMain: false,
        data: data(country(m, five, { ours: { titleArt: true } }).games),
      };
    }),
  );
  const g = groupsPart({
    report: r,
    main: { market: US, games: country(US, [], { ours: { titleArt: true } }).games },
    saved: [
      { name: "All three", countries: ["jp", "kr", "tw"] },
      { name: "Two", countries: ["jp", "kr"] },
    ],
    regions: [],
    play: PLAY,
  });
  const all = g?.groups.find((s) => s.name === "All three");
  const two = g?.groups.find((s) => s.name === "Two");
  assert.equal(all?.findings[0]?.dim, "titleArt");
  assert.equal(all?.findings[0]?.strength, "clear");
  assert.equal(two?.findings.length, 0);
  assert.match(two?.notAPattern.join(" ") ?? "", /already shown for a wider group/);
  assert.ok((all?.findings.length ?? 0) <= DEFAULT_RULES.maxFindings);
  assert.ok(all?.exploratory.length, "exploratory numbers are shown, never as findings");
});
