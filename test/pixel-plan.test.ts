import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { type LoadedConfig, projectPaths } from "../src/config/load.ts";
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
import { openImageDb } from "../src/store/imagedb.ts";
import { readDeck } from "../src/store/manifest.ts";
import { addDeck, analyse, builderProject, idOf, usBytes } from "./helpers/builder.ts";

/** A 64-bit fingerprint: anchor p owns bits 16p..16p+15; `flip` changes the first bits. */
const hash = (p: number, flip = 0) =>
  Array.from({ length: 64 }, (_, i) => {
    const on = i >= 16 * p && i < 16 * p + 16;
    return (i < flip ? !on : on) ? "1" : "0";
  }).join("");

async function paint(buf: Buffer, box: { x: number; y: number; w: number; h: number }, v: number) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const x0 = Math.round((box.x / 100) * info.width);
  const y0 = Math.round((box.y / 100) * info.height);
  for (let y = y0; y < y0 + Math.round((box.h / 100) * info.height); y++)
    for (let x = x0; x < x0 + Math.round((box.w / 100) * info.width); x++)
      for (let c = 0; c < info.channels; c++) data[(y * info.width + x) * info.channels + c] = v;
  return sharp(data, { raw: info }).png().toBuffer();
}

const JP = { gl: "jp", hl: "ja", label: "Japan" };

/**
 * Capybara Go analysed in the US; in Japan: #1 new text on the band, 5 bits away (a doubtful
 * text comparison today); #2 new text on the band, 9 bits away (a full analysis today); #3 a
 * different in-game screen, 3 bits away (a text comparison today).
 */
async function setup() {
  const loaded = await builderProject();
  const capy = idOf(loaded, "Capybara Go");
  analyse(loaded, [loaded.config.ourApp.name, "Capybara Go"]);
  const band = { x: 10, y: 4, w: 60, h: 6 };
  const jp = [
    await paint(usBytes(loaded, capy, 1), band, 255),
    await paint(usBytes(loaded, capy, 2), band, 255),
    await paint(usBytes(loaded, capy, 3), { x: 20, y: 40, w: 60, h: 40 }, 0),
  ];
  await addDeck(loaded, "Capybara Go", "jp", "ja", jp);
  const paths = projectPaths(loaded);
  assert.ok(!paths.library, "the test project keeps its own image database");
  const us = readDeck(paths.decks, { appId: capy, gl: "us", hl: "en" })?.slots ?? [];
  const ja = readDeck(paths.decks, { appId: capy, gl: "jp", hl: "ja" })?.slots ?? [];
  const db = openImageDb(paths);
  const set = (id: string | null | undefined, phash: string) => {
    const r = db.get(id as string);
    assert.ok(r);
    r.phash = phash;
  };
  for (const p of [1, 2, 3]) set(us[p - 1]?.imageId, hash(p));
  set(ja[0]?.imageId, hash(1, 5));
  set(ja[1]?.imageId, hash(2, 9));
  set(ja[2]?.imageId, hash(3, 3));
  db.save();
  const ids = {
    us: us.map((s) => s.imageId as string),
    jp: ja.map((s) => s.imageId as string),
  };
  return { loaded, capy, ids };
}

const withMode = (l: LoadedConfig, mode: "off" | "suggest" | "automatic"): LoadedConfig => ({
  ...l,
  config: {
    ...l.config,
    options: { ...l.config.options, pixelCheck: { ...l.config.options.pixelCheck, mode } },
  },
});

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
