import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryOf, FULL_SCREEN_ART } from "../src/analysis/categories.ts";
import { artMessage, isEventLine } from "../src/analysis/image-tags.ts";
import { TAXONOMY_MAPPING, withCurrentMapping } from "../src/analysis/record-refresh.ts";
import { reading } from "./helpers/fake-provider.ts";

test("the run and the report read records with the same (current) mapping", () => {
  const r = reading("img1", "key_art", "ARCHERO 2");
  r.screenshot.composition = "pure_art";
  r.screenshot.captures = [];
  const rec = {
    imageId: "x",
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
    identity: { game: "Archero 2" } as never,
    mapping: "key-art-title-screen.v3",
  };
  const out = withCurrentMapping(new Map([["x", rec]])).get("x");
  assert.equal(out?.mapping, TAXONOMY_MAPPING);
  assert.equal(out?.final?.screenshot.screenType, "title_image");
});

test("title, key and loading art stay full-screen art even with a capture listed", () => {
  for (const t of ["title_image", "key_art", "loading_screen"]) {
    const r = reading("img1", t, "X");
    r.screenshot.composition = "capture_in_marketing_art";
    r.screenshot.captures = reading("img1", "gameplay", "").screenshot.captures;
    assert.equal(categoryOf(r), FULL_SCREEN_ART, t);
  }
});

test("heroes with only a name label are a showcase; with a headline they are a headline", () => {
  const r = reading("img1", "feature_image", "Dracula");
  r.screenshot.subtype = "character_showcase";
  const first = r.marketingLayer.texts[0] as (typeof r.marketingLayer.texts)[number];
  r.marketingLayer.texts = [{ ...first, role: "label" }];
  assert.equal(artMessage(r, "Rogue Legend"), "showcase");
  r.marketingLayer.texts = [{ ...first, role: "headline", text: "Get Stronger or Start Over" }];
  assert.equal(artMessage(r, "Rogue Legend"), "headline");
});

test("event or offer lines: time-limited phrasing only, not lasting gameplay words", () => {
  for (const t of [
    "HAPPY 2.5 ANNIVERSARY!",
    "Gift Code: ANNIV2P5",
    "DAY 2",
    "3,000 Summons!",
    "Rich new player rewards",
    "Celebrating 4 years!",
  ])
    assert.ok(isEventLine(t), t);
  for (const t of [
    "Summon legendary heroes",
    "Collect gems and gear",
    "Epic boss fights!",
    "Update your gear",
  ])
    assert.ok(!isEventLine(t), t);
});
