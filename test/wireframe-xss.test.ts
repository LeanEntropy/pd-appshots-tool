import assert from "node:assert/strict";
import { test } from "node:test";
import type { Layout } from "../src/layout/schema.ts";
import { wireframeSvg } from "../src/layout/wireframe-render.ts";
import { wireframe } from "../src/layout/wireframe-svg.ts";
import { WIREFRAME_SCRIPT } from "../src/view/gallery-wireframe.ts";
import { SUGGEST_SCRIPT } from "../src/view/report-suggest.ts";

const TAGS = new Set(["svg", "g", "title", "rect", "text", "circle", "polygon", "line"]);
const HTML_TAGS = new Set(["div", "ul", "li", "span", "p"]);
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
  "rx",
  "x1",
  "y1",
  "x2",
  "y2",
  "points",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "font-size",
  "font-weight",
  "font-family",
  "cx",
  "cy",
  "r",
]);
const N = String.raw`-?\d+(\.\d+)?`;
const SAFE_VALUE = new RegExp(
  `^(${N}|#[0-9a-f]{3,6}|none|bold|wireframe|img|Layout wireframes?|Screenshot layer|Marketing layer|Arial, Helvetica, sans-serif|http://www\\.w3\\.org/2000/svg|0 0 ${N} ${N}|5 3|rotate\\(${N} ${N} ${N}\\)|(${N} ){5,15}${N})$`,
  "i",
);

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
  note: EVIL[3],
  capture: null,
  textRef: null,
  text: EVIL[2],
  covers: [],
  ...over,
});

const evilLayout = {
  inGame: [
    el({ role: "hud", box: { x: 5, y: 5, w: 90, h: 50 }, tiltDeg: 0, z: 0 }),
    el({ role: "character", note: EVIL[4], box: { x: 10, y: 60, w: 30, h: 30 } }),
    el({}),
  ],
  marketing: [
    el({
      role: "headline",
      textEn: EVIL[3],
      box: { x: 10, y: 60, w: 80, h: 10 },
      tiltDeg: Number.POSITIVE_INFINITY,
    }),
    el({ id: EVIL[4], role: "cut-out", textEn: EVIL[4], box: { x: 50, y: 50, w: 40, h: 40 } }),
  ],
  composition: {
    focal: { x: "javascript:alert(8)", y: Number.NaN, id: EVIL[0] },
    readingOrder: [],
    overlaySharePercent: 0,
    summary: EVIL[1],
  },
} as unknown as Layout;

const evilReading = {
  screenshot: { description: EVIL[1] },
  marketing: {
    elements: [{ kind: "character", what: EVIL[0], region: { x: 50, y: 50, w: 40, h: 40 } }],
  },
};

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
  const wf = wireframe(
    evilLayout,
    { width: 900, height: Number.NaN },
    null,
    Number.NaN,
    evilReading,
  );
  assert.equal(wf.panels.length, 2);
  for (const p of wf.panels) {
    for (const v of [p.w, p.h, p.strip]) assert.ok(Number.isFinite(v), `finite ${v}`);
    for (const s of p.shapes) {
      for (const v of [s.x, s.y, s.w, s.h, s.rot, s.rx, ...s.pts]) assert.ok(Number.isFinite(v));
      assert.ok(s.rot >= -45 && s.rot <= 45);
      assert.match(s.fill, /^#[0-9a-f]{6}$/);
      assert.match(s.stroke, /^#[0-9a-f]{6}$/);
    }
    for (const l of p.labels)
      for (const v of [l.x, l.y, l.w, l.h, l.rot, ...(l.lead ?? [])]) assert.ok(Number.isFinite(v));
  }
  assertSafeMarkup(wireframeSvg(evilLayout, { width: 900, height: 1600 }));
  assertSafeMarkup(wireframeSvg(evilLayout, { width: 0, height: 0 }, null, 1e9));
  const junk = { inGame: [null, 7, "<script>"], marketing: "x", composition: { focal: null } };
  const empty = wireframe(junk as unknown as Layout, { width: 9, height: 16 });
  assert.deepEqual(
    empty.panels.map((p) => p.shapes.length),
    [0, 0],
  );
  assertSafeMarkup(wireframeSvg(null as unknown as Layout, { width: 9, height: 16 }));
});

