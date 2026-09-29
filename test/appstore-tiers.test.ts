import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { reshapedPair } from "../src/analysis/layer-crops.ts";
import type { AppleDeck } from "../src/appstore/data.ts";
import { BothStoresImageDb } from "../src/appstore/image-db.ts";
import { APPLE_DECKS_DIR, appleManifest, forPlatform } from "../src/appstore/platform.ts";
import {
  type AnchorCandidate,
  pairKey,
  type ScopeInput,
  tierScope,
} from "../src/reports/anchors.ts";
import { storeCounts } from "../src/reports/apple-scope.ts";
import { RESHAPED_BITS } from "../src/reports/cross-store.ts";
import type { ImageDb, ImageRecord } from "../src/store/imagedb.ts";
import { readDeck } from "../src/store/manifest.ts";
import { writeJsonAtomic } from "../src/util/fsx.ts";

const bits = (n: number) => "1".repeat(n) + "0".repeat(64 - n);
const PLAY = { width: 1080, height: 1920 };
const TALL = { width: 1242, height: 2688 };

const apple = (position: number, imageId: string, o: Partial<ScopeInput> = {}): ScopeInput => ({
  appId: "g",
  gl: "us",
  hl: "en",
  country: "United States",
  main: true,
  position,
  imageId,
  phash: bits(0),
  ...TALL,
  platform: "appstore",
  ...o,
});
const cand = (imageId: string, o: Partial<AnchorCandidate> = {}): AnchorCandidate => ({
  appId: "g",
  gl: "us",
  hl: "en",
  country: "United States",
  position: 1,
  imageId,
  phash: bits(0),
  ...PLAY,
  analysed: true,
  store: "Google Play",
  ...o,
});
const tiers = (inputs: ScopeInput[], cands: AnchorCandidate[], same: string[] = []) =>
  tierScope(
    inputs,
    new Map(),
    new Map(),
    new Set(cands.map((c) => c.imageId)),
    "the United States",
    new Set(),
    undefined,
    {
      candidates: new Map([["g", cands]]),
      same: new Set(same),
      bits: RESHAPED_BITS,
    },
  );

test("App Store tiers: the same picture as Play is free; the same shape and fingerprint is a text comparison", () => {
  const out = tiers(
    [apple(1, "a1", { sameAs: "p1" }), apple(2, "a2", { ...PLAY, phash: bits(3) })],
    [cand("p1"), cand("p2", { phash: bits(2) })],
  );
  assert.equal(out[0]?.tier, "identical");
  assert.equal(out[0]?.basedOn, "p1");
  assert.match(out[0]?.reason ?? "", /only file compression differs/);
  assert.equal(out[1]?.tier, "layer-diff");
  assert.equal(out[1]?.basedOn, "p2");
  assert.match(out[1]?.reason ?? "", /Google Play/);
});

test("App Store tiers: another shape is a full analysis until the user confirms the pair (never a doubtful text comparison)", () => {
  const near = [apple(1, "a1", { phash: bits(15) })];
  const doubtful = tiers(near, [cand("p1")]);
  assert.equal(doubtful[0]?.tier, "full");
  assert.equal(doubtful[0]?.pixelSuggested, "p1");
  assert.match(doubtful[0]?.reason ?? "", /answer Same screen/);
  const confirmed = tiers(near, [cand("p1")], [pairKey("p1", "a1")]);
  assert.equal(confirmed[0]?.tier, "layer-diff");
  assert.equal(confirmed[0]?.reshaped, true);
  // Beyond the calibrated line: a new picture, nothing suggested.
  const far = tiers([apple(1, "a1", { phash: bits(RESHAPED_BITS + 3) })], [cand("p1")]);
  assert.equal(far[0]?.tier, "full");
  assert.equal(far[0]?.pixelSuggested, undefined);
  assert.equal(reshapedPair(PLAY, TALL), true);
  assert.equal(reshapedPair(TALL, { width: 1284, height: 2778 }), false);
});

test("App Store tiers: an image planned as a text comparison never anchors another; Play plans are unchanged", () => {
  const main = apple(1, "a1", { ...PLAY, phash: bits(2) });
  const abroad = apple(1, "j1", {
    ...PLAY,
    gl: "jp",
    hl: "ja",
    country: "Japan",
    main: false,
    phash: bits(3),
  });
  const out = tierScope(
    [main, abroad],
    new Map([["g", [cand("a1", { analysed: false, store: "App Store" })]]]),
    new Map(),
    new Set(["p1"]),
    "the United States",
    new Set(),
    undefined,
    { candidates: new Map([["g", [cand("p1")]]]), same: new Set(), bits: RESHAPED_BITS },
  );
  assert.equal(out.filter((i) => i.imageId === "a1").length, 1, "never planned twice");
  assert.equal(out[0]?.tier, "layer-diff");
  assert.equal(out[1]?.basedOn, "p1");
  // Without App Store inputs the cross-store step never runs.
  const play = tierScope([{ ...main, platform: undefined }], new Map(), new Map(), new Set(), "x");
  assert.equal(play[0]?.tier, "full");
  assert.equal(play[0]?.reason, "not analysed before");
});

