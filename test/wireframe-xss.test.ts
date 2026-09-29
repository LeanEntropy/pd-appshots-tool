import assert from "node:assert/strict";
import { test } from "node:test";
import type { Layout } from "../src/layout/schema.ts";
import { wireframe, wireframeSvg } from "../src/layout/wireframe-svg.ts";
import { INFO_SCRIPT } from "../src/view/gallery-info.ts";
import { WIREFRAME_SCRIPT } from "../src/view/gallery-wireframe.ts";
import { SUGGEST_SCRIPT } from "../src/view/report-suggest.ts";

const TAGS = new Set(["svg", "g", "title", "rect", "text", "circle"]);
const ATTRS = new Set([
  "xmlns",
  "class",
  "viewBox",
  "width",
  "height",
  "role",
  "aria-label",
  "transform",
  "x",
  "y",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "font-size",
  "cx",
  "cy",
  "r",
]);
const SAFE_VALUE =
  /^(-?\d+(\.\d+)?|#[0-9a-f]{3,6}|none|wireframe|img|Layout wireframe|http:\/\/www\.w3\.org\/2000\/svg|0 0 100 \d+(\.\d+)?|1\.2 0\.8|rotate\(-?\d+(\.\d+)? -?\d+(\.\d+)? -?\d+(\.\d+)?\))$/i;

const EVIL = [
  '"><script>alert(1)</script>',
  "</text><script>alert(2)</script><foreignObject><body onload=alert(3)>",
  "' onmouseover='alert(4)",
  '<a href="javascript:alert(5)">x</a>',
  "<img src=x onerror=alert(6)>",
];

const el = (over: Record<string, unknown>) => ({
  id: EVIL[0],
  role: 'band" onload="alert(7)',
  box: { x: Number.NaN, y: "1e999", w: 1e308, h: -Infinity },
  tiltDeg: "0) scale(99",
  z: "x",
  textEn: EVIL[1],
  note: "",
  capture: null,
  textRef: null,
  text: EVIL[2],
  covers: [],
  ...over,
});

const evilLayout = {
  inGame: [el({ role: "hud", box: { x: 5, y: 5, w: 90, h: 50 }, tiltDeg: 0, z: 0 }), el({})],
  marketing: [
    el({
      role: "headline",
      textEn: EVIL[3],
      box: { x: 10, y: 60, w: 80, h: 10 },
      tiltDeg: Number.POSITIVE_INFINITY,
    }),
    el({ id: EVIL[4], textEn: EVIL[4] }),
  ],
  composition: {
    focal: { x: "javascript:alert(8)", y: Number.NaN, id: EVIL[0] },
    readingOrder: [],
    overlaySharePercent: 0,
    summary: EVIL[1],
  },
} as unknown as Layout;

/** Every tag and attribute of an SVG string is on the allowlist, every value is inert. */
function assertSafeMarkup(svg: string): void {
  for (const m of svg.matchAll(/<\/?([^\s>/]+)([^>]*)>/g)) {
    assert.ok(TAGS.has(m[1] ?? ""), `tag ${m[1]}`);
    const attrs = m[2] ?? "";
    for (const a of attrs.matchAll(/\s*([^\s=]+)="([^"]*)"/g)) {
      assert.ok(ATTRS.has(a[1] ?? ""), `attribute ${a[1]}`);
      assert.match(a[2] ?? "", SAFE_VALUE, `value of ${a[1]}`);
    }
    assert.equal(attrs.replace(/\s*[^\s=]+="[^"]*"/g, "").replace(/\s*\/$/, ""), "");
  }
  assert.ok(!/<script|<foreignObject|<a\b|<img|<body/i.test(svg));
}

test("server: hostile layout text and numbers give only checked primitives", () => {
  const wf = wireframe(evilLayout, { width: 900, height: Number.NaN }, null, Number.NaN);
  for (const v of [wf.width, wf.height, wf.viewH, wf.focal.x, wf.focal.y]) {
    assert.ok(Number.isFinite(v), `finite ${v}`);
  }
  for (const s of wf.shapes) {
    for (const v of [s.x, s.y, s.w, s.h, s.rot, s.fillOpacity]) assert.ok(Number.isFinite(v));
    assert.ok(s.x >= -100 && s.x <= 200 && s.w <= 200 && s.rot >= -90 && s.rot <= 90);
    assert.match(s.colour, /^#[0-9a-f]{6}$/);
  }
  const bad = wf.shapes.filter((s) => s.title.includes(" Other"));
  assert.equal(bad.length, 2, "unknown roles fall back to other");
  for (const s of bad) assert.equal(s.colour, "#b0bec5");
  assertSafeMarkup(wireframeSvg(evilLayout, { width: 900, height: 1600 }));
  assertSafeMarkup(wireframeSvg(evilLayout, { width: 0, height: 0 }, null, 1e9));
  const junk = { inGame: [null, 7, "<script>"], marketing: "x", composition: { focal: null } };
  const empty = wireframe(junk as unknown as Layout, { width: 9, height: 16 });
  assert.deepEqual([empty.shapes.length, empty.focal.x], [0, 50]);
  assertSafeMarkup(wireframeSvg(null as unknown as Layout, { width: 9, height: 16 }));
});

type Node = {
  ns: string;
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
  textContent: string;
};
const fakeDoc = {
  createElementNS: (ns: string, tag: string) => {
    const n: Node & Record<string, unknown> = { ns, tag, attrs: {}, children: [], textContent: "" };
    n.setAttribute = (k: string, v: string) => {
      n.attrs[k] = String(v);
    };
    n.appendChild = (c: Node) => {
      n.children.push(c);
      return c;
    };
    return n;
  },
};
const draw = new Function("document", `${WIREFRAME_SCRIPT}; return wireframeNode;`)(fakeDoc) as (
  wf: unknown,
) => Node;

function assertSafeTree(n: Node, texts: string[]): void {
  assert.equal(n.ns, "http://www.w3.org/2000/svg");
  assert.ok(TAGS.has(n.tag), `tag ${n.tag}`);
  for (const [k, v] of Object.entries(n.attrs)) {
    assert.ok(ATTRS.has(k), `attribute ${k}`);
    assert.match(v, SAFE_VALUE, `value of ${k}: ${v}`);
  }
  if (n.textContent) texts.push(n.textContent);
  for (const c of n.children) assertSafeTree(c, texts);
}

test("client: the wireframe is built with DOM calls; hostile data stays inert text", () => {
  assert.ok(!/innerHTML|insertAdjacentHTML|DOMParser|outerHTML/.test(WIREFRAME_SCRIPT));
  const fromServer = wireframe(evilLayout, { width: 900, height: 1600 });
  const tampered = {
    width: '100%" onload="alert(1)',
    height: Number.NaN,
    viewH: "1e999",
    focal: { x: EVIL[0], y: Infinity },
    shapes: [
      {
        x: "javascript:alert(1)",
        y: 1e308,
        w: -5,
        h: Number.NaN,
        rot: "1) translate(9",
        colour: 'red" onclick="alert(1)',
        fillOpacity: "url(#x)",
        dashed: "yes",
        label: EVIL[1],
        title: { toString: () => EVIL[4] },
      },
      null,
      "<script>",
    ],
  };
  for (const wf of [fromServer, tampered]) {
    const texts: string[] = [];
    const root = draw(wf);
    assert.equal(root.tag, "svg");
    assertSafeTree(root, texts);
    assert.ok(texts.includes("Focal point"));
  }
  const texts: string[] = [];
  assertSafeTree(draw(fromServer), texts);
  assert.ok(
    texts.some((t) => t.includes("</text><script>")),
    "labels kept as literal text",
  );
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
      wireframe: wireframe(evilLayout, { width: 9, height: 16 }),
      summary: EVIL[1],
      coverageUpTo: hostile,
    },
  });
  assert.match(html, /<div class="wf"><\/div>/);
  assert.ok(!/<img|<script|<foreignObject|<svg/i.test(html), html);
});

