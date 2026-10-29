import assert from "node:assert/strict";
import { test } from "node:test";
import { withBanners } from "../src/analysis/banner.ts";
import { categoryOf, hasDefinition, PROMO_BANNER } from "../src/analysis/categories.ts";
import type { ImageIdentity } from "../src/analysis/identity.ts";
import { orientationOf, ratioLabel } from "../src/analysis/image-facts.ts";
import { labeler } from "../src/analysis/labels.ts";
import { layerStructure } from "../src/analysis/layer-structure.ts";
import { compareOurs } from "../src/analysis/ours-vs.ts";
import { type DeckEntry, findPatterns } from "../src/analysis/patterns.ts";
import { withCurrentMapping } from "../src/analysis/record-refresh.ts";
import type { AnalysisRecord } from "../src/analysis/records.ts";
import type { ImageAnalysis } from "../src/analysis/schema.ts";
import { reading } from "./helpers/fake-provider.ts";

// Fixtures from the Comfy Mahjong Pilot (2026-10-29): image 1 of Vita Mahjong and Mahjong Blast
// is a 1920x1080 banner (logo, slogan, tile art; no band) in a portrait game; ours is a
// 1080x1920 title art with a "RELAXING" band. The model called all three title art.
const SIZE = { landscape: [1920, 1080], portrait: [1080, 1920] } as const;

function art(headline: string, band: boolean, tiles: boolean): ImageAnalysis {
  const r = reading("img1", "title_image", headline);
  r.screenshot.composition = "pure_art";
  r.screenshot.subtype = "logo_with_art";
  r.screenshot.captures = [];
  r.screenshot.captureAreaPercent = 0;
  if (!band) r.marketingLayer.backgroundMasks = [];
  r.marketingLayer.elements = tiles
    ? [
        {
          kind: "item",
          what: "diamond-shaped pyramid stack of mahjong tiles",
          position: "right-centre",
          pose: "n/a",
          colours: "white, green",
          scale: "large",
          breaksFrame: false,
          region: { x: 52, y: 12, w: 45, h: 76 },
        },
      ]
    : [];
  return r;
}

function gameplay(o: "portrait" | "landscape"): ImageAnalysis {
  const r = reading("img1", "gameplay", "Large Tiles");
  for (const c of r.screenshot.captures) c.orientation = o;
  return r;
}

function rec(appId: string, position: number, final: ImageAnalysis, o: keyof typeof SIZE) {
  const [width, height] = SIZE[o];
  const record: AnalysisRecord = {
    imageId: `${appId}-${position}`,
    appId,
    gl: "us",
    hl: "en",
    position,
    status: "ok",
    final,
    producer: null,
    reviewer: null,
    adjudication: null,
    differences: [],
    problems: [],
    runId: "r",
    updatedAt: "",
    identity: {
      game: appId,
      image: { width, height, orientation: orientationOf(width, height), ratio: "" },
    } as unknown as ImageIdentity,
  };
  return record;
}

function deck(appId: string, first: ImageAnalysis, firstO: keyof typeof SIZE) {
  return [
    rec(appId, 1, first, firstO),
    ...[2, 3, 4].map((p) => rec(appId, p, gameplay("portrait"), "portrait")),
  ];
}

const records = [
  ...deck("vita", art("Train Your Brain", false, true), "landscape"),
  ...deck("blast", art("MAHJONG Match 3D", false, false), "landscape"),
  ...deck("ours", art("RELAXING", true, false), "portrait"),
];
const mapped = withCurrentMapping(new Map(records.map((r) => [r.imageId, r])));
const final = (id: string) => mapped.get(id)?.final as ImageAnalysis;

test("a landscape banner in a portrait game is a promotional banner; portrait title art is not", () => {
  assert.ok(hasDefinition(PROMO_BANNER));
  assert.equal(categoryOf(final("vita-1")), PROMO_BANNER);
  assert.equal(categoryOf(final("blast-1")), PROMO_BANNER);
  assert.equal(categoryOf(final("ours-1")), "full_screen_art");
  assert.equal(mapped.get("vita-1")?.banner?.playOrientation, "portrait");
  // The model's description, headline and subtype are kept; the saved record is not changed.
  assert.equal(final("vita-1").headline, "Train Your Brain");
  assert.equal(final("vita-1").screenshot.subtype, "logo_with_art");
  assert.equal(records[0]?.final?.screenshot.screenType, "title_image");
  assert.equal(final("vita-2").screenshot.screenType, "gameplay");
});

test("landscape gameplay and landscape art in a landscape game are never banners", () => {
  const mushroom = [
    rec("mush", 1, art("Legend", false, false), "landscape"),
    ...[2, 3].map((p) => rec("mush", p, gameplay("landscape"), "landscape")),
    // A portrait game's landscape gameplay screenshot shows the game's interface: not a banner.
    rec("vita", 7, gameplay("landscape"), "landscape"),
    ...deck("vita", gameplay("portrait"), "portrait"),
  ];
  const out = withBanners(new Map(mushroom.map((r) => [r.imageId, r])));
  assert.equal(categoryOf(out.get("mush-1")?.final as ImageAnalysis), "full_screen_art");
  for (const id of ["mush-2", "mush-3", "vita-7"]) {
    assert.equal(out.get(id)?.banner, undefined, id);
    assert.equal(categoryOf(out.get(id)?.final as ImageAnalysis), "gameplay", id);
  }
});

