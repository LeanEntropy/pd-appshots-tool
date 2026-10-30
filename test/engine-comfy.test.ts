import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveKeywords } from "../src/analysis/keywords.ts";
import type { Recommendations } from "../src/analysis/synthesis-schema.ts";
import { isFirm } from "../src/engine/directives.ts";
import { specGaps } from "../src/engine/spec.ts";
import { abDirectionProblems, claimProblems, skeletonProblems } from "../src/engine/validate.ts";
import { at, fixture, run } from "./helpers/engine-fixture.ts";

// Regression set, Comfy Mahjong Pilot (US): the user's corrections of 2026-10-30.
const f = fixture("comfy-us");
const e = run(f);

test("Comfy 1: image 1 copies the leaders' landscape promotional banner, marketing art", () => {
  const [c] = at(e, "COPY", 1);
  assert.ok(c && isFirm(c));
  assert.equal(c.spec?.kind, "promo_banner");
  assert.equal(c.spec?.canvas, "landscape");
  assert.equal(c.spec?.size, "1920x1080");
  assert.equal(c.spec?.source, "marketing_art");
  assert.deepEqual([c.evidence.n, c.evidence.M], [2, 2]);
  assert.deepEqual(c.evidence.games, ["Vita Mahjong", "Mahjong Blast"]);
  assert.deepEqual([c.evidence.leaders.n, c.evidence.leaders.of], [2, 2]);
  assert.equal(c.level, "directive");
  const slot = e.skeleton[0];
  assert.equal(slot?.action, "new marketing art");
  assert.equal(slot?.canvas, "landscape");
});

test("Comfy 2-3: the victory screen and the portrait title art are dropped, with full specs", () => {
  const [victory] = at(e, "DROP", 4);
  assert.ok(victory && isFirm(victory));
  assert.deepEqual([victory.evidence.n, victory.evidence.M], [0, 2]);
  assert.ok(victory.replacement, "a drop always names its replacement");
  assert.deepEqual(specGaps(victory.replacement), []);
  assert.equal(victory.replacement?.kind, "core_play");
  const [title] = at(e, "DROP", 1);
  assert.ok(title && isFirm(title));
  assert.deepEqual([title.evidence.n, title.evidence.M], [0, 2]);
  assert.equal(title.replacement?.kind, "promo_banner");
});

test("Comfy 4-6: the deck grows to 8, images 7 and 8 are landscape, the verdict is very different", () => {
  const [len] = at(e, "LENGTH");
  assert.ok(len && isFirm(len));
  assert.equal(e.skeleton.length, 8);
  for (const p of [7, 8]) {
    const [o] = at(e, "ORIENT", p);
    assert.equal(o?.spec?.canvas, "landscape", `image ${p}`);
    assert.deepEqual([o?.evidence.n, o?.evidence.M], [2, 2]);
    assert.equal(e.skeleton[p - 1]?.canvas, "landscape");
  }
  assert.equal(e.verdict.word, "very different");
});

test("Comfy 7: no KEEP on image 1 or 4; the mechanic-only line is a MESSAGE", () => {
  for (const p of [1, 4]) assert.equal(at(e, "KEEP", p).length, 0, `image ${p}`);
  assert.ok(e.skeleton[0]?.action !== "keep" && e.skeleton[3]?.action !== "keep");
  const [m] = at(e, "MESSAGE", 3);
  assert.match(m?.title ?? "", /MATCH & CLEAR/);
  // Every new or replaced slot carries a theme, and no two the same.
  const themes = e.skeleton.filter((s) => s.action !== "keep").map((s) => s.themes[0]);
  assert.ok(themes.every(Boolean));
  assert.equal(new Set(themes).size, themes.length);
});

