import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { plainLabel } from "../src/analysis/labels.ts";
import { patternFit } from "../src/analysis/pattern-fit.ts";
import { type DeckEntry, findPatterns } from "../src/analysis/patterns.ts";
import { mapTitleScreen } from "../src/analysis/record-refresh.ts";
import {
  labelProblems,
  type Recommendations,
  recommendationProblems,
} from "../src/analysis/synthesis-schema.ts";
import { NAV_SCRIPT } from "../src/view/gallery-nav.ts";
import { REPORT_SCRIPT } from "../src/view/gallery-report.ts";
import { REPORT_PARTS_SCRIPT } from "../src/view/gallery-report-parts.ts";
import { reading } from "./helpers/fake-provider.ts";

function entry(appId: string, position: number, type: string): DeckEntry {
  return {
    appId,
    name: appId,
    position,
    imageId: `${appId}${position}`,
    canvas: "portrait",
    final: reading(`img${position}`, type, "X"),
  };
}

const theirs = [
  entry("a", 1, "title_image"),
  entry("a", 2, "gameplay"),
  entry("a", 3, "metagame"),
  entry("b", 1, "title_image"),
  entry("b", 2, "gameplay"),
  entry("b", 3, "gameplay"),
];
const decks = [
  { appId: "a", name: "a", deckLength: 3 },
  { appId: "b", name: "b", deckLength: 3 },
];

test("pattern check: order, sequence and content patterns, each with our fit and a reason", () => {
  const p = findPatterns(theirs, decks);
  const ours = [entry("o", 1, "gameplay"), entry("o", 2, "title_image"), entry("o", 3, "gameplay")];
  const f = patternFit(theirs, ours, p, 3, plainLabel);
  const byId = new Map(f.patterns.map((x) => [x.id, x]));
  assert.equal(byId.get("position-1")?.fits, false);
  assert.match(byId.get("position-1")?.reason ?? "", /ours: Gameplay/);
  // One game each at position 3 is a tie, not a pattern.
  assert.equal(byId.get("position-3"), undefined);
  assert.equal(byId.get("before-full_screen_art-gameplay")?.fits, false);
  assert.equal(byId.get("uses-full_screen_art")?.fits, true);
  assert.equal(byId.get("uses-metagame")?.strength, "partial");
  assert.equal(byId.get("uses-metagame")?.fits, false);
  assert.notEqual(f.verdict, "optimised");
  assert.ok(f.keyPoints.length >= 2);
  // A dominant pattern at a position is a firm "Copy the pattern" directive, first (2026-10-30).
  assert.match(
    f.keyPoints[0] ?? "",
    /^Copy the pattern: .*title screen \/ full-screen art.* image 1/,
  );
  const same = patternFit(
    theirs,
    [entry("o", 1, "title_image"), entry("o", 2, "gameplay"), entry("o", 3, "gameplay")],
    p,
    3,
    plainLabel,
  );
  assert.equal(same.verdict, "optimised");
  // Only the partial pattern we miss (no metagame screen) is left as a key point.
  assert.equal(same.keyPoints.length, 1);
  assert.match(same.keyPoints[0] ?? "", /Menus and progression/);
});

test("a title image becomes the in-game title screen, without AI and idempotently", () => {
  const r = reading("img1", "title_image", "ROGUE LEGEND");
  r.screenshot.composition = "pure_art";
  r.screenshot.captures = [];
  r.screenshot.captureAreaPercent = 0;
  const m = mapTitleScreen(r, "portrait");
  assert.equal(m.final.screenshot.composition, "single_full_capture");
  assert.equal(m.final.screenshot.captures[0]?.screenType, "title_image");
  assert.equal(m.final.screenshot.subtype, "title_screen");
  assert.equal(m.mappedFrom?.original?.composition, "pure_art");
  assert.equal(mapTitleScreen(m.final, "portrait").mappedFrom, null);
  const g = reading("img2", "gameplay", "X");
  assert.equal(mapTitleScreen(g, "portrait").mappedFrom, null);
});

