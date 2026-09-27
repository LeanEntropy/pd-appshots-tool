import assert from "node:assert/strict";
import { test } from "node:test";
import { colourFamily, hexFamily } from "../src/analysis/colours.ts";
import { labeler } from "../src/analysis/labels.ts";
import { compareOrders, type OrderSnapshot } from "../src/analysis/orders.ts";
import { compareOurs } from "../src/analysis/ours-vs.ts";
import { type DeckEntry, findPatterns, PROPORTION, proportion } from "../src/analysis/patterns.ts";
import { mapKeyArt, refreshRecord, TAXONOMY_MAPPING } from "../src/analysis/record-refresh.ts";
import { markdownToHtml } from "../src/view/md-html.ts";
import { reading } from "./helpers/fake-provider.ts";

function entry(appId: string, position: number, type: string, layer = true, area = 85): DeckEntry {
  const r = reading(`img${position}`, type, "X", layer);
  r.screenshot.captureAreaPercent = area;
  return {
    appId,
    name: appId,
    position,
    imageId: `${appId}${position}`,
    canvas: "portrait",
    final: r,
  };
}

const comp = [
  entry("a", 1, "key_art", true, 0),
  entry("a", 2, "gameplay"),
  entry("a", 3, "metagame"),
  entry("b", 1, "key_art", true, 0),
  entry("b", 2, "gameplay"),
  entry("b", 3, "gameplay", false),
  entry("c", 1, "gameplay", true, 30),
  entry("c", 2, "gameplay"),
];
const decks = [
  { appId: "a", name: "a", deckLength: 3 },
  { appId: "b", name: "b", deckLength: 3 },
  { appId: "c", name: "c", deckLength: 2 },
];

test("colour families from hex, with the name as fallback", () => {
  assert.equal(hexFamily("#1f6fd0"), "blue");
  assert.equal(hexFamily("#f7f704"), "yellow");
  assert.equal(hexFamily("#000000"), "black");
  assert.equal(hexFamily("#ffffff"), "white");
  assert.equal(hexFamily("#c0392b"), "red");
  assert.equal(colourFamily("royal purple", "unknown"), "purple");
});

test("layer vs screenshot proportion buckets", () => {
  assert.equal(proportion(entry("x", 1, "gameplay", false).final), PROPORTION.none);
  assert.equal(proportion(entry("x", 1, "gameplay", true, 90).final), PROPORTION.small);
  assert.equal(proportion(entry("x", 1, "gameplay", true, 60).final), PROPORTION.large);
  assert.equal(proportion(entry("x", 1, "gameplay", true, 30).final), PROPORTION.inside);
});

test("patterns per position, screen types used, layer share and co-occurrence", () => {
  const p = findPatterns(comp, decks);
  assert.equal(p.images, 8);
  assert.deepEqual(p.perPosition[0]?.top, { key: "key_art", n: 2, share: 0.67 });
  assert.equal(p.perPosition[1]?.top?.share, 1);
  const gp = p.screenTypes.find((t) => t.key === "gameplay");
  assert.deepEqual(gp && [gp.games, gp.images, gp.positions], [3, 5, [1, 2, 3]]);
  assert.equal(p.marketingLayer.share, 0.88);
  assert.equal(p.deckLength.median, 3);
  assert.equal(p.byScreenType.find((t) => t.key === "gameplay")?.maskColours[0]?.key, "yellow");
  assert.equal(p.colours.screenshot[0]?.key, "blue");
});

test("our deck vs the patterns: following, slightly and very different, with reasons", () => {
  const p = findPatterns(comp, decks);
  const ours = [
    entry("o", 1, "key_art", true, 0),
    entry("o", 2, "metagame"),
    entry("o", 3, "social"),
  ];
  const v = compareOurs(ours, p, 3);
  assert.deepEqual(
    v.positions.map((x) => x.verdict),
    ["following", "slightly different", "very different"],
  );
  assert.ok(v.positions[2]?.reasons[0]?.includes("rare or unused"));
  assert.notEqual(v.overall.verdict, "following");
  assert.ok(v.overall.reasons.some((r) => r.includes("Gameplay is used by 100%")));
});

test("store order snapshots: moves, new, removed and re-typed positions", () => {
  const snap = (ids: string[], types: string[]): OrderSnapshot => ({
    appId: "a",
    name: "a",
    gl: "us",
    hl: "en",
    date: "2026-09-27",
    fetchedAt: "",
    positions: ids.map((imageId, i) => ({ position: i + 1, imageId, device: "phone" })),
    derived: {
      schema: "s",
      complete: true,
      updatedAt: "",
      positions: types.map((t, i) => ({
        position: i + 1,
        screenType: t,
        subtype: "",
        orientation: "portrait",
        composition: "single_full_capture",
        captureOrientations: ["portrait"],
        marketingLayer: true,
      })),
    },
  });
  const ch = compareOrders(
    snap(["x", "y", "z"], ["a", "b", "c"]),
    snap(["y", "x", "n"], ["b", "a", "d"]),
  );
  assert.ok(ch.includes("image moved from position 2 to 1"));
  assert.ok(ch.includes("image at position 3 was removed"));
  assert.ok(ch.includes("position 3: new image (D, was C)"));
});

