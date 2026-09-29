import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { measureLayout } from "../src/layout/measure/index.ts";
import type { Layout } from "../src/layout/schema.ts";
import { wireframeSvg } from "../src/layout/wireframe-render.ts";
import { wireframe } from "../src/layout/wireframe-svg.ts";

const W = 540;
const H = 960;

/** A grey screen, a level panel (x 10-50%, y 20-40%) and a purple band whose top edge runs
 * from 80% at the left border to 75% at the right border (rising to the right, about -5.1 deg). */
function picture(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#556070"/>
    <rect x="${0.1 * W}" y="${0.2 * H}" width="${0.4 * W}" height="${0.2 * H}" fill="#d8d8d8"/>
    <polygon points="0,${0.8 * H} ${W},${0.75 * H} ${W},${H} 0,${H}" fill="#7a2fb5"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const el = { textEn: null, note: "", text: null, textRef: null, covers: [] as string[] };

function layout(): Layout {
  return {
    inGame: [
      {
        ...el,
        id: "S1",
        role: "main-scene",
        box: { x: 5, y: 5, w: 90, h: 90 },
        tiltDeg: 0,
        z: 0,
        capture: 0,
        textRef: null,
      },
      {
        ...el,
        id: "S2",
        role: "panel",
        box: { x: 12, y: 18, w: 36, h: 23.5 },
        tiltDeg: 0,
        z: 1,
        capture: 0,
        textRef: null,
      },
    ],
    marketing: [
      {
        ...el,
        id: "M1",
        role: "frame",
        box: { x: 0, y: 0, w: 100, h: 100 },
        tiltDeg: 0,
        z: 0,
        capture: null,
      },
      // The model's band: 2 points too low and 2 degrees too flat.
      {
        ...el,
        id: "M2",
        role: "band",
        box: { x: 0, y: 79.5, w: 100, h: 25 },
        tiltDeg: -3,
        z: 1,
        capture: null,
      },
    ],
    composition: {
      focal: { x: 50, y: 85, id: "M2" },
      readingOrder: ["M2"],
      overlaySharePercent: 30,
      focus: { kind: "battle", words: "" },
      marketingCovers: "",
      focusMatch: { verdict: "match", reason: "" },
      reinforcement: "",
      summary: "s",
    },
  };
}

test("band edges and tilt are measured from the pixels, seeded by the model's box", async () => {
  const m = await measureLayout(await picture(), layout(), { imageId: "x", layoutKey: "k" });
  const band = m.elements.find((e) => e.id === "M2");
  assert.ok(band?.top, "the top edge passed the quality rule");
  assert.ok(Math.abs(band.top.left - 80) <= 0.5, `left ${band.top.left}`);
  assert.ok(Math.abs(band.top.right - 75) <= 0.5, `right ${band.top.right}`);
  const truth = (Math.atan((-0.05 * H) / W) * 180) / Math.PI;
  assert.ok(Math.abs((band.tiltDeg ?? 0) - truth) <= 0.5, `tilt ${band.tiltDeg}`);
  assert.equal(band.bottom, null, "an edge on the image border is not measured");
  assert.equal(band.colour, "#7a2fb5");
});

test("level rectangles snap to strong edges; a frame counts only outside the capture", async () => {
  const m = await measureLayout(await picture(), layout(), { imageId: "x", layoutKey: "k" });
  const panel = m.elements.find((e) => e.id === "S2");
  assert.ok(panel?.box);
  assert.ok(
    Math.abs(panel.box.x - 10) <= 0.5 && Math.abs(panel.box.y - 20) <= 0.5,
    JSON.stringify(panel.box),
  );
  assert.ok(
    Math.abs(panel.box.x + panel.box.w - 50) <= 0.5 &&
      Math.abs(panel.box.y + panel.box.h - 40) <= 0.5,
  );
  // Frame ring (100% minus the 90% x 90% capture) plus the band's lower part: an upper bound.
  assert.ok(m.coverageUpTo > 19 && m.coverageUpTo < 40, `coverage ${m.coverageUpTo}`);
});

test("a plain image gives no measured band: the model's values stay (estimated)", async () => {
  const flat = await sharp({ create: { width: W, height: H, channels: 3, background: "#808080" } })
    .png()
    .toBuffer();
  const m = await measureLayout(flat, layout(), { imageId: "x", layoutKey: "k" });
  assert.equal(m.elements.find((e) => e.id === "M2")?.box, null);
  assert.equal(m.elements.find((e) => e.id === "S2")?.box, null);
});

test("the wireframe is drawn by code: two panels, measured band a polygon, unmeasured dashed", async () => {
  const flat = await sharp({ create: { width: W, height: H, channels: 3, background: "#808080" } })
    .png()
    .toBuffer();
  const m = await measureLayout(flat, layout(), { imageId: "x", layoutKey: "k" });
  const svg = wireframeSvg(layout(), { width: W, height: H }, m);
  assert.match(svg, /^<svg[^>]+viewBox="0 0 476 /);
  assert.match(svg, />Screenshot layer</);
  assert.match(svg, />Marketing layer</);
  assert.match(svg, /rotate\(-3 115 /);
  assert.match(svg, /Band \(tilted 3°\) \(tilt estimated\)/);
  assert.match(svg, /stroke-dasharray/);
  assert.match(svg, />Panel</);
  assert.ok(!/\b[SM]\d\b/.test(svg), "no internal codes");
  // Measured on the real picture: the band is the slanted polygon from the measured top edge.
  const real = await measureLayout(await picture(), layout(), { imageId: "x", layoutKey: "k" });
  const band = wireframe(layout(), { width: W, height: H }, real).panels[1]?.shapes.find(
    (s) => s.pts.length,
  );
  assert.ok(band, "measured band drawn as a polygon");
  assert.equal(band.dashed, false);
  const [, yl = 0, , yr = 0] = band.pts;
  assert.ok(yl > yr, `rises to the right: ${yl} > ${yr}`);
});
