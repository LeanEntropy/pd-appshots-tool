import assert from "node:assert/strict";
import { test } from "node:test";
import { PROMO_BANNER } from "../src/analysis/categories.ts";
import { directiveFacts } from "../src/analysis/directive-facts.ts";
import { directivesOf } from "../src/analysis/directives.ts";
import { labeler } from "../src/analysis/labels.ts";
import { compareOurs } from "../src/analysis/ours-vs.ts";
import { patternFit } from "../src/analysis/pattern-fit.ts";
import { type DeckEntry, findPatterns } from "../src/analysis/patterns.ts";
import type { ImageAnalysis } from "../src/analysis/schema.ts";
import { bottomPoints, plain } from "../src/reports/bottom-points.ts";
import { imagePrompt } from "../src/reports/image-prompt.ts";
import { storeRules } from "../src/reports/image-prompt-rules.ts";
import { reading } from "./helpers/fake-provider.ts";

const L = labeler();

/** A landscape promotional banner: logo, slogan and tile art drawn together, no band. */
function banner(headline: string): ImageAnalysis {
  const r = reading("i", PROMO_BANNER, headline);
  r.screenshot.composition = "pure_art";
  r.screenshot.captures = [];
  r.screenshot.captureAreaPercent = 0;
  r.screenshot.atmosphere = "calm, relaxing";
  r.marketingLayer.backgroundMasks = [];
  r.marketingLayer.elements = [
    {
      kind: "item",
      what: "stack of mahjong tiles",
      position: "right",
      pose: "n/a",
      colours: "white, green",
      scale: "large",
      region: { x: 50, y: 10, w: 45, h: 80 },
    },
  ];
  return r;
}

/** A portrait title art with a band (our Comfy Mahjong image 1). */
function titleArt(): ImageAnalysis {
  const r = reading("i", "title_image", "RELAXING");
  r.screenshot.composition = "pure_art";
  r.screenshot.subtype = "logo_with_art";
  r.screenshot.captures = [];
  r.screenshot.captureAreaPercent = 0;
  return r;
}

function game(subtype: string, headline: string): ImageAnalysis {
  const r = reading("i", "gameplay", headline);
  r.screenshot.subtype = subtype;
  for (const c of r.screenshot.captures) c.subtype = subtype;
  return r;
}

const entry = (
  name: string,
  position: number,
  final: ImageAnalysis,
  canvas: "portrait" | "landscape" = "portrait",
): DeckEntry => ({
  appId: name,
  name,
  position,
  imageId: `${name}-${position}`,
  canvas,
  ratio: canvas === "landscape" ? "16:9" : "9:16",
  size: canvas === "landscape" ? "1920x1080" : "1080x1920",
  final,
});

const theirDeck = (name: string, head: string) => [
  entry(name, 1, banner(head), "landscape"),
  ...[2, 3, 4].map((p) => entry(name, p, game("board", `Line ${p}`))),
];
const theirs = [
  ...theirDeck("Vita Mahjong", "Train Your Brain"),
  ...theirDeck("Mahjong Blast", "MAHJONG Match 3D"),
];
const decks = [
  { appId: "Vita Mahjong", name: "Vita Mahjong", deckLength: 4 },
  { appId: "Mahjong Blast", name: "Mahjong Blast", deckLength: 4 },
];
// Comfy Mahjong: portrait title art at 1, board at 2 and 3, a victory screen ("NO TIMERS") at 4.
const ours = [
  entry("Comfy", 1, titleArt()),
  entry("Comfy", 2, game("board", "PLAY OFFLINE")),
  entry("Comfy", 3, game("board", "MATCH & CLEAR")),
  entry("Comfy", 4, game("victory", "NO TIMERS")),
];
const p = findPatterns(theirs, decks);

