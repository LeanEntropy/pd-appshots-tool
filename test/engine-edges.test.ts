import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeckEntry } from "../src/analysis/patterns.ts";
import { type Directive, isFirm } from "../src/engine/directives.ts";
import { runEngine } from "../src/engine/engine.ts";
import { leadersOf } from "../src/engine/leaders.ts";
import { chars, metaRules } from "../src/engine/rules-meta.ts";
import { resolveConflicts } from "../src/engine/skeleton.ts";
import { specGaps } from "../src/engine/spec.ts";
import { evidenceOf, strengthOf } from "../src/engine/strength.ts";
import { metaTextProblems } from "../src/engine/validate.ts";
import type { StoreOfficial } from "../src/play/store-text.ts";
import { at, fixture, input, run } from "./helpers/engine-fixture.ts";

// Synthetic edge cases (plan section 8, A-M), built from the Comfy fixture by editing its facts.
const f = fixture("comfy-us");
const vita = "com.vitastudio.mahjong";
const L = (ids: string[]) =>
  leadersOf(
    ids.map((appId, i) => ({ appId, name: appId, installs: i ? "10,000,000+" : "100,000,000+" })),
  );

test("A: one competitor (M = 1) gives 'consider' only", () => {
  const e = runEngine({
    ...input(f, false),
    theirs: f.competitors.filter((c) => c.appId === vita),
  });
  assert.ok(e.directives.every((d) => d.level !== "directive" && d.level !== "provisional"));
  assert.equal(at(e, "COPY", 1).length, 0, "a position reached by one game: no directive");
  assert.equal(at(e, "DROP", 4)[0]?.level, "consider");
});

test("B: unanimous non-leaders against a leader minority is a test, not a directive", () => {
  const all = ["a", "b", "c", "d"].map((appId) => ({ appId, name: appId }));
  const leaders = L(["d", "a", "b", "c"]); // d is the top game (100M), the others 10M
  const e = evidenceOf(all.slice(0, 3), all, leaders);
  assert.deepEqual([e.n, e.M, e.leaders.n, e.leaders.of], [3, 4, 0, 1]);
  assert.equal(strengthOf(e), "test");
});

test("C: no install data: leader weighting is off and the report says so", () => {
  const e = runEngine({ ...input(f, false), market: [] });
  assert.equal(e.leaders.on, false);
  assert.match(e.notes.join(" "), /leader weighting is off/);
  assert.equal(at(e, "COPY", 1)[0]?.level, "provisional", "2 of 2, not both leaders");
});

test("D: a tie at a position gives no directive there", () => {
  const six = { ...(f.ours[1] as DeckEntry), position: 6, imageId: "x6" };
  const e = runEngine({ ...input(f, false), ours: [...f.ours, six], ourDeckLength: 5 });
  assert.ok(!e.directives.some((d) => isFirm(d) && d.positions[0] === 6 && d.kind !== "MESSAGE"));
});

test("E: a position reached by 1 game gives no directive", () => {
  const theirs = f.competitors.filter((c) => !(c.appId !== vita && c.position >= 7));
  const e = runEngine({ ...input(f, false), theirs });
  assert.equal(at(e, "ORIENT", 7).length, 0);
});

test("F: two drops get unique, position-compatible replacements", () => {
  const e = run(f, false);
  const [d1, d4] = [at(e, "DROP", 1)[0], at(e, "DROP", 4)[0]];
  assert.equal(d1?.replacement?.kind, "promo_banner");
  assert.equal(d4?.replacement?.kind, "core_play", "an opener never goes to image 4");
  assert.notEqual(d1?.replacement, d4?.replacement);
});

test("G: a unique non-gameplay screen is never KEEP (no protected screens)", () => {
  const menu = structuredClone(f.ours[1] as DeckEntry);
  menu.final.screenshot.screenType = "metagame";
  menu.final.screenshot.subtype = "gear";
  menu.final.screenshot.captures = menu.final.screenshot.captures.map((c) => ({
    ...c,
    screenType: "metagame",
    subtype: "gear",
  }));
  const ours = [f.ours[0], menu, f.ours[2], f.ours[3]] as DeckEntry[];
  const e = runEngine({ ...input(f, false), ours });
  assert.equal(at(e, "KEEP", 2).length, 0);
  assert.ok(at(e, "DROP", 2)[0] && isFirm(at(e, "DROP", 2)[0] as Directive));
});