test("report markdown becomes escaped HTML with server image paths", () => {
  const id = "a".repeat(64);
  const html = markdownToHtml(
    `## Title <script>\n\n| A | B |\n|---|---|\n| [![x](../../images/thumb/${id}.webp)](../../images/orig/${id}.png) | a \\| b |\n\n- **bold** item`,
  );
  assert.match(html, /<h3>Title &lt;script&gt;<\/h3>/);
  assert.match(html, new RegExp(`src="/images/thumb/${id}.webp"`));
  assert.match(html, new RegExp(`data-info="${id}"`));
  assert.match(html, /<td>a \| b<\/td>/);
  assert.match(html, /<li><strong>bold<\/strong> item<\/li>/);
});

test("display labels: taxonomy names first, humanised codes otherwise", () => {
  const label = labeler({
    screenTypes: [{ id: "title_image", label: "Title image", subtypes: [] }],
    subtypeLabels: { pvp: "PvP" },
  });
  assert.equal(label("title_image"), "Title image");
  assert.equal(label("pvp"), "PvP");
  assert.equal(label("board_dice"), "Board dice");
});

test("key art without a capture maps to title image (logo) or feature image (callout)", () => {
  const art = (texts: string[], elements: string[] = []) => {
    const r = reading("img1", "key_art", texts[0] ?? "");
    r.screenshot.captureAreaPercent = 0;
    r.screenshot.captures = [];
    r.screenshot.composition = "pure_art";
    r.marketingLayer.texts = texts.map((t) => ({
      ...(r.marketingLayer.texts[0] as (typeof r.marketingLayer.texts)[number]),
      text: t,
    }));
    r.marketingLayer.elements = elements.map((kind) => ({
      kind: kind as "logo",
      what: kind === "logo" ? "Archero 2 logo" : kind,
      position: "top",
      pose: "n/a",
      colours: "gold",
      scale: "large",
      breaksFrame: false,
      region: { x: 0, y: 0, w: 10, h: 10 },
    }));
    return r;
  };
  const t = mapKeyArt(art(["ARCHERO 2"]), "Archero 2");
  assert.equal(t.final.screenshot.screenType, "title_image");
  assert.equal(t.final.screenshot.composition, "pure_art", "the mapping keeps the composition");
  assert.equal(t.mappedFrom?.screenType, "key_art");
  assert.equal(
    mapKeyArt(art([], ["logo"]), "Archero 2").final.screenshot.screenType,
    "title_image",
  );
  assert.equal(
    mapKeyArt(art([], ["logo"]), "Other Game").mappedFrom,
    null,
    "a publisher logo is not the title",
  );
  assert.equal(
    mapKeyArt(art(["NEW HEROES!"]), "Archero 2").final.screenshot.screenType,
    "feature_image",
  );
  const unclear = mapKeyArt(art([]), "Archero 2");
  assert.equal(unclear.mappedFrom, null);
  const withCapture = art(["ARCHERO 2"]);
  withCapture.screenshot.captureAreaPercent = 70;
  withCapture.screenshot.composition = "capture_in_marketing_art";
  withCapture.screenshot.captures = reading("img1", "gameplay", "").screenshot.captures;
  assert.equal(mapKeyArt(withCapture, "Archero 2").mappedFrom, null);
});

test("a changed mapping version re-maps from the model's original classification", () => {
  const r = reading("img1", "key_art", "ARCHERO 2");
  r.screenshot.captureAreaPercent = 0;
  r.screenshot.captures = [];
  r.screenshot.composition = "pure_art";
  const identityOf = () => ({ game: "Archero 2" }) as never;
  const rec = {
    imageId: "x",
    schema: "analysis-schema.v2",
    appId: "a",
    gl: "us",
    hl: "en",
    position: 1,
    status: "ok" as const,
    final: r,
    producer: null,
    reviewer: null,
    adjudication: null,
    differences: [],
    problems: [],
    runId: "r",
    updatedAt: "",
  };
  const once = refreshRecord(rec, identityOf, "t@3");
  assert.equal(once.final?.screenshot.screenType, "title_image");
  assert.equal(once.mapping, TAXONOMY_MAPPING);
  const twice = refreshRecord(once, identityOf, "t@3");
  assert.deepEqual(twice.final, once.final);
  const stale = refreshRecord({ ...once, mapping: "old" }, identityOf, "t@3");
  assert.equal(stale.mappedFrom?.screenType, "key_art");
  assert.equal(stale.final?.screenshot.screenType, "title_image");
});

test("composition, captures per image, portrait-in-landscape and orientation per country", () => {
  const land = entry("a", 1, "gameplay");
  land.canvas = "landscape";
  land.gl = "jp";
  land.hl = "ja";
  land.final.screenshot.composition = "multiple_captures";
  const cap = land.final.screenshot.captures[0] as (typeof land.final.screenshot.captures)[number];
  land.final.screenshot.captures = [cap, { ...cap }];
  const us = entry("b", 1, "gameplay");
  us.gl = "us";
  us.hl = "en";
  const p = findPatterns(
    [land, us],
    [
      { appId: "a", name: "a", deckLength: 1 },
      { appId: "b", name: "b", deckLength: 1 },
    ],
  );
  assert.deepEqual(p.portraitInLandscape, { n: 1, share: 0.5 });
  assert.deepEqual(
    p.capturesPerImage.map((c) => c.key),
    ["1", "2"],
  );
  assert.deepEqual(
    p.composition.map((c) => c.key),
    ["multiple_captures", "single_full_capture"],
  );
  assert.deepEqual(
    p.orientation.byCountry.map((c) => [c.market, c.mix[0]?.key]),
    [
      ["jp-ja", "landscape"],
      ["us-en", "portrait"],
    ],
  );
});
