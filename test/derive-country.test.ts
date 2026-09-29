import assert from "node:assert/strict";
import { test } from "node:test";
import type { CountryAdvice } from "../src/analysis/country-advice-schema.ts";
import { countryMarkdown } from "../src/reports/country-md.ts";
import type { CountryReport } from "../src/reports/country-report-types.ts";
import { derivedAbTests, reuseProblem, textFits } from "../src/reports/derive-ab.ts";
import { deriveCountry, namesOther, samePagesAs } from "../src/reports/derive-country.ts";
import { data, deck, PLAY, report, test_ } from "./helpers/groups-fixture.ts";

const META = {
  reportId: "r-cmp-1",
  versionId: "v1",
  name: "Japan, South Korea vs 2 competitors",
  generatedAt: "2026-09-29T07:08:42.508Z",
};
const jpMarket = { gl: "jp", hl: "ja", label: "Japan" };

const codeTest = (title: string, variable: "screenshot" | "order", positions: number[]) =>
  test_({ source: "code", title, variable, positions, countries: ["Japan"] });

function cmp(o: Partial<CountryReport> = {}, jpGaps = 3): CountryReport {
  const games = (p: string) => [
    deck("ours", "Rogue", { ids: `o-${p}` }, true),
    deck("a", "A", { ids: `a-${p}` }),
    deck("b", "B", { ids: `b-${p}` }),
  ];
  const jpTests = {
    tests: [codeTest("Gap: title art", "screenshot", [1]), codeTest("Gap: shorter", "order", [])],
    leftOut: [],
    gaps: jpGaps,
    note: "",
  };
  return report(
    [
      { gl: "jp", hl: "ja", label: "Japan", isMain: false, data: data(games("jp"), jpTests) },
      { gl: "kr", hl: "ko", label: "South Korea", isMain: false, data: data(games("kr")) },
      { gl: "tw", hl: "zh-TW", label: "Taiwan", isMain: false, data: data(games("tw")) },
      {
        gl: "hk",
        hl: "zh-TW",
        label: "Hong Kong (Traditional Chinese)",
        isMain: false,
        data: data(games("tw")),
      },
    ],
    o,
  );
}

test("a country report from a comparison keeps that country's parts and recomputes the summary, with no AI", () => {
  const advice = {
    shortAnswer: "Open with the title art.",
    actions: [{ action: "Title art first", why: "Most do.", positions: [1], impact: "large" }],
    deck: [],
    terms: [],
    keepFromMain: "",
  } as unknown as CountryAdvice;
  const parent = cmp({
    advice: [
      {
        gl: "jp",
        label: "Japan",
        state: "current",
        advice,
        review: null,
        revised: false,
        note: "",
      },
      {
        gl: "kr",
        label: "South Korea",
        state: "current",
        advice,
        review: null,
        revised: false,
        note: "",
      },
    ],
    crossTerms: [{ label: "Battle", perCountry: [] }] as unknown as CountryReport["crossTerms"],
    missing: [{ what: "Words used in South Korea: the ideas are not grouped yet", how: "" }],
  });
  const r = deriveCountry(parent, "jp", META, PLAY);
  assert.ok(r);
  assert.equal(r.type, "country");
  assert.deepEqual(
    r.countries.map((c) => c.gl),
    ["jp"],
  );
  assert.equal(r.countries[0]?.data, parent.countries[0]?.data, "the report data is kept as saved");
  assert.deepEqual(
    r.advice.map((a) => a.gl),
    ["jp"],
  );
  assert.deepEqual(r.crossTerms, [], "cross-country words are dropped");
  assert.deepEqual(r.missing, [], "another country's missing part is not this report's");
  assert.equal(r.summary.verdicts.length, 1);
  assert.match(r.summary.shortAnswer, /in Japan\. Open with the title art\./);
  assert.equal(r.derived?.projection, "projection.v1");
  assert.deepEqual(
    r.derived?.others.map((o) => o.gl),
    ["kr", "tw", "hk"],
  );
  assert.equal(r.name, "Japan vs 2 competitors (from the comparison)");
  const md = countryMarkdown(r);
  assert.match(md, /Part of the comparison "Japan, South Korea vs 2 competitors"/);
  assert.match(md, /no AI call/);
});

test("kept text that names another compared country is dropped with the reason, never silently", () => {
  const bad = {
    shortAnswer: "Do as in South Korea.",
    actions: [],
    deck: [],
    terms: [],
    keepFromMain: "",
  } as unknown as CountryAdvice;
  const r = deriveCountry(
    cmp({
      advice: [
        {
          gl: "jp",
          label: "Japan",
          state: "current",
          advice: bad,
          review: null,
          revised: false,
          note: "",
        },
      ],
    }),
    "jp",
    META,
    PLAY,
  );
  assert.equal(r?.advice[0]?.state, "missing");
  assert.match(r?.advice[0]?.note ?? "", /names South Korea/);
  assert.match(r?.derived?.dropped[0] ?? "", /names South Korea/);
  assert.ok(r?.missing.some((m) => m.what === "The advice for Japan"));
  assert.deepEqual(namesOther("Japanese text only", ["Japan"]), [], "whole words only");
});

