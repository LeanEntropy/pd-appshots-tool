import assert from "node:assert/strict";
import { test } from "node:test";
import type { LoadedConfig } from "../src/config/load.ts";
import {
  type AnchorCandidate,
  type PixelInput,
  pairKey,
  type ScopeInput,
  tierScope,
} from "../src/reports/anchors.ts";
import { blocking, doubtfulInPlan, savePairVerdicts } from "../src/reports/match-check.ts";
import { ensurePixelChecks } from "../src/reports/pixel-pairs.ts";
import { buildScopePlan } from "../src/reports/scope-plan.ts";
import { postPairVerdicts } from "../src/server/pixel-api.ts";
import { hash, JP, setup, withMode } from "./helpers/pixel-setup.ts";

const plan = (l: LoadedConfig, capy: string) =>
  buildScopePlan(l, { type: "country", markets: [JP], competitors: [capy], includeCharts: [] });

const jpItem = (p: ReturnType<typeof plan>, id: string) =>
  p.items.find((i) => i.imageId === id && i.gl === "jp");

test("pixel plan: suggest mode moves nothing before confirmation, then the pairs become text comparisons", async () => {
  const { loaded, capy, ids } = await setup();
  assert.equal(await ensurePixelChecks(loaded), 3);
  assert.equal(await ensurePixelChecks(loaded), 0, "cached per pair");
  const before = plan(loaded, capy);
  const [a, b, c] = ids.jp as [string, string, string];
  assert.equal(jpItem(before, a)?.tier, "layer-diff");
  assert.equal(jpItem(before, b)?.tier, "full");
  assert.equal(jpItem(before, b)?.pixelSuggested, ids.us[1]);
  assert.equal(jpItem(before, c)?.tier, "layer-diff");
  const d = doubtfulInPlan(loaded, before.items);
  const by = (id: string) => d.find((x) => x.image.id === id);
  assert.equal(by(a)?.group, "same-new-text");
  assert.equal(by(a)?.pixel?.verdict, "same-new-text");
  assert.equal(by(b)?.group, "moved");
  assert.equal(by(c)?.group, undefined, "a different screen is asked one by one");
  assert.equal(by(c)?.pixel?.verdict, "different");
  assert.ok((by(c)?.pixel?.areas.length ?? 0) > 0, "the changed areas can be outlined");
  assert.deepEqual(
    blocking(d)
      .map((x) => x.image.id)
      .sort(),
    [a, c].sort(),
  );
  // "Confirm all": one action answers the block; the moved image becomes a text comparison.
  const block = d.filter((x) => x.group === "same-new-text" || x.group === "moved");
  savePairVerdicts(
    loaded,
    block.map((x) => ({ image: x.image.id, anchor: x.anchor.id, same: true })),
  );
  const after = plan(loaded, capy);
  assert.equal(jpItem(after, b)?.tier, "layer-diff");
  assert.equal(jpItem(after, b)?.basedOn, ids.us[1]);
  assert.notEqual(after.planHash, before.planHash);
  assert.deepEqual(
    doubtfulInPlan(loaded, after.items).map((x) => x.image.id),
    [c],
  );
});

test("pixel plan: automatic mode decides; the user's saved answer still wins", async () => {
  const { loaded: base, capy, ids } = await setup();
  const loaded = withMode(base, "automatic");
  await ensurePixelChecks(loaded);
  const [a, b, c] = ids.jp as [string, string, string];
  const p = plan(loaded, capy);
  assert.equal(jpItem(p, a)?.tier, "layer-diff");
  assert.equal(jpItem(p, b)?.tier, "layer-diff");
  assert.equal(jpItem(p, c)?.tier, "full");
  const d = doubtfulInPlan(loaded, p.items);
  assert.deepEqual(
    d.map((x) => x.group),
    ["decided", "decided"],
  );
  assert.equal(blocking(d).length, 0);
  savePairVerdicts(loaded, [
    { image: a, anchor: ids.us[0] as string, same: false },
    { image: c, anchor: ids.us[2] as string, same: true },
  ]);
  const q = plan(loaded, capy);
  assert.equal(jpItem(q, a)?.tier, "full");
  assert.equal(jpItem(q, c)?.tier, "layer-diff");
  // In suggest mode too: the user's "different" wins over "same picture, new text".
  const s = plan(withMode(base, "suggest"), capy);
  assert.equal(jpItem(s, a)?.tier, "full");
});