test("Comfy 8: tag candidates counted once per game; category switch recommended (D4)", () => {
  const tags = e.meta?.appLevel.find((d) => d.field === "tags");
  assert.ok(tags?.candidate, "tags stay candidates until D9 is confirmed");
  for (const t of ["Mahjong solitaire", "Pair matching", "Offline"])
    assert.ok(tags.values.includes(t), t);
  assert.match(tags.text, /Mahjong solitaire \(4 of 4 games/);
  const cat = e.meta?.appLevel.find((d) => d.field === "category");
  assert.equal(cat?.level, "directive");
  assert.match(cat?.title ?? "", /from Puzzle to Board/);
  assert.match(cat?.text ?? "", /Record the date .* watch rank and installs/);
  const de = e.meta?.groups.find((g) => g.hl === "de");
  const deTags = de?.directives.find((d) => d.field === "tags");
  assert.ok(deTags?.values.includes("Paare zuordnen (Pair matching)"), deTags?.values.join(", "));
});

test("Comfy 9: tag names are never split into keywords (no 'hearted', no 'light')", () => {
  const vita = f.meta.text["com.vitastudio.mahjong|us|en"];
  assert.ok(vita);
  const keys = deriveKeywords(vita, "en").map((k) => k.key);
  assert.ok(!keys.includes("hearted") && !keys.includes("light"), keys.join(", "));
  const terms = e.meta?.groups.flatMap((g) => g.directives.flatMap((d) => d.values)) ?? [];
  assert.ok(!terms.includes("hearted") && !terms.includes("light"));
});

/** A recommendation that follows the skeleton exactly, as a base for the bad ones. */
function followed(): Recommendations {
  return {
    rationale: "Follows D1 (2 of 2 games, both leaders).",
    positions: e.skeleton.map((s) => ({
      position: s.position,
      screenType:
        s.kind === "promo_banner" || s.kind === "content_showcase" ? "feature_image" : "gameplay",
      subtype:
        s.kind === "promo_banner" || s.kind === "content_showcase" ? "feature_callout" : "board",
      source: s.action === "keep" ? `keep our current position ${s.from}` : "new capture",
      screenshot: {
        orientation: s.canvas as "portrait" | "landscape",
        whatToCapture: "x",
        action: "x",
        atmosphere: "x",
        mainColours: "x",
      },
      marketingLayer: {
        present: true,
        proportion: "full screenshot, small layer",
        backgroundMask: { shape: "band", colour: "green #0a5", location: "top" },
        texts: [],
        elements: [],
      },
      logo: { show: s.logo, why: "x" },
      why: "x",
    })),
  };
}

test("Comfy 10: an AI output that keeps the victory screen fails validation", () => {
  const ok = followed();
  assert.deepEqual(skeletonProblems(ok, e, "portrait"), []);
  const bad = followed();
  const p4 = bad.positions[3];
  assert.ok(p4);
  p4.source = "keep our current position 4";
  assert.ok(skeletonProblems(bad, e, "portrait").some((p) => /drop/.test(p)));
  const short = { ...followed(), positions: followed().positions.slice(0, 6) };
  assert.ok(skeletonProblems(short, e, "portrait").some((p) => /target deck has 8/.test(p)));
});

test("Comfy 11: '1 of 2 at image 6' for full-screen art fails the claim check", () => {
  const bad = ["Kept like the full-screen art at image 6 in 1 of 2 decks."];
  assert.equal(claimProblems(bad, e.claims).length, 1);
  assert.deepEqual(
    claimProblems(["Both leaders open on a banner at image 1: 2 of 2."], e.claims),
    [],
  );
});

test("Comfy 12: an A/B test that opens on a portrait gameplay image is rejected", () => {
  const slots = [
    { position: 1, fromOurPosition: 2, orientation: "portrait", changes: ["screen"] },
    { position: 2, fromOurPosition: 1, orientation: "portrait", changes: [] },
  ];
  assert.ok(abDirectionProblems(slots, e).some((p) => /landscape/.test(p)));
  const toward = [
    { position: 1, fromOurPosition: 1, orientation: "landscape", changes: ["screen"] },
  ];
  assert.deepEqual(abDirectionProblems(toward, e), []);
});
