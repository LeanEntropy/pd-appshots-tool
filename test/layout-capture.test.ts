import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CallContext } from "../src/analysis/call.ts";
import type { ModelImage, Provider, VisionCall } from "../src/analysis/providers.ts";
import type { Taxonomy } from "../src/config/load.ts";
import { layoutCall, readingForLayout } from "../src/layout/call.ts";
import { readLayout } from "../src/layout/checks.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { reading } from "./helpers/fake-provider.ts";
import { fakeLayout } from "./helpers/layout.ts";

const image: ModelImage = {
  mimeType: "image/jpeg",
  localPath: "a.jpg",
  bytes: () => Buffer.from(""),
};
const taxonomy = {
  id: "t",
  version: "1",
  definitions: {},
  subtypeLabels: {},
  screenTypes: [{ id: "gameplay", label: "G", subtypes: ["battle"] }],
} as unknown as Taxonomy;

function context(): CallContext {
  return {
    storage: workspaceStorage(mkdtempSync(join(tmpdir(), "ssr-layout-"))),
    answerKey: (step, key) => `projects/p/objects/${step}/${key}.json`,
    taxonomy,
    taxonomyHash: "t",
    maxBudgetUsd: 1,
    remainingUsd: () => 10,
    timeoutMs: 1000,
    onCost: () => {},
  };
}

const good = () => reading("img1", "gameplay", "EPIC");
// A box entirely outside the picture (clamped to nothing): a hard problem.
const badLayout = () => {
  const l = fakeLayout(good());
  return { ...l, inGame: l.inGame.map((e) => ({ ...e, box: { x: 0, y: 130, w: 50, h: 10 } })) };
};

function provider(answer: (n: number) => unknown): Provider & { calls: VisionCall[] } {
  const calls: VisionCall[] = [];
  return {
    family: "anthropic",
    model: "fake",
    calls,
    async call(c) {
      calls.push(c);
      return { ok: true, output: answer(calls.length), costUsd: 0.1, error: null };
    },
  };
}

const system = { text: "layout prompt", hash: "lh", file: "" };
const run = (p: Provider, ctx: CallContext) =>
  layoutCall(p, system, { imageId: "a", image }, good(), ctx);

test("the layout call gets the image and the finished reading; the main answer is not asked for", async () => {
  const p = provider(() => ({ layout: fakeLayout(good()) }));
  const out = await run(p, context());
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0]?.images.length, 1);
  assert.match(p.calls[0]?.prompt ?? "", /^Draw the layout/);
  assert.ok(p.calls[0]?.prompt.includes(readingForLayout(good())));
  const schema = p.calls[0]?.schema as { properties: object } | undefined;
  const props = Object.keys(schema?.properties ?? {});
  assert.deepEqual(props, ["layout"]);
  assert.ok(out.layout);
});

test("a layout that does not fit the reading is repaired; the saved answer is reused for free", async () => {
  const ctx = context();
  const p = provider((n) => ({ layout: n === 1 ? badLayout() : fakeLayout(good()) }));
  const out = await run(p, ctx);
  assert.equal(p.calls.length, 2);
  assert.match(p.calls[1]?.prompt ?? "", /S1 has an empty box \(or one outside the image\)/);
  assert.ok(out.layout);
  await run(p, ctx);
  assert.equal(p.calls.length, 2, "cached");
});

test("a layout that never fits comes back missing, with its problems", async () => {
  const p = provider(() => ({ layout: badLayout() }));
  const out = await run(p, context());
  assert.equal(out.layout, null);
  assert.equal(p.calls.length, 3, "two repairs at most");
  assert.match(out.problems.join(), /S1 has an empty box/);
});

test("a layout that only disagrees with the analysis is saved on the first answer, no retry", async () => {
  const p = provider(() => ({ layout: { ...fakeLayout(good()), marketing: [] } }));
  const out = await run(p, context());
  assert.equal(p.calls.length, 1);
  assert.ok(out.layout);
  assert.deepEqual(readLayout({ ...fakeLayout(good()), marketing: [] }, good()).notes, [
    'Note: the headline "EPIC" has no box.',
    "Note: the analysis found a marketing layer, but no marketing box is drawn.",
    'Note: the focal point names "M2", which is not drawn.',
    "Note: the reading order names M2, which is not drawn.",
    'Note: the focus verdict ("match") does not match the marketing boxes drawn.',
    "Note: the focus texts describe a marketing layer, but no marketing box is drawn.",
  ]);
});
test("hard checks: text and capture references that do not exist, too many boxes", () => {
  const core = good();
  assert.deepEqual(readLayout(fakeLayout(core), core), {
    layout: readLayout(fakeLayout(core), core).layout,
    problems: [],
    notes: [],
  });
  const l = fakeLayout(core);
  const m2 = l.marketing[1];
  if (m2) m2.textRef = 3;
  const s1 = l.inGame[0];
  if (s1) s1.capture = 2;
  const bad = readLayout(l, core);
  assert.equal(bad.layout, null);
  const p = bad.problems.join("\n");
  assert.match(p, /textRef 3 does not exist/);
  assert.match(p, /capture 2 does not exist/);
  assert.match(readLayout(undefined, core).problems.join(), /missing/);
  const seventeen = {
    ...fakeLayout(core),
    inGame: Array.from({ length: 17 }, (_, i) => ({ ...l.inGame[0], id: `S${i + 1}` })),
  };
  assert.match(readLayout(seventeen, core).problems.join(), /inGame/);
  const nan = fakeLayout(core);
  nan.composition.focal.x = 140;
  assert.match(readLayout(nan, core).problems.join(), /focal point must be inside/);
});

test("covering: marketing over marketing is accepted; a covered id that is not drawn is a note", () => {
  const core = good();
  const l = fakeLayout(core);
  const band = l.marketing[0] as (typeof l.marketing)[0];
  l.marketing.push({ ...band, id: "M3", role: "badge", z: 2, covers: ["M2", "S1"] });
  assert.deepEqual(readLayout(l, core).problems, []);
  assert.deepEqual(readLayout(l, core).notes, []);
  band.covers = ["S9"];
  const r = readLayout(l, core);
  assert.ok(r.layout);
  assert.deepEqual(r.notes, ['Note: M1 is listed as covering "S9", which is not drawn.']);
});

test("soft checks never reject: text linking, the marketing layer present or absent", () => {
  const core = good();
  // Contract v2: a logo carries its own text; a headline should point at the transcribed one.
  const logo = { ...fakeLayout(core) };
  logo.marketing = [
    ...logo.marketing,
    {
      ...(logo.marketing[0] as (typeof logo.marketing)[0]),
      id: "M3",
      role: "logo",
      text: "ダダサバイバー",
      covers: [],
    },
  ];
  assert.deepEqual(readLayout(logo, core).notes, []);
  const head = fakeLayout(core);
  const h = head.marketing[1];
  if (h) h.textRef = null;
  if (h) h.text = "EPIC";
  const said = readLayout(head, core);
  assert.ok(said.layout);
  assert.deepEqual(said.notes, [
    "Note: M2 (headline) repeats its text instead of linking the analysis' text.",
  ]);
  const noLayer = reading("img1", "gameplay", "", false);
  // Its headline points at no text: the analysis without a layer has none to point at.
  const drawn = fakeLayout(core);
  for (const e of drawn.marketing) e.textRef = null;
  const absent = readLayout(drawn, noLayer);
  assert.ok(absent.layout);
  assert.match(absent.notes.join(), /the analysis found no marketing layer, but 2 marketing boxes/);
});