test("pixel plan: off is exactly the fingerprint rule", async () => {
  const { loaded: base, capy, ids } = await setup();
  const loaded = withMode(base, "off");
  assert.equal(await ensurePixelChecks(loaded), 0);
  await ensurePixelChecks(base);
  const p = plan(loaded, capy);
  const [a, b, c] = ids.jp as [string, string, string];
  assert.deepEqual(
    [a, b, c].map((id) => jpItem(p, id)?.tier),
    ["layer-diff", "full", "layer-diff"],
  );
  assert.ok(p.items.every((i) => i.pixelSuggested === undefined));
  const d = doubtfulInPlan(loaded, p.items);
  assert.deepEqual(
    d.map((x) => [x.image.id, x.pixel, x.group]),
    [[a, undefined, undefined]],
  );
});

test("pixel plan: tierScope keeps identical reuse and the main country first", () => {
  const cand = (id: string, phash: string, analysed = true): AnchorCandidate => ({
    appId: "g",
    gl: "us",
    hl: "en",
    country: "United States",
    position: 1,
    imageId: id,
    phash,
    width: 1080,
    height: 1920,
    analysed,
  });
  const input = (id: string, phash: string): ScopeInput => ({
    appId: "g",
    gl: "jp",
    hl: "ja",
    country: "Japan",
    main: false,
    position: 1,
    imageId: id,
    phash,
    width: 1080,
    height: 1920,
  });
  const main = new Map([["g", [cand("u1", hash(1))]]]);
  const pixel = (mode: PixelInput["mode"], same: string[] = []): PixelInput => ({
    mode,
    same: new Set(same),
    verdict: () => "same-new-text",
  });
  const run = (px?: PixelInput, analysed: string[] = []) =>
    tierScope(
      [input("j1", hash(1, 12))],
      main,
      new Map(),
      new Set(analysed),
      "the US",
      new Set(),
      px,
    );
  assert.equal(run()[0]?.tier, "full");
  assert.equal(run(pixel("suggest"))[0]?.tier, "full");
  assert.equal(run(pixel("suggest"))[0]?.pixelSuggested, "u1");
  assert.equal(run(pixel("suggest", [pairKey("u1", "j1")]))[0]?.tier, "layer-diff");
  assert.equal(run(pixel("automatic"))[0]?.tier, "layer-diff");
  assert.equal(run(pixel("automatic"), ["j1"])[0]?.tier, "identical", "identical reuse first");
  const far = tierScope(
    [input("j1", hash(1, 15))],
    main,
    new Map(),
    new Set(),
    "the US",
    new Set(),
    pixel("automatic"),
  );
  assert.equal(far[0]?.tier, "full", "over 14 bits is never a candidate");
});

test("pixel plan: Confirm all saves the block in one request; far or unknown pairs are refused", async () => {
  const { loaded, capy, ids } = await setup();
  await ensurePixelChecks(loaded);
  const [a, b] = ids.jp as [string, string];
  const pairs = [
    { image: a, anchor: ids.us[0] as string, same: true },
    { image: b, anchor: ids.us[1] as string, same: true },
  ];
  const far = { image: a, anchor: ids.us[2] as string, same: true };
  assert.equal(postPairVerdicts(loaded, { pairs: [...pairs, far] }).status, 400);
  assert.equal(postPairVerdicts(loaded, { pairs: [] }).status, 400);
  assert.equal(jpItem(plan(loaded, capy), b)?.tier, "full", "nothing saved by a refused request");
  const r = postPairVerdicts(loaded, { pairs });
  assert.deepEqual([r.status, r.body], [200, { saved: 2 }]);
  assert.equal(jpItem(plan(loaded, capy), b)?.tier, "layer-diff");
});
