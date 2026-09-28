import assert from "node:assert/strict";
import { test } from "node:test";
import { asCounted } from "../src/analysis/categories.ts";
import { compareOurs } from "../src/analysis/ours-vs.ts";
import { type DeckEntry, findPatterns } from "../src/analysis/patterns.ts";
import { mapTitleScreen } from "../src/analysis/record-refresh.ts";
import type { ImageAnalysis } from "../src/analysis/schema.ts";
import { reading } from "./helpers/fake-provider.ts";

/** Full-screen art as the model saw it (no capture). */
function art(type: string, text: string): ImageAnalysis {
  const r = reading("img1", type, text);
  r.screenshot.composition = "pure_art";
  r.screenshot.captures = [];
  r.screenshot.captureAreaPercent = 0;
  return r;
}
/** A title image in its in-game title screen form (one 100% capture), as stored today. */
const titleScreen = (text: string) => mapTitleScreen(art("title_image", text), "portrait").final;
const entry = (name: string, position: number, final: ImageAnalysis): DeckEntry => ({
  appId: name,
  name,
  position,
  imageId: `${name}${position}`,
  canvas: "portrait",
  final,
});

test("every Title screen / full-screen art image counts as art in the composition statistics", () => {
  const mapped = titleScreen("ARCHERO 2");
  assert.equal(mapped.screenshot.composition, "single_full_capture", "the stored form");
  assert.equal(asCounted(mapped).screenshot.composition, "pure_art");
  assert.equal(asCounted(mapped).screenshot.captures.length, 0);
  const game = reading("img2", "gameplay", "FIGHT");
  assert.equal(asCounted(game), game, "a game screen is counted as it is");

  const theirs = [
    entry("Archero 2", 1, mapped),
    entry("Archero 2", 2, reading("img2", "gameplay", "FIGHT")),
    entry("Sword x Staff", 1, art("feature_image", "ULTRA-CASUAL IDLE RPG")),
    entry("Sword x Staff", 2, reading("img2", "gameplay", "FIGHT")),
  ];
  const decks = ["Archero 2", "Sword x Staff"].map((n) => ({ appId: n, name: n, deckLength: 2 }));
  const p = findPatterns(theirs, decks);
  assert.deepEqual(
    p.composition.map((c) => [c.key, c.n]),
    [
      ["pure_art", 2],
      ["single_full_capture", 2],
    ],
  );
  assert.equal(p.capturesPerImage.find((c) => c.key === "0")?.n, 2);
  assert.equal(
    p.orientation.capture.reduce((n, c) => n + c.n, 0),
    2,
    "gameplay captures only",
  );

  // Ours opening with the title screen form is compared as art, like theirs.
  const ours = [
    entry("Rogue Legend", 1, titleScreen("ROGUE LEGEND")),
    entry("Rogue Legend", 2, reading("img2", "gameplay", "BATTLE")),
  ];
  const vs = compareOurs(ours, p, 2);
  assert.doesNotMatch(JSON.stringify(vs), /our images are mostly "/);
});
