import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CallContext } from "../src/analysis/call.ts";
import { analyseImages } from "../src/analysis/call-images.ts";
import type { ModelImage, Provider, VisionCall } from "../src/analysis/providers.ts";
import type { Taxonomy } from "../src/config/load.ts";
import { readLayout } from "../src/layout/checks.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { reading } from "./helpers/fake-provider.ts";
import { asksLayout, fakeLayout } from "./helpers/layout.ts";

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

type Answer = (n: number) => unknown;
const good = () => reading("img1", "gameplay", "EPIC");
const withLayout = (layout: unknown, core = good()) => ({ images: [{ ...core, layout }] });
const badLayout = () => ({ ...fakeLayout(good()), marketing: [] });
const badCore = () => ({ ...good(), screenshot: { ...good().screenshot, subtype: "nope" } });

function provider(answer: Answer): Provider & { calls: VisionCall[] } {
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

const run = (p: Provider, ctx: CallContext) =>
  analyseImages(
    "full-analysis",
    p,
    { text: "s", hash: "h", file: "" },
    [{ imageId: "a", image }],
    ctx,
    false,
    true,
  );

test("the layout is asked for in the same call and a valid one needs no repair", async () => {
  const p = provider(() => withLayout(fakeLayout(good())));
  const out = await run(p, context());
  assert.equal(p.calls.length, 1);
  assert.ok(asksLayout(p.calls[0]?.schema));
  assert.equal(out.readings.get("a")?.headline, "EPIC");
});

test("an invalid layout never drops a valid core: one repair of its own, then the core stays", async () => {
  const ctx = context();
  const p = provider(() => withLayout(badLayout()));
  const out = await run(p, ctx);
  assert.equal(p.calls.length, 2, "one extra call for the layout alone");
  assert.match(p.calls[1]?.prompt ?? "", /marketing layer is present/);
  assert.equal(out.failed.size, 0);
  assert.equal(out.readings.get("a")?.headline, "EPIC");
  // The saved answer is reused without a new call.
  const again = await run(p, ctx);
  assert.equal(p.calls.length, 2);
  assert.equal(again.readings.size, 1);
});

test("layout problems join the repair while the core also needs one", async () => {
  const p = provider((n) =>
    n === 1 ? withLayout(badLayout(), badCore()) : withLayout(fakeLayout(good())),
  );
  const out = await run(p, context());
  assert.equal(p.calls.length, 2);
  const repair = p.calls[1]?.prompt ?? "";
  assert.match(repair, /subtype "nope"/);
  assert.match(repair, /layout/);
  assert.equal(out.readings.size, 1);
});

test("a layout repair that breaks the core keeps the first valid core", async () => {
  const p = provider((n) =>
    n === 1 ? withLayout(badLayout()) : withLayout(badLayout(), badCore()),
  );
  const out = await run(p, context());
  assert.equal(p.calls.length, 2);
  assert.equal(out.failed.size, 0);
  assert.equal(out.readings.get("a")?.screenshot.subtype, "");
});

test("a core valid only on its last repair still gets the layout's own repair", async () => {
  const p = provider((n) =>
    n < 3
      ? withLayout(badLayout(), badCore())
      : n === 3
        ? withLayout(badLayout())
        : withLayout(fakeLayout(good())),
  );
  const out = await run(p, context());
  assert.equal(p.calls.length, 4, "two core repairs, then one for the layout alone");
  assert.equal(out.readings.size, 1);
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
  const noLayer = reading("img1", "gameplay", "", false);
  assert.match(readLayout(fakeLayout(core), noLayer).problems.join(), /marketing layer is absent/);
  assert.match(readLayout(undefined, core).problems.join(), /missing/);
  const nine = {
    ...fakeLayout(core),
    inGame: Array.from({ length: 9 }, (_, i) => ({ ...l.inGame[0], id: `S${i + 1}` })),
  };
  assert.match(readLayout(nine, core).problems.join(), /inGame/);
});
