import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { appleRefsKey, platformOf, readAppStore, samePictureKey } from "../src/appstore/data.ts";
import { comparePictures, type RawImage, rawOf, twinCandidates } from "../src/appstore/dedup.ts";
import { AppleImages } from "../src/appstore/ingest.ts";
import { useOf } from "../src/library/image-uses.ts";
import { LibraryImageDb } from "../src/library/imagedb.ts";
import { refsKey } from "../src/library/layout.ts";
import { readRefs } from "../src/library/refs.ts";
import { projectKey, workspaceStorage } from "../src/storage/index.ts";

const W = 60;
const H = 130;

function raw(seed: number): Buffer {
  const b = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      // Smooth content, like a real capture: JPEG noise stays small.
      b[i] = Math.round(128 + 100 * Math.sin(x / 9 + seed));
      b[i + 1] = Math.round(128 + 100 * Math.cos(y / 13 + seed * 2));
      b[i + 2] = Math.round(128 + 90 * Math.sin((x + y) / 17 + seed * 3));
    }
  return b;
}
const png = (b: Buffer) =>
  sharp(b, { raw: { width: W, height: H, channels: 3 } })
    .png()
    .toBuffer();
const jpeg = (b: Buffer) =>
  sharp(b, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 98 })
    .toBuffer();
const img = (b: Buffer): RawImage => ({ width: W, height: H, data: b });

test("same picture: compression noise passes; a changed word, a new size or a new picture fails", async () => {
  const a = raw(1);
  const noisy = Buffer.from(a);
  for (let i = 0; i < noisy.length; i += 7) noisy[i] = Math.min(255, (noisy[i] ?? 0) + 10);
  assert.equal(comparePictures(img(a), img(noisy)).same, true);
  // A "word" changed: one small block of strongly changed pixels.
  const word = Buffer.from(a);
  for (let y = 40; y < 44; y++)
    for (let x = 10; x < 14; x++) word[(y * W + x) * 3] = 255 - (word[(y * W + x) * 3] ?? 0);
  const w = comparePictures(img(a), img(word));
  assert.equal(w.same, false);
  assert.match(w.reason, /changed pixels/);
  assert.equal(comparePictures(img(a), { width: W + 1, height: H, data: a }).same, false);
  assert.equal(comparePictures(img(a), img(raw(9))).same, false);
  // PNG against a high-quality JPEG of the same pixels (Apple PNG vs Play JPEG) is the same picture.
  assert.equal(comparePictures(await rawOf(await png(a)), await rawOf(await jpeg(a))).same, true);
});

test("twin candidates: the same size and close fingerprints only", () => {
  const base = { id: "a", phash: "0".repeat(64), width: 10, height: 20 };
  const pool = [
    { ...base, id: "near", phash: `${"1".repeat(5)}${"0".repeat(59)}` },
    { ...base, id: "far", phash: `${"1".repeat(30)}${"0".repeat(34)}` },
    { ...base, id: "scaled", width: 20, height: 40 },
  ];
  assert.deepEqual(
    twinCandidates(base, pool).map((p) => p.id),
    ["near"],
  );
});

test("data model: a missing platform is Google Play; an old project has App Store off", () => {
  assert.equal(platformOf(undefined), "play");
  assert.equal(platformOf("appstore"), "appstore");
  assert.equal(platformOf("apple"), "appstore");
  assert.equal(useOf("p", { appId: "a", gl: "us", hl: "en", position: 1 })?.platform, "play");
  assert.equal(
    useOf("p", { appId: "a", gl: "us", hl: "en_us", position: 1, platform: "appstore" })?.platform,
    "apple",
  );
  const storage = workspaceStorage(mkdtempSync(join(tmpdir(), "ssr-as-")));
  const a = readAppStore(storage, { projectId: "p" });
  assert.equal(a.enabled, false);
  assert.deepEqual(a.pairs, []);
});