test("the approval counts per store add up", () => {
  const c = storeCounts([
    { tier: "full", basedOn: null },
    { tier: "identical", basedOn: "p", platform: "appstore", sameAs: "p" },
    { tier: "full", basedOn: null, platform: "appstore", pixelSuggested: "p" },
    { tier: "layer-diff", basedOn: "p", platform: "appstore" },
  ]);
  assert.deepEqual(c?.play, { full: 1, layerDiff: 0, identical: 0, samePicture: 0, toConfirm: 0 });
  assert.deepEqual(c?.appstore, {
    full: 1,
    layerDiff: 1,
    identical: 1,
    samePicture: 1,
    toConfirm: 1,
  });
  assert.equal(storeCounts([{ tier: "full", basedOn: null }]), null);
});

const deck = (o: Partial<AppleDeck> = {}): AppleDeck => ({
  schemaVersion: 1,
  platform: "appstore",
  appId: "com.x",
  gl: "th",
  hl: "th",
  appleLang: "th_th",
  trackId: 1,
  bundleId: "com.x",
  title: "X",
  sellerName: "S",
  source: "api",
  setVerified: false,
  status: "ok",
  media: [2, 1].map((position) => ({
    kind: "screenshot" as const,
    position,
    imageId: `i${position}`,
    appleAsset: `/a/${position}.png`,
    width: 1242,
    height: 2688,
    orientation: "portrait",
    mediaType: "iphone" as const,
    reuse: "new" as const,
  })),
  ipadCount: 3,
  fetchedAt: "2026-09-29T00:00:00.000Z",
  ...o,
});

test("an App Store deck reads like a Play deck through the App Store view of the project", () => {
  const m = appleManifest(deck());
  assert.equal(m.status, "ok");
  assert.deepEqual(m.deviceMix, { phone: 2, tablet: 0, unknown: 0 });
  assert.equal(m.slots[0]?.deviceClass, "phone");
  assert.equal(appleManifest(deck({ status: "not_sold" })).status, "unavailable");
  assert.equal(appleManifest(deck({ status: "identity_changed" })).status, "error");
  const dir = mkdtempSync(join(tmpdir(), "apple-decks-"));
  try {
    const decks = join(dir, APPLE_DECKS_DIR);
    // Thai is asked as th_th: the file name carries Apple's locale.
    writeJsonAtomic(join(decks, "com.x", "th-th_th.json"), deck());
    const read = readDeck(decks, { appId: "com.x", gl: "th", hl: "th" });
    assert.equal(read?.slots.length, 2);
    assert.equal(readDeck(decks, { appId: "com.x", gl: "jp", hl: "ja" }), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const loaded = { platform: undefined } as { platform?: "play" | "appstore" };
  assert.equal(forPlatform(loaded, undefined), loaded);
  assert.equal(forPlatform(loaded, "appstore").platform, "appstore");
});

test("the App Store view's images: App Store refs first, Play refs too, writes to the App Store", () => {
  const rec = (id: string, gl: string): ImageRecord =>
    ({ id, sources: [{ appId: "g", gl, hl: "en", position: 1 }] }) as unknown as ImageRecord;
  const fake = (list: ImageRecord[], saved: string[]): ImageDb =>
    ({
      size: list.length,
      all: () => list,
      get: (id: string) => list.find((r) => r.id === id),
      byGoogleId: () => undefined,
      ingest: async () => ({ record: list[0] as ImageRecord, isNew: false }),
      linkGoogleId: () => {},
      addSource: (id: string) => saved.push(id),
      save: () => saved.push("save"),
      abs: (p: string) => p,
    }) as ImageDb;
  const a: string[] = [];
  const p: string[] = [];
  const db = new BothStoresImageDb(
    fake([rec("x", "us"), rec("s", "us")], a),
    fake([rec("s", "jp"), rec("y", "jp")], p),
  );
  assert.deepEqual(
    db.all().map((r) => r.id),
    ["x", "s", "y"],
  );
  assert.equal(db.get("s")?.sources.length, 2);
  assert.equal(db.get("y")?.id, "y");
  db.addSource("x", { appId: "g", gl: "us", hl: "en", position: 2 });
  db.save();
  assert.deepEqual(a, ["x", "save"]);
  assert.deepEqual(p, []);
});
