import assert from "node:assert/strict";
import { test } from "node:test";
import { brandOf, namesBrand, splitStoreTitle } from "../src/analysis/brand.ts";
import { categoryOf, FULL_SCREEN_ART, hasDefinition, PROMO } from "../src/analysis/categories.ts";
import { artMessage, showsLogo } from "../src/analysis/image-tags.ts";
import { plainLabel } from "../src/analysis/labels.ts";
import { type FitSummary, patternFit } from "../src/analysis/pattern-fit.ts";
import { type DeckEntry, findPatterns, PROPORTION, proportion } from "../src/analysis/patterns.ts";
import { mapKeyArt } from "../src/analysis/record-refresh.ts";
import { sortingPart } from "../src/analysis/report-sorting.ts";
import type { ImageAnalysis } from "../src/analysis/schema.ts";
import { recommendationProblems } from "../src/analysis/synthesis-schema.ts";
import { abCandidates } from "../src/reports/ab-candidates.ts";
import { reading } from "./helpers/fake-provider.ts";

type Text = ImageAnalysis["marketingLayer"]["texts"][number];
type Element = ImageAnalysis["marketingLayer"]["elements"][number];

/** Full-screen art as the model saw it: a type, its texts and logo elements, no capture. */
function art(type: string, texts: string[], logos: string[] = [], subtype = ""): ImageAnalysis {
  const r = reading("img1", type, texts[0] ?? "");
  r.screenshot.subtype = subtype;
  r.screenshot.composition = "pure_art";
  r.screenshot.captures = [];
  r.screenshot.captureAreaPercent = 0;
  const base = r.marketingLayer.texts[0] as Text;
  r.marketingLayer.texts = texts.map((text) => ({ ...base, text }));
  r.marketingLayer.elements = logos.map(
    (what): Element => ({
      kind: "logo",
      what,
      position: "top",
      pose: "n/a",
      colours: "gold",
      scale: "large",
      breaksFrame: false,
      region: { x: 0, y: 0, w: 10, h: 10 },
    }),
  );
  return r;
}

function entry(name: string, position: number, final: ImageAnalysis, appId = name): DeckEntry {
  return { appId, name, position, imageId: `${name}${position}`, canvas: "portrait", final };
}

test("store titles: the brand is the first part; the rest is ASO keyword data", () => {
  assert.deepEqual(splitStoreTitle("Archero 2 - Roguelike Action RPG"), {
    brand: "Archero 2",
    keywords: "Roguelike Action RPG",
  });
  assert.equal(splitStoreTitle("Legend of Mushroom: Idle RPG").keywords, "Idle RPG");
  assert.equal(brandOf("ソードスタッフ：放置RPG"), "ソードスタッフ");
  assert.equal(brandOf("Path of Kings | Card Roguelike"), "Path of Kings");
  assert.equal(brandOf("Capybara Go – Roguelike"), "Capybara Go");
  assert.deepEqual(splitStoreTitle("Survivor.io"), { brand: "Survivor.io", keywords: null });
  assert.equal(brandOf("X-Men Heroes"), "X-Men Heroes", "a hyphen inside a word is no separator");
  assert.ok(namesBrand("ARCHERO 2", "Archero 2 - Roguelike Action RPG"));
  assert.ok(!namesBrand("Roguelike Action RPG!", "Archero 2 - Roguelike Action RPG"));
});

test("the key art mapping matches the logo against the brand only", () => {
  const title = "Archero 2: Hero Adventure";
  const withName = mapKeyArt(art("key_art", ["ARCHERO 2"]), title);
  assert.equal(withName.final.screenshot.screenType, "title_image");
  const aso = mapKeyArt(art("key_art", ["HERO ADVENTURE"]), title);
  assert.equal(aso.final.screenshot.screenType, "feature_image");
});

test("one category: title, feature, key and loading art are all Title screen / full-screen art", () => {
  for (const t of ["title_image", "feature_image", "key_art", "loading_screen"])
    assert.equal(categoryOf(art(t, ["X"])), FULL_SCREEN_ART, t);
  // The in-game title screen form (mapTitleScreen) lands in the same category and layout.
  const titleScreen = reading("img1", "title_image", "ROGUE LEGEND");
  titleScreen.screenshot.captureAreaPercent = 100;
  assert.equal(categoryOf(titleScreen), FULL_SCREEN_ART);
  assert.equal(proportion(titleScreen), PROPORTION.art);
  assert.equal(proportion(art("feature_image", ["X"])), PROPORTION.art);
  const onGameplay = reading("img1", "feature_image", "X");
  onGameplay.screenshot.captures = reading("img1", "gameplay", "").screenshot.captures;
  assert.equal(categoryOf(onGameplay), "gameplay");
  const framed = reading("img1", "feature_image", "X");
  framed.screenshot.composition = "capture_in_marketing_art";
  assert.equal(categoryOf(framed), PROMO);
  assert.equal(categoryOf(reading("img1", "metagame", "X")), "metagame");
});