test("H: old analyses without the new fields: optional fields 'not measured', specs still valid", () => {
  const e = run(f, false);
  const spec = at(e, "COPY", 1)[0]?.spec;
  assert.ok(spec);
  assert.equal(spec.fields.find((x) => x.label === "Board density")?.from, "not measured");
  assert.deepEqual(specGaps(spec), []);
});

test("I: a REORDER into a slot a higher-ranked COPY sets is overruled by rank", () => {
  const ev = evidenceOf([], [], L([]));
  const d = (
    id: string,
    kind: Directive["kind"],
    positions: number[],
    rank: number,
  ): Directive => ({
    id,
    kind,
    level: "directive",
    positions,
    strength: "unanimous",
    evidence: ev,
    title: id,
    text: id,
    rank,
    notes: [],
  });
  const ds = [d("D1", "COPY", [1], 3), d("D2", "REORDER", [5, 1], 2)];
  resolveConflicts(ds);
  assert.equal(ds[1]?.level, "test");
  assert.match(ds[1]?.notes[0] ?? "", /overruled by D1/);
});

const official = (title: string, tags: string[], genre = "GAME_BOARD"): StoreOfficial => ({
  title,
  shortDescription: "Relaxing tiles.",
  description: "A calm game.",
  recentChanges: null,
  genre: { id: genre, name: genre === "GAME_BOARD" ? "Board" : "Puzzle" },
  chips: [{ id: genre, name: "x" }, ...tags.map((name) => ({ id: null, name }))],
  contentRating: null,
});

function meta(ourTags: string[], markets: { gl: string; hl: string; label: string }[]) {
  const games = ["a", "b", "c", "d"].map((appId) => ({ appId, name: appId }));
  const text = (appId: string) =>
    appId === "ours"
      ? official("Ours", ourTags, "GAME_PUZZLE")
      : official(appId, ["Offline", "Single player", "Pair matching"]);
  return metaRules({
    markets,
    ours: { appId: "ours", name: "Ours" },
    competitors: games,
    text,
    leaders: L(["a", "b", "c", "d"]),
  });
}

test("J: our 5 tag slots are full: the weakest tags are replaced first", () => {
  const m = meta(
    ["Offline", "Fantasy", "Zombie", "Monster", "Retro"],
    [{ gl: "us", hl: "en", label: "US" }],
  );
  const tags = m.appLevel.find((d) => d.field === "tags");
  assert.match(tags?.text ?? "", /slots are full: replace Fantasy \(0 of 4\), Zombie \(0 of 4\)/);
});

test("K: the same tags in many countries count once per game", () => {
  const markets = ["us", "gb", "au", "ca"].map((gl) => ({ gl, hl: "en", label: gl }));
  const tags = meta([], markets).appLevel.find((d) => d.field === "tags");
  assert.match(tags?.text ?? "", /Offline \(4 of 4 games/);
});

test("L: lengths are counted in characters (graphemes), with emoji and spam checks", () => {
  assert.equal(chars("麻雀ソリティア：大きな牌"), 12);
  assert.equal(chars("👨‍👩‍👧 Mahjong"), 9);
  assert.equal(metaTextProblems("title", "麻雀".repeat(16)).length, 1);
  assert.ok(metaTextProblems("short", "Best mahjong game 🀄").length >= 2);
  assert.deepEqual(
    metaTextProblems("short", "Relaxing mahjong solitaire: big tiles, no timers, offline."),
    [],
  );
});

test("M: when the AI fails, the code's directives and skeleton still stand", () => {
  const e = run(f, false);
  assert.ok(e.directives.some(isFirm));
  assert.equal(e.skeleton.length, 8);
  assert.ok(e.skeleton.every((s) => s.kindLabel && s.canvas && s.source));
});