async function workspace() {
  const dir = mkdtempSync(join(tmpdir(), "ssr-asi-"));
  const storage = workspaceStorage(dir);
  const ctx = { projectId: "p" };
  // A Google Play deck of the same game holding the JPEG of picture 1.
  const play = LibraryImageDb.open(dir, refsKey(ctx), "p");
  const { record } = await play.ingest(await jpeg(raw(1)), {
    appId: "g",
    gl: "us",
    hl: "en",
    position: 1,
  });
  play.save();
  storage.putJson(projectKey(ctx, "runs", "2026-09-29T00-00-00-000Z-setup", "manifest.json"), {
    decks: [
      {
        appId: "g",
        gl: "us",
        hl: "en",
        slots: [{ position: 1, imageId: record.id, width: W, height: H, deviceClass: "phone" }],
      },
    ],
  });
  return { dir, storage, ctx, playId: record.id };
}

test("App Store ingest: a known asset path is not downloaded again; Play twins and identical files are marked", async () => {
  const { dir, storage, ctx, playId } = await workspace();
  const bytes = new Map<string, Buffer>([
    ["/i/a/A.png", await png(raw(1))],
    ["/i/b/B.png", await png(raw(2))],
    ["/i/c/C.png", await png(raw(2))],
  ]);
  const downloads: string[] = [];
  const images = new AppleImages(dir, storage, ctx, async (url) => {
    downloads.push(url);
    const p = new URL(url).pathname.replace(/\/[^/]*$/, "");
    return bytes.get(p) as Buffer;
  });
  const src = (gl: string, position: number) => ({
    appId: "g",
    gl,
    hl: "en_us",
    position,
    platform: "appstore" as const,
  });
  const twin = await images.get(
    "https://x.mzstatic.com/i/a/A.png/300x600bb.jpg",
    "g",
    src("us", 1),
  );
  assert.equal(twin.reuse, "same-picture");
  assert.equal(twin.sameAs, playId);
  assert.ok(storage.exists(samePictureKey(twin.sha)));
  const fresh = await images.get(
    "https://x.mzstatic.com/i/b/B.png/300x600bb.jpg",
    "g",
    src("us", 2),
  );
  assert.equal(fresh.reuse, "new");
  // Another country, same asset: no download, identical file.
  const again = await images.get(
    "https://x.mzstatic.com/i/b/B.png/300x600bb.jpg",
    "g",
    src("ph", 2),
  );
  assert.equal(again.reuse, "same-file");
  assert.equal(again.downloaded, 0);
  // Another asset path with the same bytes: downloaded, but identical.
  const copy = await images.get(
    "https://x.mzstatic.com/i/c/C.png/300x600bb.jpg",
    "g",
    src("jp", 2),
  );
  assert.equal(copy.reuse, "same-file");
  assert.equal(copy.sha, fresh.sha);
  assert.equal(downloads.length, 3);
  assert.ok(downloads.every((u) => u.endsWith("/9999x9999bb.png")));
  images.save();
  // Apple references stay out of the Play refs; each source carries its platform.
  const appleRefs = readRefs(storage, appleRefsKey(ctx), "p");
  assert.equal(appleRefs.images[fresh.sha]?.sources.length, 3);
  assert.ok(appleRefs.images[fresh.sha]?.sources.every((s) => s.platform === "appstore"));
  const playRefs = readRefs(storage, refsKey(ctx), "p");
  assert.deepEqual(Object.keys(playRefs.images), [playId]);
});

test("the same position on both stores is two sources, never one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ssr-asp-"));
  const db = LibraryImageDb.open(dir, refsKey({ projectId: "p" }), "p");
  const { record } = await db.ingest(await png(raw(3)), {
    appId: "g",
    gl: "us",
    hl: "en",
    position: 1,
  });
  db.addSource(record.id, { appId: "g", gl: "us", hl: "en", position: 1, platform: "appstore" });
  db.addSource(record.id, { appId: "g", gl: "us", hl: "en", position: 1 });
  assert.equal(db.get(record.id)?.sources.length, 2);
});