test("tags: the game logo (brand only, not a partner's) and what the art's line says", () => {
  const g = "Rogue Legend";
  assert.equal(showsLogo(art("feature_image", ["ROGUE LEGEND"]), g), true);
  assert.equal(showsLogo(art("feature_image", ["EPIC!"], ["Sword & Staff game logo"]), g), true);
  assert.equal(showsLogo(art("feature_image", ["EPIC!"], ["publisher logo"]), g), false);
  assert.equal(showsLogo(art("feature_image", ["EPIC!"], ["small chick mascot icon"]), g), false);
  assert.equal(
    artMessage(art("title_image", ["ROGUE LEGEND"], ["the ROGUE LEGEND game logo"]), g),
    "logo_only",
  );
  assert.equal(artMessage(art("feature_image", ["ULTRA-CASUAL IDLE RPG"]), g), "headline");
  assert.equal(artMessage(art("feature_image", ["HAPPY 2.5 ANNIVERSARY!"]), g), "event_offer");
  assert.equal(artMessage(art("feature_image", ["Gift Code: ANNIV2P5"]), g), "event_offer");
  assert.equal(artMessage(art("feature_image", ["LIVING IS FORTUNE", "DAY 2"]), g), "event_offer");
  assert.equal(artMessage(art("feature_image", ["BATTLE 'EM!", "VS"]), g), "showcase");
  assert.equal(artMessage(art("feature_image", []), g), "picture_only");
});

/** US position 1 as audited: 5 of 8 competitors open with art, 4 with a line (2 events). */
function usOpeners() {
  const g = (name: string, first: ImageAnalysis) => [
    entry(name, 1, first),
    entry(name, 2, reading("img2", "gameplay", "FIGHT")),
    entry(name, 3, reading("img3", "metagame", "UPGRADE")),
  ];
  const theirs = [
    ...g("Archero 2", art("title_image", ["ARCHERO 2"], ["Archero 2 game logo"])),
    ...g(
      "Sword x Staff",
      art("feature_image", ["ULTRA-CASUAL IDLE RPG"], ["Sword & Staff game logo"]),
    ),
    ...g(
      "Legend of Mushroom",
      art("feature_image", ["HAPPY 2.5 ANNIVERSARY!"], ["Legend of Mushroom game logo"]),
    ),
    ...g("Survivor.io", art("feature_image", ["Celebrating 4 years!"], ["SURVIVOR.io game logo"])),
    ...g("Path of Kings", art("feature_image", ["EPIC ADVENTURES!"])),
    ...g("Capybara Go", reading("img1", "gameplay", "LIFE IS FULL OF SURPRISES")),
    ...g("Overgeared Hero", reading("img1", "gameplay", "GET READY")),
    ...g("Clash of Critters", reading("img1", "metagame", "COLLECT'EM!")),
  ];
  const ours = [
    entry("Rogue Legend", 1, art("title_image", ["ROGUE LEGEND"], ["the ROGUE LEGEND game logo"])),
    entry("Rogue Legend", 2, reading("img2", "gameplay", "BATTLE AND LEVEL UP!")),
    entry("Rogue Legend", 3, reading("img3", "metagame", "FIND COMPANIONS!")),
  ];
  const decks = [...new Set(theirs.map((e) => e.name))].map((n) => ({
    appId: n,
    name: n,
    deckLength: 3,
  }));
  const p = findPatterns(theirs, decks);
  return { theirs, ours, p, fit: patternFit(theirs, ours, p, 3, plainLabel) };
}