test("Hong Kong with the same pages as Taiwan says so; Taiwan does not", () => {
  const p = cmp();
  assert.deepEqual(samePagesAs(p, "hk"), { gl: "tw", label: "Taiwan" });
  assert.equal(samePagesAs(p, "tw"), null);
  const hk = deriveCountry(p, "hk", META, PLAY);
  assert.match(
    countryMarkdown(hk as CountryReport),
    /Hong Kong shows the same images as Taiwan for every game: this report repeats Taiwan's findings/,
  );
});

test("A/B reuse: pooled evidence is not kept; a test with a value measured here is kept with this country's setup", () => {
  const pooled = test_({
    title: "Pooled",
    countries: ["Japan", "South Korea"],
    evidence: [
      {
        id: "E1",
        statement: "South Korea: Opens with title art (5 of 8)",
        n: 5,
        of: 8,
        unit: "games",
        games: [],
      },
    ],
  });
  const own = test_({
    title: "Own",
    countries: ["Japan", "South Korea"],
    evidence: [
      {
        id: "E2",
        statement: "Japan: Opens with title art (5 of 8)",
        n: 5,
        of: 8,
        unit: "games",
        games: [],
      },
      {
        id: "E3",
        statement: "South Korea: Opens with title art (5 of 8)",
        n: 5,
        of: 8,
        unit: "games",
        games: [],
      },
    ],
  });
  assert.match(reuseProblem(pooled, jpMarket, 6) ?? "", /other countries only/);
  assert.equal(reuseProblem(own, jpMarket, 6), null);
  const ab = derivedAbTests(
    cmp({ abTests: { tests: [pooled, own], leftOut: [], gaps: 3, note: "" } }),
    cmp().countries[0] as CountryReport["countries"][number],
    PLAY,
  );
  assert.deepEqual(
    ab.tests.map((t) => t.title),
    ["Own", "Gap: shorter"],
    "topped up to 2 with this country's code test (same change skipped)",
  );
  const kept = ab.tests[0];
  assert.deepEqual(kept?.countries, ["Japan"]);
  assert.deepEqual(
    kept?.evidence.map((e) => e.statement),
    ["Opens with title art (5 of 8)"],
  );
  assert.match(kept?.setup.line ?? "", /Localised experiment for Japanese/);
  assert.equal(kept?.control.length, 6, "control is our deck here");
  assert.deepEqual(
    ab.leftOut.map((l) => l.title),
    ["Pooled"],
  );
  assert.deepEqual(
    ab.tests.map((t) => t.priority),
    [1, 2],
  );
});

test("A/B reuse: a variant with new text in another language, or a missing position, is not kept", () => {
  const variant = {
    summary: "",
    slots: [
      {
        position: 1,
        fromOurPosition: 1,
        changes: ["text"],
        orientation: "portrait",
        composition: "",
        screen: "",
        band: "",
        headline: "サイコロで冒険",
        extras: "",
      },
    ],
  };
  const t = test_({
    title: "JP text",
    countries: ["South Korea"],
    evidence: [{ id: "E1", statement: "South Korea: x", n: 1, of: 2, unit: "games", games: [] }],
    variant: variant as AbTestCardVariant,
  });
  assert.match(
    reuseProblem(t, { gl: "kr", hl: "ko", label: "South Korea" }, 6) ?? "",
    /another language/,
  );
  assert.match(
    reuseProblem(
      { ...t, variant: null, positions: [9] },
      { gl: "kr", hl: "ko", label: "South Korea" },
      6,
    ) ?? "",
    /position/,
  );
  assert.equal(textFits("굴리고, 싸우고", "ko"), true);
  assert.equal(textFits("サイコロ", "ko"), false);
  assert.equal(textFits("骰子冒險", "zh-TW"), true);
});
type AbTestCardVariant = Parameters<typeof reuseProblem>[0]["variant"];

test("A/B reuse: only 1 gap here is said, never a second test invented", () => {
  const one = cmp({}, 1);
  const c = { ...(one.countries[0] as CountryReport["countries"][number]) };
  c.data = {
    ...c.data,
    abTests: {
      tests: [codeTest("Gap: title art", "screenshot", [1])],
      leftOut: [],
      gaps: 1,
      note: "",
    },
  };
  const ab = derivedAbTests(one, c, PLAY);
  assert.equal(ab.tests.length, 1);
  assert.match(ab.note, /Only 1 gap found/);
});
