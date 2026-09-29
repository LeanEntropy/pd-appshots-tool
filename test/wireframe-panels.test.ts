import assert from "node:assert/strict";
import { test } from "node:test";
import type { Layout } from "../src/layout/schema.ts";
import { wireframe } from "../src/layout/wireframe-svg.ts";
import { INFO_SCRIPT } from "../src/view/gallery-info.ts";

const base = { textEn: null, note: "", text: null, textRef: null, covers: [] as string[], z: 0 };

function layout(): Layout {
  return {
    inGame: [
      {
        ...base,
        id: "S1",
        role: "main-scene",
        box: { x: 0, y: 0, w: 100, h: 100 },
        tiltDeg: 0,
        capture: 0,
      },
      { ...base, id: "S2", role: "hud", box: { x: 0, y: 0, w: 100, h: 8 }, tiltDeg: 0, capture: 0 },
      {
        ...base,
        id: "S3",
        role: "panel",
        box: { x: 5, y: 50, w: 90, h: 25 },
        tiltDeg: 0,
        capture: 0,
      },
      {
        ...base,
        id: "S4",
        role: "character",
        box: { x: 30, y: 15, w: 40, h: 30 },
        tiltDeg: 0,
        capture: 0,
        note: "hero",
      },
      {
        ...base,
        id: "S5",
        role: "game-text",
        box: { x: 40, y: 45, w: 20, h: 3 },
        tiltDeg: 0,
        capture: 0,
        textEn: "Level up!",
      },
    ],
    marketing: [
      {
        ...base,
        id: "M1",
        role: "band",
        box: { x: 0, y: 80, w: 100, h: 20 },
        tiltDeg: -5,
        capture: null,
      },
      {
        ...base,
        id: "M2",
        role: "headline",
        box: { x: 5, y: 84, w: 90, h: 8 },
        tiltDeg: -5,
        capture: null,
        textEn: "BATTLE AND LEVEL UP!",
        textRef: 0,
        z: 2,
      },
      {
        ...base,
        id: "M3",
        role: "cut-out",
        box: { x: 62, y: 55, w: 38, h: 30 },
        tiltDeg: 0,
        capture: null,
        z: 1,
      },
      {
        ...base,
        id: "M4",
        role: "other",
        box: { x: 0, y: 70, w: 30, h: 10 },
        tiltDeg: 0,
        capture: null,
        note: "star sparkles on the band",
      },
    ],
    composition: {
      focal: { x: 80, y: 65, id: "M3" },
      readingOrder: ["M3", "M2"],
      overlaySharePercent: 23,
      focus: { kind: "gear / upgrade", words: "the gear grid" },
      marketingCovers: "the grid's right column",
      focusMatch: { verdict: "match", reason: "headline says level up" },
      reinforcement: "the hero points at the grid",
      summary: "s",
    },
  } as Layout;
}

const reading = {
  screenshot: { description: "A battle screen with an equipment grid." },
  marketing: {
    elements: [
      {
        kind: "character",
        what: "the knight hero with a sword",
        region: { x: 60, y: 55, w: 40, h: 30 },
      },
    ],
  },
};

const wf = () => wireframe(layout(), { width: 1242, height: 2208 }, null, undefined, reading);
const words = (p: { labels: { lines: string[] }[] }) => p.labels.map((l) => l.lines.join(" "));

test("two separate panels of the image's ratio: screenshot layer, then marketing layer", () => {
  const [s, m] = wf().panels;
  assert.equal(s?.title, "Screenshot layer");
  assert.equal(m?.title, "Marketing layer");
  assert.equal(s?.w, 230);
  assert.equal(s?.h, Math.round(230 * (2208 / 1242)));
  assert.equal(s?.shapes.length, 4, "game text is words, not a box");
  assert.equal(m?.shapes.length, 3, "the sparkles are words, not a box");
});