test("copy: 2 of 2 competitors with a landscape banner at image 1 gives a firm directive with the full spec", () => {
  const ds = directivesOf(theirs, ours, p, L);
  const one = ds.find((d) => d.position === 1);
  assert.ok(one);
  assert.equal(one.kind, "copy");
  assert.deepEqual(one.differs, ["category", "orientation", "layer structure"]);
  assert.match(
    one.text,
    /^Copy the pattern: both competitors \(Vita Mahjong and Mahjong Blast\) use a landscape promotional banner \(all marketing art, no separate layer\) at image 1; ours is a portrait title screen/,
  );
  assert.match(one.text, /Create a similar landscape promotional banner here/);
  assert.match(one.text, /screenshot layer: none/);
  assert.match(one.text, /Do not rebuild our title screen/);
  assert.match(one.text, /Deviate only for a stated reason .* A\/B test/);
  assert.equal(one.spec.screenshotLayer, false);
  const details = one.spec.details.join("\n");
  for (const want of [
    /Category: Promotional banner/,
    /Orientation and size: landscape, 1920x1080 \(16:9\)/,
    /Layer structure: all marketing art, no separate layer; screenshot layer: none/,
    /Layout: full-screen art/,
    /theirs: "Train Your Brain", "MAHJONG Match 3D"/,
    /Game logo: /,
    /Characters or product art: stack of mahjong tiles/,
    /Colours: mostly /,
    /Mood: calm, relaxing/,
  ])
    assert.match(details, want);
});

test("drop: a victory screen no competitor uses names a full replacement and keeps its line", () => {
  const ds = directivesOf(theirs, ours, p, L);
  const four = ds.find((d) => d.position === 4);
  assert.ok(four);
  assert.equal(four.kind, "drop");
  assert.deepEqual(four.dropped, { screen: "Gameplay / Victory", headline: "NO TIMERS" });
  assert.match(
    four.text,
    /^Drop image 4: none of the 2 competitors uses gameplay \/ victory anywhere in their decks\. Put a portrait gameplay \/ board \(screenshot \+ marketing layer\) there instead, as both competitors \(Vita Mahjong and Mahjong Blast\) show at image 4\. Capture it from our own game\./,
  );
  assert.match(
    four.text,
    /Move its useful line "NO TIMERS" to another image or to the store description/,
  );
  assert.match(four.text, /A\/B test/);
  assert.equal(four.spec.screenshotLayer, true);
  assert.match(four.spec.details.join("\n"), /Category: Gameplay \/ Board/);
  // Positions 2 and 3 already follow: no directive.
  assert.deepEqual(
    ds.map((d) => d.position),
    [1, 4],
  );
});

test("how ours compares, key points and the bottom line lead with the directives", () => {
  const vs = compareOurs(ours, p, 4, L, theirs);
  const [one, two, , four] = vs.positions;
  assert.equal(one?.directive?.kind, "copy");
  assert.match(one?.reasons[0] ?? "", /^Copy the pattern/);
  assert.match(one?.reasons[1] ?? "", /^What should be there: Category: Promotional banner/);
  assert.equal(two?.directive, undefined);
  assert.equal(two?.verdict, "following");
  assert.equal(four?.directive?.kind, "drop");
  assert.equal(four?.verdict, "very different");
  assert.match(four?.reasons[0] ?? "", /^Drop image 4/);
  // Saved reports without competitors keep their old shape.
  assert.equal(compareOurs(ours, p, 4, L).directives, undefined);
  const fit = patternFit(theirs, ours, p, 4, L);
  assert.match(fit.keyPoints[0] ?? "", /^Copy the pattern/);
  assert.match(fit.keyPoints[1] ?? "", /^Drop image 4/);
  assert.ok(!fit.keyPoints.some((k) => k.startsWith("Opens with")), "no repeat of position 1");
  const firm = (vs.directives ?? []).map((d) => d.text);
  const b = bottomPoints({
    shortAnswer: "Our store page is very different. Rebuild our title art with the logo.",
    verdict: null,
    verdictWords: ["very different"],
    findings: [],
    structured: { verdict: "", differences: [], actions: ["Rebuild our title art with the logo."] },
    shownBelow: fit.keyPoints,
    multi: false,
    firm,
  });
  assert.match(plain(b.actions[0] as never), /^Copy the pattern/);
  assert.match(plain(b.actions[1] as never), /^Drop image 4/);
  const facts = directiveFacts(vs.directives);
  assert.match(facts, /HARD INPUT/);
  assert.match(facts, /"screenshotLayer":"none"/);
  assert.equal(directiveFacts([]), "");
});