test("menu: any hash maps to a page, unknown ones to Screenshots", () => {
  const ctx: Record<string, unknown> = { window: { addEventListener: () => {} } };
  runInNewContext(`${NAV_SCRIPT}\nthis.f = pageFromHash;`, ctx);
  const f = ctx.f as (h: string) => string;
  assert.equal(f("#report"), "report");
  assert.equal(f("#Analysis"), "analysis");
  assert.equal(f("#x"), "screenshots");
  assert.equal(f(""), "screenshots");
});

test("report page: position rows start with our game, fit marks show, text is escaped", () => {
  const ctx: Record<string, unknown> = {
    IMG: "../images/",
    esc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    infoBtn: (id: string) => `<button class="info" data-info="${id}">i</button>`,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { addEventListener: () => {}, getElementById: () => null },
  };
  runInNewContext(
    `${REPORT_SCRIPT}\n${REPORT_PARTS_SCRIPT}\nthis.pos = positionsHtml; this.fit = fitHtml;`,
    ctx,
  );
  const row = (position: number, screen: string, headline: string) => ({
    position,
    imageId: `id${position}`,
    thumb: `t${position}.webp`,
    file: null,
    screen,
    headline,
    state: "analysed",
  });
  const d = {
    games: [
      { name: "Comp", ours: false, rows: [row(1, "Gameplay", "GO")] },
      { name: "Ours", ours: true, rows: [row(1, "Title image", "<script>x</script>")] },
    ],
    oursVs: null,
    coverage: { used: 2, total: 2, missing: [] },
    ai: null,
    fit: {
      patterns: [
        {
          id: "p",
          group: "order",
          strength: "pattern",
          text: "Position 1 shows Gameplay",
          evidence: "e",
          fits: false,
          reason: "ours shows Title image",
        },
      ],
    },
  };
  const html = (ctx.pos as (x: unknown) => string)(d);
  assert.ok(html.indexOf("Ours (ours)") < html.indexOf("Comp"), "our column comes first");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&#60;script&#62;/);
  assert.match(html, /data-info="id1"/);
  assert.match((ctx.fit as (x: unknown) => string)(d), /\[X\] different/);
});

test("a recommended slot whose label does not match its spec is caught by code", () => {
  const slot = (position: number, screenType: string, source: string, proportion: string) => ({
    position,
    screenType,
    subtype: "",
    source,
    screenshot: {
      orientation: "portrait",
      whatToCapture: "",
      action: "",
      atmosphere: "",
      mainColours: "",
    },
    marketingLayer: {
      present: false,
      proportion,
      backgroundMask: { shape: "", colour: "", location: "" },
      texts: [],
      elements: [],
    },
    why: "",
  });
  const ours = new Map([
    [1, "title_image"],
    [5, "metagame"],
  ]);
  const r = {
    rationale: "",
    positions: [
      slot(1, "title_image", "keep our current position 1", "marketing image, no screenshot"),
      slot(2, "feature_image", "recapture our position 5", "marketing image, no screenshot"),
      slot(3, "gameplay", "keep our current position 5", "full screenshot, small layer"),
      slot(4, "gameplay", "new capture", "marketing image, no screenshot"),
    ],
  } as unknown as Recommendations;
  const p = recommendationProblems(r, 1, 9, ours);
  assert.equal(p.length, 3);
  assert.match(
    p[0] ?? "",
    /position 2 .*recaptures an in-game screen \(our position 5, metagame\)/,
  );
  assert.match(p[1] ?? "", /position 3 .*keeps our position 5, which is metagame/);
  // Saved before the wording rule: the old layout name is still recognised.
  assert.match(p[2] ?? "", /position 4 .*layout is full-screen art/);
});

test("a kept or recaptured position our deck does not have is caught", () => {
  const r = {
    rationale: "",
    positions: [
      {
        position: 1,
        screenType: "gameplay",
        subtype: "",
        source: "keep our current position 9",
        screenshot: {
          orientation: "portrait",
          whatToCapture: "",
          action: "",
          atmosphere: "",
          mainColours: "",
        },
        marketingLayer: {
          present: false,
          proportion: "full screenshot, small layer",
          backgroundMask: { shape: "", colour: "", location: "" },
          texts: [],
          elements: [],
        },
        why: "",
      },
    ],
  } as unknown as Recommendations;
  assert.match(labelProblems(r, new Map([[1, "gameplay"]])).join(), /no position 9/);
});
