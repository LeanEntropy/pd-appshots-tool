import assert from "node:assert/strict";
import { test } from "node:test";
import { fitCore, slotCount } from "../src/core/fit.ts";

const lim = { cap: 100, target: 85, minCompetitors: 5, maxCompetitors: 8 };
const c = (appId: string, deckLength: number) => ({ appId, name: appId, deckLength });

test("our deck counts first, then whole competitor decks in order", () => {
  const r = fitCore(
    7,
    [c("a", 10), c("b", 13), c("c", 8), c("d", 8), c("e", 7), c("f", 9), c("g", 8)],
    lim,
  );
  assert.equal(r.ok, true);
  assert.equal(r.total, 7 + 10 + 13 + 8 + 8 + 7 + 9 + 8);
  assert.equal(r.selected.length, 7);
});

test("a deck that would cross the cap is skipped whole, never split, and the next is tried", () => {
  const r = fitCore(
    7,
    [c("a", 20), c("b", 20), c("c", 20), c("d", 20), c("big", 30), c("e", 10)],
    lim,
  );
  assert.deepEqual(
    r.selected.map((s) => s.appId),
    ["a", "b", "c", "d", "e"],
  );
  assert.equal(r.skipped[0]?.reason, "does-not-fit");
  assert.equal(r.total, 97);
  assert.ok(r.total <= lim.cap);
});

test("stops at the maximum number of competitor decks", () => {
  const many = Array.from({ length: 10 }, (_, i) => c(`x${i}`, 5));
  const r = fitCore(7, many, lim);
  assert.equal(r.selected.length, 8);
  assert.equal(r.skipped.filter((s) => s.reason === "max-reached").length, 2);
});

test("fewer than the recommended decks still runs, flagged as a small sample", () => {
  const r = fitCore(7, [c("a", 30), c("b", 30), c("c", 30), c("d", 30)], lim);
  assert.equal(r.ok, true);
  assert.equal(r.few, true);
  assert.equal(r.selected.length, 3);
  assert.match(r.message, /Only 3 competitors \(5 or more recommended\)/);
  const one = fitCore(7, [c("a", 8)], lim);
  assert.equal(one.ok, true);
  assert.match(one.message, /1 competitor deck plus ours/);
});

test("refuses only when no whole competitor deck fits", () => {
  const r = fitCore(7, [c("big", 99), c("gone", 0)], lim);
  assert.equal(r.ok, false);
  assert.match(r.message, /No whole competitor deck fits/);
  assert.equal(fitCore(7, [c("a", 5), c("b", 5), c("c", 5), c("d", 5), c("e", 5)], lim).few, false);
});

test("decks with no English listing are left out", () => {
  const r = fitCore(7, [c("gone", 0), c("a", 5)], lim);
  assert.equal(r.skipped[0]?.reason, "no-deck");
});

test("refuses when our own deck is above the cap", () => {
  assert.equal(fitCore(120, [], lim).ok, false);
});

test("slot count is the median deck length, capped at 8", () => {
  assert.equal(slotCount([7, 10, 13, 8, 8], 8), 8);
  assert.equal(slotCount([5, 6, 7], 8), 6);
  assert.equal(slotCount([5, 6, 7, 8], 8), 6);
  assert.equal(slotCount([0, 5, 7], 8), 6);
});