test("the image prompt carries the directive: screenshot layer none, landscape size", () => {
  const vs = compareOurs(ours, p, 4, L, theirs);
  const d = vs.positions[0]?.directive;
  assert.ok(d);
  const text = imagePrompt(
    {
      game: "Comfy Mahjong",
      storeName: "Google Play",
      country: "United States (English)",
      language: "English",
      english: true,
      deckLength: 4,
    },
    { position: 1, competitors: [], ours: null, spec: null, directive: d },
    storeRules("play"),
  );
  assert.match(text, /## TOP PRIORITY: copy the competitors' pattern/);
  assert.match(text, /Screenshot layer: none/);
  assert.match(text, /Category: Promotional banner/);
  assert.match(text, /Exact size: [^\n]*landscape|Exact size: [^\n]*1920/i);
});

test("our core loop is never dropped, and a deck that follows gets no directive", () => {
  // Rogue Legend-like: our dice board is our core mechanic; no competitor shows a dice board.
  const rpg = (name: string) => [1, 2, 3].map((x) => entry(name, x, game("battle", `Fight ${x}`)));
  const them = [...rpg("A"), ...rpg("B")];
  const pp = findPatterns(them, [
    { appId: "A", name: "A", deckLength: 3 },
    { appId: "B", name: "B", deckLength: 3 },
  ]);
  const mine = [
    entry("RL", 1, game("board_dice", "ROLL")),
    entry("RL", 2, game("board_dice", "MERGE")),
    entry("RL", 3, game("battle", "FIGHT")),
  ];
  assert.deepEqual(directivesOf(them, mine, pp, L), []);
  // One dice board image alone (Rogue Legend image 4) is kept too, and says so.
  const one = [entry("RL", 1, game("battle", "GO")), entry("RL", 2, game("board_dice", "ROLL"))];
  assert.deepEqual(directivesOf(them, one, pp, L), []);
  const kept = compareOurs(one, pp, 2, L, them).positions[1]?.reasons.join("; ") ?? "";
  assert.match(kept, /no competitor shows it, but it is our own play \(core loop\), so it is kept/);
  // Our deck already follows every position: nothing changes.
  const same = [1, 2, 3].map((x) => entry("RL", x, game("battle", `Go ${x}`)));
  assert.deepEqual(directivesOf(them, same, pp, L), []);
  assert.ok(compareOurs(same, pp, 3, L, them).positions.every((v) => v.verdict === "following"));
});

test("a minority type is not following when a clear majority differs", () => {
  const them = [
    entry("A", 1, game("battle", "x")),
    entry("B", 1, game("battle", "y")),
    entry("C", 1, reading("i", "metagame", "z")),
  ];
  const pp = findPatterns(them, [
    { appId: "A", name: "A", deckLength: 1 },
    { appId: "B", name: "B", deckLength: 1 },
    { appId: "C", name: "C", deckLength: 1 },
  ]);
  const v = compareOurs([entry("O", 1, reading("i", "metagame", "w"))], pp, 1, L, them);
  assert.notEqual(v.positions[0]?.verdict, "following");
  assert.equal(v.positions[0]?.directive?.kind, "copy");
  assert.match(v.positions[0]?.directive?.text ?? "", /2 of 3 competitors \(A and B\)/);
});