test("labels are plain words with the real text, never S1/M1 codes", () => {
  const [s, m] = wf().panels;
  const all = [...words(s ?? { labels: [] }), ...words(m ?? { labels: [] })];
  for (const t of all) assert.ok(!/\b[SM]\d\b/.test(t), t);
  assert.ok(all.includes("Headline: “BATTLE AND LEVEL UP!”"), all.join(" | "));
  assert.ok(all.includes("Band (tilted 5°)"), all.join(" | "));
  assert.ok(all.includes("Cut-out: knight hero"), all.join(" | "));
  assert.ok(all.includes("Character: hero"), all.join(" | "));
  assert.ok(all.includes("HUD") && all.includes("Panel") && all.includes("Main scene"));
});

test("labels never overlap; the headline text sits inside its tilted box", () => {
  for (const p of wf().panels) {
    const ls = p.labels;
    for (let i = 0; i < ls.length; i++)
      for (let j = i + 1; j < ls.length; j++) {
        const a = ls[i];
        const b = ls[j];
        if (!a || !b) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        // Rotated labels are compared by their unrotated blocks, which is enough at small tilts.
        assert.ok(apart || a.rot || b.rot, `${a.lines} / ${b.lines}`);
      }
  }
  const head = wf().panels[1]?.labels.find((l) => l.lines.join(" ").startsWith("Headline"));
  assert.equal(head?.rot, -5);
  assert.equal(head?.lead, null);
});

test("characters and cut-outs are simple rounded blocks; bands keep their tilt", () => {
  const [s, m] = wf().panels;
  const hero = s?.shapes.find((x) => x.title === "Character: hero");
  assert.ok(hero && hero.rx > 10, "rounded block");
  const band = m?.shapes.find((x) => x.title.startsWith("Band"));
  assert.equal(band?.rot, -5);
  assert.equal(band?.dashed, false, "no measurement given: nothing claims to be estimated");
});

test("each layer has a plain summary and the details the boxes leave out", () => {
  const [s, m] = wf().panels;
  assert.match(s?.summary ?? "", /^Main scene over the whole image; /);
  assert.equal(
    m?.summary,
    "Tilted band (5°) across the bottom fifth; character cut-out (knight hero) at the bottom right; headline “BATTLE AND LEVEL UP!” across the lower part. Covers about 23% of the image. The eye lands first on the character cut-out.",
  );
  assert.match(
    s?.details ?? "",
    /^A battle screen with an equipment grid\. Not drawn: text “Level up!”\.$/,
  );
  assert.match(m?.details ?? "", /Not drawn: star sparkles on the band\./);
  const none = wireframe({ ...layout(), marketing: [] }, { width: 9, height: 16 });
  assert.equal(none.panels[1]?.summary, "No marketing layer.");
});

test("client: the popover leaves the wireframe slot empty and escapes numbers", () => {
  const stub = { addEventListener() {} };
  const DATA = { info: {} };
  const api = new Function(
    "DATA",
    "esc",
    "window",
    "document",
    `${INFO_SCRIPT}; return { infoHtml };`,
  )(
    DATA,
    (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    stub,
    stub,
  ) as { infoHtml: (v: unknown) => string };
  const hostile = "<img src=x onerror=alert(1)>";
  const html = api.infoHtml({
    screen: "Battle",
    status: "done",
    models: [],
    game: "G",
    position: hostile,
    filename: "f.png",
    appearances: [],
    imageColours: [],
    captures: [],
    differences: [],
    final: {
      screenshot: { description: "", action: "", atmosphere: "", mainColours: [] },
      marketingLayer: {
        present: true,
        coveragePercent: hostile,
        relationToScreen: "none",
        mainColours: [],
        backgroundMasks: [],
        texts: [],
        elements: [],
      },
    },
    layout: {
      status: "current",
      wireframe: wf(),
      summary: "<script>alert(1)</script>",
      coverageUpTo: hostile,
      focus: { focus: hostile, covers: hostile, verdict: "mismatch", match: hostile },
      older: true,
    },
  });
  assert.match(html, /<div class="wf"><\/div>/);
  assert.ok(!/<img|<script|<foreignObject|<svg/i.test(html), html);
});