test("compare by type first, then by message and logo: the audited US opening", () => {
  const { fit, p } = usOpeners();
  const byId = new Map(fit.patterns.map((x) => [x.id, x]));
  const open = byId.get("position-1");
  assert.equal(open?.text, "Opens with Title screen / full-screen art");
  assert.equal(open?.evidence, "5 of 8 competitors");
  assert.equal(open?.fits, true);
  assert.equal(byId.get("uses-feature_image"), undefined, "no feature image split any more");
  const line = byId.get("position-1-message");
  assert.equal(line?.text, "Opening art carries a line beyond the logo");
  assert.match(line?.evidence ?? "", /^4 of 5 .*\(2 of them event or offer lines/);
  assert.equal(line?.strength, "partial", "event lines alone cannot make it a full pattern");
  assert.equal(line?.fits, false);
  assert.equal(line?.reason, "ours: logo only");
  assert.equal(byId.get("position-1-logo")?.evidence.startsWith("4 of 5"), true);
  assert.equal(byId.get("position-1-logo")?.fits, true);
  assert.equal(byId.get("logo-first-3")?.fits, true);
  assert.ok(
    fit.keyPoints.some((k) => k.startsWith("Opening art carries a line beyond the logo: 4 of 5")),
  );
  // Counts, never percentages, and no internal codes in anything the user reads.
  for (const x of fit.patterns)
    for (const s of [x.text, x.evidence, x.reason]) {
      assert.doesNotMatch(s, /\d%/, s);
      assert.doesNotMatch(s, /feature_image|title_image|key_art|full_screen_art|positions \d/, s);
    }
  assert.equal(p.tags?.art.n, 5);
  assert.equal(p.tags?.art.withLogo, 4);
});

test("a category without a definition never makes a pattern, key point or A/B gap", () => {
  const theirs = ["a", "b", "c"].flatMap((n) => [
    entry(n, 1, reading("img1", "other", "X")),
    entry(n, 2, reading("img2", "gameplay", "X")),
  ]);
  const ours = [
    entry("o", 1, reading("img1", "gameplay", "X")),
    entry("o", 2, reading("img2", "gameplay", "X")),
  ];
  const decks = ["a", "b", "c"].map((n) => ({ appId: n, name: n, deckLength: 2 }));
  const fit = patternFit(theirs, ours, findPatterns(theirs, decks), 2, plainLabel);
  assert.equal(hasDefinition("other"), false);
  assert.ok(!fit.patterns.some((x) => x.categories?.includes("other")));
  assert.ok(!fit.keyPoints.some((k) => /other/i.test(k)));
  const saved: FitSummary = {
    ...fit,
    patterns: [
      {
        id: "position-1",
        group: "order",
        strength: "pattern",
        text: "Opens with Other",
        evidence: "3 of 3 competitors",
        fits: false,
        reason: "ours: Gameplay",
        categories: ["other"],
        basis: { n: 3, of: 3, unit: "games", positions: [1], games: [], imageIds: [], ours: [1] },
      },
    ],
  };
  assert.deepEqual(
    abCandidates(saved, { gl: "us", ourDeckLength: 2, deckLength: { min: 2, max: 2 } }),
    [],
  );
});

test("each finding once: no 'Uses X' key point when a position already says X is missing", () => {
  const theirs = ["a", "b", "c"].flatMap((n) => [
    entry(n, 1, reading("img1", "metagame", "X")),
    entry(n, 2, reading("img2", "gameplay", "X")),
  ]);
  const ours = [
    entry("o", 1, reading("img1", "gameplay", "X")),
    entry("o", 2, reading("img2", "gameplay", "X")),
  ];
  const decks = ["a", "b", "c"].map((n) => ({ appId: n, name: n, deckLength: 2 }));
  const fit = patternFit(theirs, ours, findPatterns(theirs, decks), 2, plainLabel);
  assert.ok(fit.patterns.some((x) => x.id === "uses-metagame" && x.fits === false));
  assert.equal(fit.keyPoints.filter((k) => /menus and progression/i.test(k)).length, 1);
  const gaps = abCandidates(fit, { gl: "us", ourDeckLength: 2, deckLength: { min: 2, max: 2 } });
  assert.ok(!gaps.some((g) => g.kind === "uses-metagame"));
});

test("recommendations never copy an event or offer line", () => {
  const rec = {
    rationale: "r",
    positions: [
      {
        position: 1,
        screenType: "title_image",
        subtype: "",
        source: "keep our current position 1",
        screenshot: {
          orientation: "portrait",
          whatToCapture: "t",
          action: "a",
          atmosphere: "a",
          mainColours: "c",
        },
        marketingLayer: {
          present: true,
          proportion: PROPORTION.art,
          backgroundMask: { shape: "none", colour: "none", location: "none" },
          texts: [
            {
              role: "headline",
              text: "Happy anniversary!",
              colour: "w",
              strokeColour: "b",
              fontStyle: "f",
              size: "large",
              position: "top",
            },
          ],
          elements: [],
        },
        logo: { show: true, why: "4 of 5" },
        why: "w",
      },
    ],
  } as Parameters<typeof recommendationProblems>[0];
  assert.ok(recommendationProblems(rec, 1, 1).some((p) => /event or offer line/.test(p)));
});

test("How we sort images: each category and tag used, defined, with an example", () => {
  const { theirs, ours } = usOpeners();
  const games = [
    { name: "Rogue Legend", ours: true, e: ours },
    ...[...new Set(theirs.map((e) => e.name))].map((n) => ({
      name: n,
      ours: false,
      e: theirs.filter((x) => x.name === n),
    })),
  ].map((g) => ({
    name: g.name,
    ours: g.ours,
    rows: g.e.map((x) => ({
      position: x.position,
      imageId: x.imageId,
      thumb: `t/${x.imageId}.webp`,
      file: null,
      category: categoryOf(x.final),
      logo: showsLogo(x.final, x.name),
      message: categoryOf(x.final) === FULL_SCREEN_ART ? artMessage(x.final, x.name) : null,
    })),
  }));
  const s = sortingPart(games, null);
  assert.ok(s.intro[0]?.length);
  const artItem = s.items.find((i) => i.key === FULL_SCREEN_ART);
  assert.equal(artItem?.label, "Title screen / full-screen art");
  assert.equal(artItem?.example?.name, "Archero 2", "a competitor example first");
  for (const k of ["logo", "logo_only", "headline", "event_offer", "gameplay", "metagame"])
    assert.ok(
      s.items.some((i) => i.key === k && i.definition && i.unlike && i.example),
      k,
    );
});
