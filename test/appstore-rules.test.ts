import assert from "node:assert/strict";
import { test } from "node:test";
import { type Recommendations, recommendationProblems } from "../src/analysis/synthesis-schema.ts";
import {
  APPLE_RULES,
  appleRulesPrompt,
  merelyTitleArt,
  rulesStale,
  titleArtProblems,
  variantTitleArtProblems,
} from "../src/appstore/apple-rules.ts";
import { PPO_LIMITS, ppoProblem, ppoSetup } from "../src/appstore/ppo.ts";
import { abStoreLines, storeFacts } from "../src/appstore/store-prompts.ts";
import type { PlayContext } from "../src/reports/ab-section.ts";
import { testSetup } from "../src/reports/test-setup.ts";

const slot = (position: number, screenType: string) =>
  ({
    position,
    screenType,
    subtype: "",
    source: "new capture",
    screenshot: {
      orientation: "portrait",
      whatToCapture: "x",
      action: "x",
      atmosphere: "x",
      mainColours: "x",
    },
    marketingLayer: {
      present: false,
      proportion: "none",
      backgroundMask: { shape: "", colour: "", location: "" },
      texts: [],
      elements: [],
    },
    logo: { show: false, why: "" },
    why: "x",
  }) as unknown as Recommendations["positions"][number];

test("every Apple rule keeps Apple's exact words, its page, a check date and a label", () => {
  for (const r of APPLE_RULES) {
    assert.ok(r.quote.length > 20, r.id);
    assert.match(r.url, /^https:\/\/developer\.apple\.com\//);
    assert.match(r.checked, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(["hard", "review", "guidance", "heuristic"].includes(r.label));
  }
  const g = APPLE_RULES.find((r) => r.id === "2.3.3");
  assert.equal(g?.label, "hard");
  assert.equal(rulesStale(new Date("2026-10-01")), false);
  assert.equal(rulesStale(new Date("2027-06-01")), true);
  // The prompt quotes the hard rule, never a paraphrase.
  assert.ok(appleRulesPrompt().includes(g?.quote ?? "?"));
});

test("Guideline 2.3.3: an Apple image spec that is title art only is refused in every position", () => {
  assert.deepEqual(titleArtProblems([]), []);
  assert.deepEqual(titleArtProblems([{ position: 1, screenType: "gameplay" }]), []);
  const one = titleArtProblems([
    { position: 1, screenType: "gameplay" },
    { position: 5, screenType: "key_art" },
  ]);
  assert.equal(one.length, 1);
  assert.match(one[0] ?? "", /position 5.*2\.3\.3/);
  // A gallery of art only is refused as a whole too.
  const all = titleArtProblems([
    { position: 1, screenType: "key_art" },
    { position: 2, screenType: "key_art" },
  ]);
  assert.equal(all.length, 3);
  assert.match(all[0] ?? "", /every image is title art/);
});

test("the recommendation check applies Apple's rule only on the App Store", () => {
  const r = { rationale: "x", positions: [slot(1, "key_art"), slot(2, "gameplay")] };
  const play = recommendationProblems(r, 1, 10);
  const apple = recommendationProblems(r, 1, 10, new Map(), "appstore");
  assert.ok(!play.some((p) => p.includes("2.3.3")));
  assert.ok(apple.some((p) => p.includes("position 1") && p.includes("2.3.3")));
});

test("free-text A/B slots: title art, splash or logo only is refused; a logo over gameplay is fine", () => {
  assert.equal(merelyTitleArt("Title screen with the logo"), true);
  assert.equal(merelyTitleArt("Splash screen"), true);
  assert.equal(merelyTitleArt("Logo over a real battle capture"), false);
  assert.equal(merelyTitleArt("Boss battle, hero in the centre"), false);
  const p = variantTitleArtProblems([
    { position: 1, screen: "key art of the heroes" },
    { position: 2, screen: "gameplay: dungeon run" },
  ]);
  assert.equal(p.length, 1);
  assert.match(p[0] ?? "", /position 1/);
});

test("Google Play prompts get nothing; App Store prompts get the rules and the PPO terms", () => {
  assert.deepEqual(storeFacts(undefined), []);
  assert.deepEqual(storeFacts("play"), []);
  assert.deepEqual(abStoreLines(undefined), []);
  const lines = abStoreLines("appstore").join("\n");
  assert.match(lines, /Product Page Optimization/);
  assert.match(lines, /up to 3 treatments/);
  assert.match(lines, /2\.3\.3/);
});

test("PPO setup: up to 3 treatments, low traffic one, Apple's conditions stated", () => {
  const s = ppoSetup(["United States (en_us)"], 5, "high");
  assert.equal(s.kind, "ppo");
  assert.equal(s.variants, PPO_LIMITS.maxTreatments);
  assert.match(s.line, /United States \(en_us\)/);
  assert.ok(s.notes.some((n) => /App Review/.test(n)));
  assert.ok(s.notes.some((n) => /90 days/.test(n)));
  const low = ppoSetup(["Japan (ja_jp)"], 2, "unknown");
  assert.equal(low.variants, 1);
  assert.ok(low.notes.some((n) => /not known/.test(n)));
  assert.ok(ppoSetup([], 1, "high", "app icon").notes.some((n) => /app build/.test(n)));
  assert.equal(ppoProblem({ element: "screenshots", treatments: 2 }), null);
  assert.match(ppoProblem({ element: "subtitle", treatments: 1 }) ?? "", /cannot test/);
  assert.match(ppoProblem({ element: "screenshots", treatments: 4 }) ?? "", /up to 3/);
});

test("an App Store report's tests are PPO tests; a Google Play report's stay Play experiments", () => {
  const us = { gl: "us", hl: "en", label: "United States" };
  const base: PlayContext = {
    reportMarkets: [us],
    projectMarkets: [us],
    traffic: { us: "high" },
    preRegistration: false,
  };
  const play = testSetup(base, [us], [us], true);
  assert.notEqual(play.kind, "ppo");
  const apple = testSetup({ ...base, platform: "appstore" }, [us], [us], true);
  assert.equal(apple.kind, "ppo");
  assert.equal(apple.variants, 2);
  assert.match(apple.line, /en_us/);
});
