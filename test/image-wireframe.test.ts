import assert from "node:assert/strict";
import { test } from "node:test";
import type { ImageAnalysis } from "../src/analysis/schema.ts";
import { numberedWireframe } from "../src/layout/wireframe-numbered.ts";
import { wireframe } from "../src/layout/wireframe-svg.ts";
import type { ImagePage } from "../src/server/image-view.ts";
import { INFO_SCRIPT } from "../src/view/gallery-info.ts";
import { WIREFRAME_SCRIPT } from "../src/view/gallery-wireframe.ts";
import { imageHtml } from "../src/view/image-html.ts";
import { reading } from "./helpers/fake-provider.ts";
import { fakeLayout } from "./helpers/layout.ts";

const EVIL = "</script><img src=x onerror=alert(1)>\"'&";
const a = reading("img1", "gameplay", "BEAT EVERY BOSS") as ImageAnalysis;
const layout = fakeLayout(a);
layout.inGame.push(
  {
    ...layout.inGame[0],
    id: "S2",
    role: "character",
    note: "knight, blue armour, determined",
    box: { x: 10, y: 50, w: 20, h: 30 },
  } as never,
  {
    ...layout.inGame[0],
    id: "S3",
    role: "panel",
    note: "gear card",
    box: { x: 60, y: 70, w: 10, h: 10 },
  } as never,
  {
    ...layout.inGame[0],
    id: "S4",
    role: "panel",
    note: "gear card",
    box: { x: 75, y: 70, w: 10, h: 10 },
  } as never,
);

test("numbered wireframes: numbers on the shapes match the list rows; repeats share one row", () => {
  const wf = numberedWireframe(layout, { width: 1080, height: 1920 }, null, {
    screenshot: { description: "a battle" },
    marketing: { elements: [] },
    texts: a.marketingLayer.texts,
  });
  const [shot, mk] = wf.panels;
  assert.ok(shot && mk);
  assert.deepEqual(
    shot.chips.map((c) => c.n),
    ["1", "2", "3", "4"],
  );
  assert.deepEqual(
    mk.chips.map((c) => c.n),
    ["M1", "M2"],
  );
  // Every chip number is in exactly one row; the two gear cards share a row.
  const rowNos = shot.rows.flatMap((r) => r.n.split(", "));
  assert.deepEqual([...rowNos].sort(), ["1", "2", "3", "4"]);
  assert.ok(shot.rows.some((r) => r.n === "3, 4" && /Panel: gear card/.test(r.name)));
  // Texts carry the exact words; no text labels are drawn in numbered mode.
  const head = mk.rows.find((r) => r.name.startsWith("Headline"));
  assert.equal(head?.text, "BEAT EVERY BOSS");
  for (const p of wf.panels) assert.deepEqual(p.labels, []);
  // Chips stay inside the picture.
  for (const p of wf.panels)
    for (const c of p.chips) assert.ok(c.x >= 0 && c.y >= 0 && c.x <= p.w && c.y <= p.h);
});

test("the popover's wireframe() is unchanged: labels, no chips or rows", () => {
  const wf = wireframe(layout, { width: 1080, height: 1920 });
  for (const p of wf.panels) {
    assert.ok(p.labels.length > 0);
    assert.equal((p as unknown as { chips?: unknown }).chips, undefined);
    assert.equal((p as unknown as { rows?: unknown }).rows, undefined);
  }
});

type N = {
  tag: string;
  attrs: Record<string, string>;
  children: N[];
  textContent: string;
  className?: string;
};
const node = (tag: string): N & Record<string, unknown> => {
  const n: N & Record<string, unknown> = { tag, attrs: {}, children: [], textContent: "" };
  n.setAttribute = (k: string, v: string) => {
    n.attrs[k] = String(v);
  };
  n.appendChild = (c: N) => {
    n.children.push(c);
    return c;
  };
  return n;
};
const doc = {
  createElementNS: (_: string, tag: string) => node(tag),
  createElement: (tag: string) => Object.assign(node(tag), { className: "", style: {} }),
};
const draw = new Function("document", `${WIREFRAME_SCRIPT}; return wireframeNode;`)(doc) as (
  w: unknown,
) => N;
const all = (n: N): N[] => [n, ...n.children.flatMap(all)];

test("renderer: number chips and rows as DOM text; hostile rows stay inert", () => {
  const wf = numberedWireframe(layout, { width: 1080, height: 1920 });
  const p = wf.panels[1] as unknown as Record<string, unknown>;
  p.rows = [{ n: `M1${EVIL}`, name: EVIL, text: EVIL, english: EVIL, about: EVIL }];
  p.chips = [
    { n: EVIL, x: 5, y: 5 },
    { n: "M1", x: "javascript:1", y: 5 },
  ];
  const root = draw(wf);
  const nodes = all(root);
  assert.ok(nodes.some((n) => n.tag === "ol"));
  const chipTexts = nodes.filter((n) => n.tag === "text").map((n) => n.textContent);
  assert.ok(chipTexts.includes("M1"));
  assert.ok(!chipTexts.includes(EVIL), "a chip that is not a number is dropped");
  for (const n of nodes)
    for (const v of Object.values(n.attrs)) assert.doesNotMatch(v, /<|javascript/);
  const nos = nodes.filter((n) => n.className === "wf-no").map((n) => n.textContent);
  assert.ok(nos.includes(""), "a row number that is not a number is left empty");
  assert.ok(!nos.some((x) => x.includes("<")));
  assert.ok(
    nodes.some((n) => n.textContent === EVIL),
    "hostile text only as textContent",
  );
});