test("suggestion links stay on this page or site; other schemes become #", () => {
  const src = SUGGEST_SCRIPT.match(/const safeHref = .*/)?.[0] ?? "";
  const safeHref = new Function(`${src}; return safeHref;`)() as (h: unknown) => string;
  for (const h of ["#screenshots", "/p/x/", "/p/x/?a=1#b"]) assert.equal(safeHref(h), h);
  const bad = [
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "javascript:alert(1)",
    " /x",
    "https://x",
    5,
  ];
  for (const h of bad) assert.equal(safeHref(h), "#", String(h));
});

test("existing wireframe rendering is unchanged for a normal layout", () => {
  const ok = {
    inGame: [
      el({
        id: "S1",
        role: "hud",
        box: { x: 0, y: 0, w: 100, h: 8 },
        tiltDeg: 0,
        z: 0,
        textEn: null,
      }),
    ],
    marketing: [
      el({
        id: "M1",
        role: "band",
        box: { x: 0, y: 70, w: 100, h: 20 },
        tiltDeg: -3,
        z: 0,
        textEn: "Win",
      }),
    ],
    composition: {
      focal: { x: 50, y: 50, id: "M1" },
      readingOrder: [],
      overlaySharePercent: 20,
      summary: "",
    },
  } as unknown as Layout;
  const svg = wireframeSvg(ok, { width: 900, height: 1600 });
  assert.match(svg, /viewBox="0 0 100 177.78" width="150" height="267"/);
  assert.match(
    svg,
    /<g transform="rotate\(-3 50 142.22\)"><title>M1 Band: Win<\/title><rect x="0" y="124.44" width="100" height="35.56" fill="#f2a541" fill-opacity="0.55"/,
  );
  assert.match(svg, /<text x="1" y="3.2" font-size="2.6" fill="#1b1b1b">S1 HUD<\/text>/);
  assert.match(svg, /<circle cx="50" cy="88.89" r="1.6"/);
  assertSafeMarkup(svg);
});
