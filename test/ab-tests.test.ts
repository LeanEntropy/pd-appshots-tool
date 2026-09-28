import assert from "node:assert/strict";
import { test } from "node:test";
import { type AiTest, testProblems } from "../src/analysis/ab-tests-schema.ts";
import { patternFit } from "../src/analysis/pattern-fit.ts";
import { type DeckEntry, findPatterns } from "../src/analysis/patterns.ts";
import { allowedMetrics, GUARDRAIL, playSetup } from "../src/analysis/play-experiments.ts";
import { abCandidates } from "../src/reports/ab-candidates.ts";
import { abEvidence, abTestsPart, noIds, type PlayContext } from "../src/reports/ab-section.ts";
import { reading } from "./helpers/fake-provider.ts";

const US = { gl: "us", hl: "en", label: "United States (English)" };
const PH = { gl: "ph", hl: "en", label: "Philippines (English)" };
const label = (k: string) => k.replace(/_/g, " ");

function entry(name: string, position: number, type: string, ours = false): DeckEntry {
  return {
    appId: ours ? "ours" : name,
    name,
    position,
    imageId: `${name}-${position}`.padEnd(64, "0"),
    canvas: "portrait",
    gl: "us",
    hl: "en",
    final: reading(`img${position}`, type, `${name} ${position}`),
  };
}

/** Three competitors lead with battle gameplay; we lead with the title screen. */
function decks(oursTypes = ["title_image", "gameplay", "character_roster"]) {
  const theirs = ["A", "B", "C"].flatMap((n) =>
    ["gameplay", "character_roster", "gameplay"].map((t, i) => entry(n, i + 1, t)),
  );
  const ours = oursTypes.map((t, i) => entry("Ours", i + 1, t, true));
  const p = findPatterns(
    theirs,
    ["A", "B", "C"].map((n) => ({ appId: n, name: n, deckLength: 3 })),
  );
  return { theirs, ours, p, fit: patternFit(theirs, ours, p, ours.length, label) };
}

const play = (traffic: PlayContext["traffic"] = {}): PlayContext => ({
  reportMarkets: [US],
  projectMarkets: [US, PH],
  traffic,
  preRegistration: false,
});

function aiTest(over: Partial<AiTest> & { at?: number; n?: number } = {}): AiTest {
  const at = over.at ?? 1;
  const slots = Array.from({ length: 3 }, (_, i) => ({
    position: i + 1,
    fromOurPosition: i + 1,
    changed: i + 1 === at,
    orientation: "portrait" as const,
    composition: "full capture",
    screen: "battle",
    band: "none",
    headline: "",
    extras: "none",
  }));
  return {
    title: "Battle first",
    hypothesis: "h",
    evidence: [{ id: "E1", n: 3, of: 3 }],
    variable: "screenshot",
    countries: ["us"],
    metric: "installs",
    variant: { summary: "s", slots },
    secondVariant: null,
    impact: { size: "medium", reason: "r" },
    orderReason: "",
    ...over,
  };
}

test("candidates: our gaps with evidence ids, n and leverage, position 1 first", () => {
  const { fit } = decks();
  const ev = abCandidates(fit, { gl: "us", ourDeckLength: 3, deckLength: { min: 3, max: 3 } });
  assert.ok(ev.length >= 2);
  const first = ev[0];
  assert.equal(first?.id, "E1");
  assert.match(first?.statement ?? "", /^Position 1 shows gameplay/);
  assert.deepEqual([first?.n, first?.of, first?.unit], [3, 3, "screenshots"]);
  assert.deepEqual(first?.ours, [1]);
  assert.equal(first?.variable, "screenshot");
  assert.equal(first?.imageIds.length, 3);
  assert.deepEqual(first?.games, ["A", "B", "C"]);
  for (let i = 1; i < ev.length; i++)
    assert.ok((ev[i - 1]?.leverage ?? 0) >= (ev[i]?.leverage ?? 0), "leverage order");
});

test("validation: unknown gap, wrong n, two changes, a foreign country, low traffic past position 3", () => {
  const { fit } = decks();
  const { rules } = abEvidence({
    fit,
    ourDeckLength: 3,
    deckLength: { min: 3, max: 3 },
    market: US,
    play: play(),
  });
  assert.deepEqual(testProblems(aiTest(), rules), []);
  assert.match(
    testProblems(aiTest({ evidence: [{ id: "E99", n: 1, of: 1 }] }), rules).join(),
    /E99 does not exist/,
  );
  assert.match(
    testProblems(aiTest({ evidence: [{ id: "E1", n: 2, of: 3 }] }), rules).join(),
    /is 3 of 3 screenshots, not 2 of 3/,
  );
  const two = aiTest();
  (two.variant.slots[1] as { changed: boolean }).changed = true;
  assert.match(testProblems(two, rules).join(), /exactly one image/);
  assert.match(
    testProblems(aiTest({ countries: ["jp"] }), rules).join(),
    /jp is not in this report/,
  );
  assert.match(
    testProblems(aiTest({ metric: "opens" }), rules).join(),
    /Unique user install clicks/,
  );
  // A gap at position 1 does not support a test of position 2.
  assert.match(testProblems(aiTest({ at: 2 }), rules).join(), /no cited gap covers position 2/);
});