function evilPage(): ImagePage {
  const row = { label: EVIL, href: `/image/${"a".repeat(64)}?project=p`, note: EVIL };
  return {
    sha: "a".repeat(64),
    project: { id: "p", name: EVIL },
    choices: [
      { id: "p", name: EVIL, archived: false, href: "/image/x?project=p" },
      { id: "q", name: EVIL, archived: true, href: "/image/x?project=q" },
    ],
    notice: EVIL,
    context: {
      project: "p",
      app: "com.a.b",
      gl: "jp",
      hl: "ja",
      pos: 3,
      game: EVIL,
      country: "Japan",
    },
    header: { screen: EVIL, screenHint: EVIL, size: EVIL, logo: EVIL },
    picture: {
      src: `/p/p/images/orig/${"a".repeat(64)}.png`,
      previewOnly: true,
      overview: "/p/p/views/gallery.html#overview",
    },
    focus: { focus: EVIL, covers: EVIL, verdict: "mismatch", match: EVIL, reinforcement: "" },
    layoutNote: "",
    wireframe: null,
    summary: EVIL,
    older: false,
    texts: [
      {
        role: "Headline",
        text: EVIL,
        language: 'ja" onclick="x',
        english: EVIL,
        from: "layer comparison",
      },
    ],
    where: {
      here: [row],
      newText: [{ ...row, state: "not checked yet" }],
      newTextNoMatch: 1,
      sameScreen: [],
      sameScreenNoMatch: 0,
      others: [row],
    },
    footer: EVIL,
    measured: [[EVIL, EVIL]],
    colours: [{ label: EVIL, colours: [{ name: EVIL, hex: "" }] }],
    raw: [[EVIL, EVIL]],
    info: null,
    history: {
      attempts: [{ when: EVIL, what: EVIL, state: EVIL, usd: EVIL }],
      total: EVIL,
      notes: [EVIL],
    },
  };
}

test("image page HTML: every value escaped, the data JSON cannot end its script, reinforcement not invented", () => {
  const html = imageHtml(evilPage(), "tok");
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /onclick="x/);
  const data =
    /<script type="application\/json" id="page">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  assert.doesNotMatch(data, /<\//);
  assert.match(html, /<span class="k">Reinforcement<\/span> Not analysed yet/);
  assert.match(html, /class="bad"/, "a mismatch is shown in red");
  assert.match(html, /not checked yet/);
  assert.match(html, /1 other picture checked: no match/);
  // Flags only in titles: the running text of the where-used band has no flag picture.
  const where = /<section class="band blue" id="where">([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";
  assert.doesNotMatch(where, /img class="flag"/);
  assert.match(html, /<h1>[^<]*·\s*<span class="cty"><img class="flag"/);
});

test("the (i) popover links to the image page in a new tab, with the thumbnail's context", () => {
  const f = new Function(
    "APP",
    "DATA",
    "document",
    "window",
    "esc",
    `${INFO_SCRIPT}; return { infoBtn, imagePageHref, identity: (link, v) => { infoLink = link; return identityHtml(v); } };`,
  );
  const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const stub = { addEventListener() {} };
  const sha = "b".repeat(64);
  const api = f(
    { apiBase: "/p/rogue-legend/api" },
    { info: { [sha]: { pending: null } } },
    stub,
    stub,
    esc,
  ) as {
    infoBtn: (id: string, ctx: unknown) => string;
    imagePageHref: (id: string, btn: unknown) => string;
    identity: (link: string, v: unknown) => string;
  };
  const btn = api.infoBtn(sha, { app: "com.a.b", gl: "jp", hl: "ja", pos: 3 });
  assert.match(btn, /data-ctx="com\.a\.b\|jp\|ja\|3"/);
  const href = api.imagePageHref(sha, { dataset: { ctx: "com.a.b|jp|ja|3" } });
  assert.equal(href, `/image/${sha}?project=rogue-legend&app=com.a.b&gl=jp&hl=ja&pos=3`);
  const html = api.identity(href, {
    game: "G",
    position: 3,
    filename: "f",
    file: null,
    sourceUrl: null,
    appearances: [],
  });
  assert.match(
    html,
    /<a class="imgpage" href="\/image\/b{64}\?project=rogue-legend&#38;app=com\.a\.b&#38;gl=jp&#38;hl=ja&#38;pos=3" target="_blank" rel="noopener">Open image page<\/a>/,
  );
  // Outside the tool (no project API) there is no link.
  const off = f({}, { info: {} }, stub, stub, esc) as typeof api;
  assert.equal(off.imagePageHref(sha, { dataset: {} }), "");
});
