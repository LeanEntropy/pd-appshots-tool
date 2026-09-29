import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImageAnalysis } from "../src/analysis/schema.ts";
import { focusView } from "../src/layout/focus.ts";
import type { Layout } from "../src/layout/schema.ts";
import { wireframe } from "../src/layout/wireframe-svg.ts";

test("an old or broken saved element without a box is drawn empty, never crashes", () => {
  const broken = {
    inGame: [{ id: "S1", role: "hud" }],
    marketing: [{ id: "M1", role: "band", covers: "S1" }],
    composition: {},
  } as unknown as Layout;
  const wf = wireframe(broken, { width: 9, height: 16 });
  assert.equal(wf.panels[0]?.shapes[0]?.w, 0);
  assert.match(wf.panels[0]?.summary ?? "", /^HUD /);
  assert.equal(focusView(broken, null).covers, "Hides no screen region the layout names.");
});

const el = {
  textEn: null,
  note: "",
  text: null,
  textRef: null,
  covers: [] as string[],
  z: 0,
  tiltDeg: 0,
};
const box = { x: 0, y: 0, w: 100, h: 50 };

const older = {
  inGame: [
    { ...el, id: "S1", role: "main-scene", box, capture: 0 },
    { ...el, id: "S2", role: "panel", box, capture: 0, note: "gear grid" },
    { ...el, id: "S3", role: "game-text", box, capture: 0 },
  ],
  marketing: [{ ...el, id: "M1", role: "band", box, capture: null, covers: ["S2"] }],
  composition: {
    focal: { x: 1, y: 1, id: "M1" },
    readingOrder: [],
    overlaySharePercent: 20,
    summary: "",
  },
} as unknown as Layout;

const final = {
  screenshot: { screenType: "metagame", subtype: "gear" },
  marketingLayer: { texts: [{ role: "headline", text: "Battle!" }] },
} as unknown as ImageAnalysis;

test("an older saved layout: focus from the screen type, covers worked out from its ids", () => {
  const f = focusView(older, final);
  assert.match(f.focus, /^Screen type metagame \/ gear \(from the analysis/);
  assert.equal(f.covers, "Hides part of: panel (gear grid). Leaves visible: main scene.");
  assert.equal(f.verdict, "");
  assert.equal(
    f.match,
    "Not judged for this saved layout. Headline “Battle!” on a metagame / gear screen.",
  );
});

test("a layout.v3 answer says focus, covers and the focus match itself", () => {
  const v3 = {
    ...older,
    composition: {
      ...older.composition,
      focus: { kind: "gear / upgrade", words: "the gear grid" },
      marketingCovers: "covers the grid's right column, keeps the roster visible",
      focusMatch: { verdict: "mismatch", reason: "says Battle! on a gear screen" },
      reinforcement: "the cut-out points away from the grid",
    },
  } as Layout;
  const f = focusView(v3, final);
  assert.equal(f.focus, "gear / upgrade: the gear grid");
  assert.equal(f.covers, "covers the grid's right column, keeps the roster visible");
  assert.equal(f.verdict, "mismatch");
  assert.equal(f.match, "mismatch: says Battle! on a gear screen");
  assert.equal(f.reinforcement, "the cut-out points away from the grid");
  assert.equal(focusView({ ...older, marketing: [] }, final).match, "No marketing layer.");
});