test("the report's tests: invalid ones left out, control from our deck, topped up to 2 by code", () => {
  const { fit, ours } = decks();
  const bad = aiTest({ title: "Wrong", evidence: [{ id: "E1", n: 1, of: 9 }] });
  const part = abTestsPart({
    fit,
    ours,
    ourDeckLength: 3,
    deckLength: { min: 3, max: 3 },
    label,
    market: US,
    play: play(),
    ai: { tests: [aiTest(), bad] },
    aiCurrent: true,
  });
  assert.equal(part.tests.length, 2);
  assert.deepEqual(
    part.tests.map((t) => [t.priority, t.source]),
    [
      [1, "ai"],
      [2, "code"],
    ],
  );
  assert.equal(part.leftOut[0]?.title, "Wrong");
  assert.deepEqual(
    part.tests[0]?.control.map((c) => c.screen),
    ["title image", "gameplay", "character roster"],
  );
  assert.equal(part.tests[0]?.metric.name, "Unique user install clicks");
  assert.match(part.tests[0]?.guardrail ?? "", /open clicks/);
  assert.match(part.tests[1]?.title ?? "", /^Gap worth testing/);
});

test("never more than 5; fewer than 2 gaps are said, not invented", () => {
  const { fit, ours } = decks();
  const many = abTestsPart({
    fit,
    ours,
    ourDeckLength: 3,
    deckLength: { min: 3, max: 3 },
    label,
    market: US,
    play: play(),
    ai: null,
    aiCurrent: false,
  });
  assert.ok(many.tests.length >= 2 && many.tests.length <= 5);
  assert.ok(many.tests.every((t) => t.source === "code"));
  const same = decks(["gameplay", "character_roster", "gameplay"]);
  const none = abTestsPart({
    fit: same.fit,
    ours: same.ours,
    ourDeckLength: 3,
    deckLength: { min: 3, max: 3 },
    label,
    market: US,
    play: play(),
    ai: null,
    aiCurrent: false,
  });
  assert.equal(none.tests.length, 0);
  assert.match(none.note, /No gaps found/);
  const one = decks(["character_roster", "gameplay", "gameplay"]);
  const oneGap = abCandidates(one.fit, {
    gl: "us",
    ourDeckLength: 3,
    deckLength: { min: 3, max: 3 },
  }).length;
  if (oneGap === 1)
    assert.match(
      abTestsPart({
        ...one,
        ourDeckLength: 3,
        deckLength: { min: 3, max: 3 },
        label,
        market: US,
        play: play(),
        ai: null,
        aiCurrent: false,
      }).note,
      /Only 1 gap found/,
    );
});

test("Play setup: localised by language, custom listing when countries share one, traffic", () => {
  const low = playSetup([US], [US], [US, PH], () => "unknown", true);
  assert.equal(low.kind, "localised");
  assert.equal(low.variants, 1, "low or unknown traffic: one variant");
  assert.equal(low.audiencePercent, 50);
  assert.match(low.line, /Localised experiment for English/);
  assert.ok(low.notes.some((n) => /Philippines/.test(n)));
  const high = playSetup([US], [US], [US], () => "high", true);
  assert.equal(high.variants, 2);
  assert.ok(high.audiencePercent < low.audiencePercent);
  const tw = { gl: "tw", hl: "zh-TW", label: "Taiwan" };
  const hk = { gl: "hk", hl: "zh-TW", label: "Hong Kong" };
  const custom = playSetup([tw], [tw, hk], [tw, hk], () => "medium", false);
  assert.equal(custom.kind, "custom");
  assert.match(custom.line, /custom store listing for Taiwan/);
  assert.deepEqual(allowedMetrics(false), ["installs"]);
  assert.deepEqual(allowedMetrics(true), ["preRegistration", "installs"]);
  assert.match(GUARDRAIL, /over-promise/);
});

test("a low-traffic country keeps one variant and at most 2 AI tests", () => {
  const { fit, ours } = decks();
  const second = aiTest().variant;
  const t = (title: string) => aiTest({ title, secondVariant: second });
  const part = abTestsPart({
    fit,
    ours,
    ourDeckLength: 3,
    deckLength: { min: 3, max: 3 },
    label,
    market: US,
    play: play({ us: "low" }),
    ai: { tests: [t("one"), aiTest({ title: "two", variable: "text" }), t("three")] },
    aiCurrent: true,
  });
  assert.equal(part.tests[0]?.secondVariant, null);
  assert.equal(part.tests[0]?.setup.variants, 1);
  assert.ok(part.tests.filter((x) => x.source === "ai").length <= 2);
});

test("internal gap ids never reach the page", () => {
  assert.equal(noIds("we have none (E1). If"), "we have none. If");
  assert.equal(noIds("gaps E2 and E3 show it"), "these gaps show it");
  assert.equal(noIds("EPIC E2E"), "EPIC E2E");
});
