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
const badLayout = () => ({ ...fakeLayout(good()), marketing: [] });

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
  assert.match(p.calls[1]?.prompt ?? "", /marketing layer is present/);
  assert.ok(out.layout);
  await run(p, ctx);
  assert.equal(p.calls.length, 2, "cached");
});

test("a layout that never fits comes back missing, with its problems", async () => {
  const p = provider(() => ({ layout: badLayout() }));
  const out = await run(p, context());
  assert.equal(out.layout, null);
  assert.equal(p.calls.length, 3, "two repairs at most");
  assert.match(out.problems.join(), /marketing layer is present/);
});
test("ownership checks: text and capture references, marketing present or absent, covers", () => {
  const core = good();
  assert.deepEqual(readLayout(fakeLayout(core), core).problems, []);
  const l = fakeLayout(core);
  const m2 = l.marketing[1];
  const m1 = l.marketing[0];
  if (m2) m2.textRef = 3;
  if (m1) m1.covers = ["S9"];
  const s1 = l.inGame[0];
  if (s1) s1.capture = 2;
  const p = readLayout(l, core).problems.join("\n");
  assert.match(p, /textRef 3 does not exist/);
  assert.match(p, /covers "S9"/);
  assert.match(p, /capture 2 does not exist/);
  // Contract v2: a logo carries its own text; a headline must point at the transcribed one.
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
  assert.deepEqual(readLayout(logo, core).problems, []);
  const head = fakeLayout(core);
  const h = head.marketing[1];
  if (h) h.textRef = null;
  if (h) h.text = "EPIC";
  assert.match(readLayout(head, core).problems.join(), /only logo and badge/);
  const noLayer = reading("img1", "gameplay", "", false);
  assert.match(readLayout(fakeLayout(core), noLayer).problems.join(), /marketing layer is absent/);
  assert.match(readLayout(undefined, core).problems.join(), /missing/);
  const seventeen = {
    ...fakeLayout(core),
    inGame: Array.from({ length: 17 }, (_, i) => ({ ...l.inGame[0], id: `S${i + 1}` })),
  };
  assert.match(readLayout(seventeen, core).problems.join(), /inGame/);
});
