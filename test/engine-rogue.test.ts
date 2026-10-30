import assert from "node:assert/strict";
import { test } from "node:test";
import { plainLabel } from "../src/analysis/labels.ts";
import { positionVerdict } from "../src/analysis/ours-vs-position.ts";
import { findPatterns } from "../src/analysis/patterns.ts";
import { isFirm } from "../src/engine/directives.ts";
import { kindOf } from "../src/engine/kinds.ts";
import { at, fixture, run } from "./helpers/engine-fixture.ts";

// Regression set, Rogue Legend Full check (US): the user's corrections (plan section 8, 13-18).
const f = fixture("rogue-us");
const e = run(f);
const entry = (game: string, p: number) => {
  const x = f.competitors.find((c) => c.name === game && c.position === p);
  assert.ok(x, `${game} #${p}`);
  return x;
};

test("Rogue 13 and 17: Sword x Staff #1 is a banner; landscape gameplay is not; art is one kind", () => {
  assert.equal(kindOf(entry("Sword x Staff", 1)).kind, "promo_banner");
  assert.equal(kindOf(entry("Legend of Mushroom", 3)).kind, "core_play");
  // Title art and feature art stay one category (and one kind).
  assert.equal(kindOf(entry("Archero 2", 1)).kind, "title_art");
  assert.equal(kindOf(entry("Archero 2", 6)).kind, "title_art");
});

test("Rogue 14: our image 2 is not 'following' at 2 of 8 (the 25% rule is gone)", () => {
  const p = findPatterns(f.competitors, f.decks);
  const ours = f.ours.find((o) => o.position === 2);
  assert.ok(ours);
  assert.notEqual(positionVerdict(ours, p, plainLabel).verdict, "following");
});

test("Rogue 15: the dice board is never dropped: it is our gameplay screenshot, needs review", () => {
  assert.equal(at(e, "DROP", 4).length, 0);
  const [r] = at(e, "REVIEW", 4);
  assert.equal(r?.level, "review");
  assert.match(r?.text ?? "", /gameplay screenshot/);
  assert.match(r?.text ?? "", /follows the leaders on position, orientation, headline/);
  assert.doesNotMatch(r?.text ?? "", /core loop|core mechanic/i);
  assert.equal(e.skeleton[3]?.action, "keep");
});

test("Rogue 16: image 2 menus is test strength once leaders are weighted", () => {
  assert.ok(e.leaders.ids.has("com.dxx.firenow"), "Survivor.io leads");
  const [c] = at(e, "COPY", 2);
  assert.ok(c);
  assert.equal(c.level, "test");
  assert.ok(!e.directives.some((d) => isFirm(d) && d.positions[0] === 2));
});

test("Rogue 18: a screen a deck shows twice is counted once", () => {
  const keys = f.competitors.map((c) => `${c.appId}#${c.position}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const d of f.decks)
    assert.ok(f.competitors.filter((c) => c.appId === d.appId).length <= d.deckLength, d.name);
});

test("Rogue: on par, no firm screenshot directive; anything only we show is never a plain keep", () => {
  assert.equal(e.verdict.word, "on par");
  const unique = e.directives.filter((d) => d.level === "review");
  assert.ok(unique.length >= 1);
  for (const r of unique) assert.equal(at(e, "KEEP", r.positions[0]).length, 0);
});