type Node = {
  ns: string;
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
  textContent: string;
  className?: string;
  style?: Record<string, string>;
};
const node = (ns: string, tag: string) => {
  const n: Node & Record<string, unknown> = { ns, tag, attrs: {}, children: [], textContent: "" };
  n.setAttribute = (k: string, v: string) => {
    n.attrs[k] = String(v);
  };
  n.appendChild = (c: Node) => {
    n.children.push(c);
    return c;
  };
  return n;
};
const fakeDoc = {
  createElementNS: (ns: string, tag: string) => node(ns, tag),
  createElement: (tag: string) => Object.assign(node("html", tag), { className: "", style: {} }),
};
const draw = new Function("document", `${WIREFRAME_SCRIPT}; return wireframeNode;`)(fakeDoc) as (
  wf: unknown,
) => Node;

function assertSafeTree(n: Node, texts: string[]): void {
  if (n.ns === "html") {
    assert.ok(HTML_TAGS.has(n.tag), `html tag ${n.tag}`);
    assert.deepEqual(n.attrs, {});
    assert.match(n.className ?? "", /^[a-z- ]*$/);
    for (const v of Object.values(n.style ?? {})) assert.match(v, /^\d+(\.\d+)?px$/);
  } else {
    assert.equal(n.ns, "http://www.w3.org/2000/svg");
    assert.ok(TAGS.has(n.tag), `tag ${n.tag}`);
    for (const [k, v] of Object.entries(n.attrs)) {
      assert.ok(ATTRS.has(k), `attribute ${k}`);
      assert.match(v, SAFE_VALUE, `value of ${k}: ${v}`);
    }
  }
  if (n.textContent) texts.push(n.textContent);
  for (const c of n.children) assertSafeTree(c, texts);
}

test("client: two panels built with DOM calls; hostile data stays inert text", () => {
  assert.ok(!/innerHTML|insertAdjacentHTML|DOMParser|outerHTML/.test(WIREFRAME_SCRIPT));
  const fromServer = wireframe(
    evilLayout,
    { width: 900, height: 1600 },
    null,
    undefined,
    evilReading,
  );
  const bad = {
    w: '100%" onload="alert(1)',
    h: Number.NaN,
    strip: "1e999",
    bg: "url(javascript:alert(1))",
    stroke: 'red" onclick="alert(1)',
    title: EVIL[0],
    focal: { x: EVIL[0], y: Infinity },
    shapes: [
      {
        pts: ["1) translate(9", 2, 3, 4, 5, 6],
        x: "javascript:alert(1)",
        y: 1e308,
        w: -5,
        h: Number.NaN,
        rot: "1) translate(9",
        rx: "x",
        fill: 'red" onclick="alert(1)',
        outline: "yes",
        dashed: "yes",
        title: { toString: () => EVIL[4] },
      },
      null,
      "<script>",
    ],
    labels: [
      {
        lines: [EVIL[1], 5],
        x: "x",
        y: Number.POSITIVE_INFINITY,
        w: -1,
        h: 5,
        rot: "9)",
        chip: 1,
        lead: ["a", 1, 2],
      },
    ],
    legend: [{ fill: "#zzzzzz", outline: 1, text: EVIL[2] }],
    summary: EVIL[3],
    details: EVIL[4],
  };
  for (const wf of [fromServer, { panels: [bad, bad, bad], note: EVIL[0] }]) {
    const texts: string[] = [];
    const root = draw(wf);
    assert.equal(root.tag, "div");
    assertSafeTree(root, texts);
  }
  const texts: string[] = [];
  const root = draw(fromServer);
  assertSafeTree(root, texts);
  assert.ok(texts.includes("Screenshot layer") && texts.includes("Marketing layer"));
  assert.ok(
    texts.some((t) => t.includes("</text><script>")),
    "text kept as literal text",
  );
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