test("layer structure: screenshot + layer, art + layer, all marketing art", () => {
  assert.equal(layerStructure(final("vita-1")), "all_art");
  assert.equal(layerStructure(final("blast-1")), "all_art");
  assert.equal(layerStructure(final("ours-1")), "art_layer");
  assert.equal(layerStructure(final("ours-2")), "screenshot_layer");
  assert.equal(layerStructure(reading("i", "gameplay", "", false)), "screenshot_only");
  // Portrait title art whose product art is drawn into the advert itself, with no band.
  assert.equal(layerStructure(art("Train Your Brain", false, true)), "all_art");
});

test("position 1 lists the concrete differences and never says following", () => {
  const entry = (r: AnalysisRecord): DeckEntry => {
    const [w, h] = r.identity?.image?.orientation === "landscape" ? SIZE.landscape : SIZE.portrait;
    const m = mapped.get(r.imageId) as AnalysisRecord;
    return {
      appId: r.appId,
      name: r.appId,
      position: r.position,
      imageId: r.imageId,
      canvas: orientationOf(w, h),
      ratio: ratioLabel(w, h),
      size: `${w}x${h}`,
      focus: r.position === 1 ? "story / art" : null,
      final: m.final as ImageAnalysis,
    };
  };
  const all = records.map(entry);
  const theirs = all.filter((e) => e.appId !== "ours");
  const ours = all.filter((e) => e.appId === "ours");
  const p = findPatterns(theirs, [
    { appId: "vita", name: "vita", deckLength: 4 },
    { appId: "blast", name: "blast", deckLength: 4 },
  ]);
  assert.deepEqual(p.perPosition[0]?.canvases?.[0], { key: "landscape", n: 2, share: 1 });
  assert.deepEqual(p.perPosition[0]?.layers?.[0], { key: "all_art", n: 2, share: 1 });
  const v = compareOurs(ours, p, 4, labeler()).positions[0];
  assert.ok(v);
  assert.notEqual(v.verdict, "following");
  assert.equal(v.verdict, "very different");
  const text = v.reasons.join("; ");
  assert.match(
    text,
    /category: 2 of 2 competitors show Promotional banner at image 1; ours is Title screen \/ full-screen art/,
  );
  assert.match(
    text,
    /orientation: 2 of 2 competitors use a landscape image \(1920x1080, 16:9\) here; ours is portrait \(1080x1920, 9:16\)/,
  );
  assert.match(
    text,
    /layer structure: 2 of 2 competitors are all marketing art, no separate layer; ours is art \+ marketing layer/,
  );
  assert.doesNotMatch(text, /focus:/, "the same focus is not a difference");
  assert.equal(v.ours.canvas, "portrait");
  assert.equal(v.ours.layerStructure, "art_layer");
  // Position 2 (portrait gameplay with a band everywhere) still follows.
  assert.equal(compareOurs(ours, p, 4, labeler()).positions[1]?.verdict, "following");
});

test("same category but another orientation and layer is not following either", () => {
  const e = (appId: string, o: keyof typeof SIZE, a: ImageAnalysis): DeckEntry => ({
    appId,
    name: appId,
    position: 1,
    imageId: appId,
    canvas: o,
    ratio: ratioLabel(SIZE[o][0], SIZE[o][1]),
    final: a,
  });
  const gp = gameplay("landscape");
  const theirs = [e("a", "landscape", gp), e("b", "landscape", gp)];
  const p = findPatterns(theirs, [
    { appId: "a", name: "a", deckLength: 1 },
    { appId: "b", name: "b", deckLength: 1 },
  ]);
  const mine = reading("img1", "gameplay", "", false);
  const v = compareOurs([e("o", "portrait", mine)], p, 1).positions[0];
  assert.equal(v?.verdict, "very different");
  assert.ok(
    v?.reasons.some((r) => r.startsWith("orientation: 2 of 2 competitors use a landscape")),
  );
  assert.ok(v?.reasons.some((r) => r.startsWith("layer structure:")));
  // One listed difference alone (here the aspect: 9:20 against 9:16) is never "following".
  const tall = { ...e("o", "portrait", reading("img1", "gameplay", "")), ratio: "9:20" };
  const pp = findPatterns(
    [
      e("a", "portrait", reading("img1", "gameplay", "")),
      e("b", "portrait", reading("i", "gameplay", "")),
    ],
    [
      { appId: "a", name: "a", deckLength: 1 },
      { appId: "b", name: "b", deckLength: 1 },
    ],
  );
  const one = compareOurs([tall], pp, 1).positions[0];
  assert.equal(one?.verdict, "slightly different");
  assert.ok(one?.reasons.some((r) => r.startsWith("aspect: 2 of 2 competitors use 9:16")));
});

test("the model's banner note counts only when the game's play orientation is unknown", () => {
  const noted = art("Big sale", false, false);
  noted.notes = "Wide promotional banner with the logo.";
  const only = rec("solo", 1, noted, "landscape");
  assert.equal(withBanners(new Map([["x", only]])).get("x")?.banner?.playOrientation, null);
  // A landscape game: the pixels and its other screens decide, whatever the note says.
  const land = [
    rec("land", 1, noted, "landscape"),
    ...[2, 3].map((p) => rec("land", p, gameplay("landscape"), "landscape")),
  ];
  const out = withBanners(new Map(land.map((r) => [r.imageId, r])));
  assert.equal(out.get("land-1")?.banner, undefined);
  // Portrait art in a landscape game is not wide: it stays full-screen art.
  const tall = [rec("land", 1, art("X", false, false), "portrait"), ...land.slice(1)];
  const out2 = withBanners(new Map(tall.map((r) => [r.imageId, r])));
  assert.equal(categoryOf(out2.get("land-1")?.final as ImageAnalysis), "full_screen_art");
});
