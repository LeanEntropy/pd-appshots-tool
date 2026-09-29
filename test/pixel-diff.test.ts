import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { LocalFsStorage } from "../src/storage/index.ts";
import {
  type GreyReader,
  type PixelRegions,
  pixelAsks,
  pixelCandidate,
  pixelCheck,
  pixelCheckFiles,
  pixelKey,
  pixelVerdict,
} from "../src/store/pixel-diff.ts";

const W = 180;
const H = 320;
/** The anchor's boxes, as in the fake readings: a band at the top with one headline on it. */
const REGIONS: PixelRegions = {
  texts: [{ x: 5, y: 2, w: 90, h: 10 }],
  masks: [{ x: 0, y: 0, w: 100, h: 15 }],
  elements: [{ x: 70, y: 16, w: 25, h: 12 }],
};
const T = { sameMaxOutside: 0.005, differentMinOutside: 0.05 };

/** A store-like picture: a band at the top, a textured in-game screen below. */
function scene(): Buffer {
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const band = y < H * 0.15;
      raw[i] = band ? 240 : (x * 3 + y) % 200;
      raw[i + 1] = band ? 200 : (x + y * 2) % 180;
      raw[i + 2] = band ? 20 : 60 + ((x * y) % 90);
    }
  return raw;
}

/** Paints a rectangle (percent of the picture) in one colour. */
function paint(raw: Buffer, box: { x: number; y: number; w: number; h: number }, v: number[]) {
  const out = Buffer.from(raw);
  const x0 = Math.round((box.x / 100) * W);
  const y0 = Math.round((box.y / 100) * H);
  const x1 = Math.round(((box.x + box.w) / 100) * W);
  const y1 = Math.round(((box.y + box.h) / 100) * H);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) for (let c = 0; c < 3; c++) out[(y * W + x) * 3 + c] = v[c] ?? 0;
  return out;
}

const png = (raw: Buffer, w = W, h = H) =>
  sharp(raw, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();

/** Reads "files" from memory, exactly as the real reader does from disk. */
function memory(files: Record<string, Buffer>): GreyReader {
  return (file, w, h) =>
    sharp(files[file]).resize(w, h, { fit: "fill" }).greyscale().raw().toBuffer();
}

async function check(image: Buffer, anchor: Buffer, regions = REGIONS) {
  const read = memory({ a: await png(image), b: await png(anchor) });
  return pixelCheckFiles(
    { imageId: "i", anchorId: "a", imageFile: "a", anchorFile: "b" },
    { width: W, height: H },
    regions,
    read,
  );
}

test("pixel check: identical pictures change nothing", async () => {
  const r = await check(scene(), scene());
  assert.equal(r.changed, 0);
  assert.equal(r.inside, 0);
  assert.equal(r.outside, 0);
  assert.deepEqual(r.areas, []);
  assert.equal(pixelVerdict(r, T), "same-new-text");
});

test("pixel check: a new text on the band changes pixels inside only", async () => {
  const jp = paint(scene(), { x: 10, y: 4, w: 60, h: 6 }, [255, 255, 255]);
  const r = await check(jp, scene());
  assert.ok(r.inside > 0.01, String(r.inside));
  assert.equal(r.outside, 0);
  assert.equal(r.bandOnly, 0);
  assert.equal(pixelVerdict(r, T), "same-new-text");
  const a = r.areas[0];
  assert.ok(a && a.y < 15 && a.x < 15 && a.x + a.w > 60, JSON.stringify(r.areas));
});

test("pixel check: a changed capture is outside, with its area", async () => {
  const other = paint(scene(), { x: 30, y: 50, w: 40, h: 30 }, [0, 0, 0]);
  const r = await check(other, scene());
  assert.equal(r.inside, 0);
  assert.ok(r.outside > 0.05, String(r.outside));
  assert.equal(pixelVerdict(r, T), "different");
  const a = r.areas[0];
  assert.ok(a && Math.abs(a.x - 30) < 5 && Math.abs(a.y - 50) < 5, JSON.stringify(a));
  // In-game text translated too: a few percent outside is the same screen, asked.
  const ui = paint(scene(), { x: 20, y: 60, w: 30, h: 5 }, [0, 0, 0]);
  const u = await check(ui, scene());
  assert.equal(pixelVerdict(u, T), "same-screen", String(u.outside));
});

test("pixel check: a badge added on the band counts inside (as band change), not outside", async () => {
  const badge = paint(scene(), { x: 1, y: 12.5, w: 6, h: 2.5 }, [255, 0, 0]);
  const r = await check(badge, scene());
  assert.equal(r.outside, 0);
  assert.ok(r.bandOnly > 0.0002, String(r.bandOnly));
  assert.equal(pixelVerdict(r, T), "same-new-text");
});

test("pixel check: a tiny change outside stays under the same-picture line", async () => {
  const tag = paint(scene(), { x: 80, y: 90, w: 3, h: 1.5 }, [255, 255, 255]);
  const r = await check(tag, scene());
  assert.ok(r.outside > 0 && r.outside <= T.sameMaxOutside, String(r.outside));
  assert.equal(pixelVerdict(r, T), "same-new-text");
});

test("pixel check: another size of the same picture is compared on the same grid", async () => {
  const big = await sharp(await png(scene()))
    .resize(W * 2, H * 2)
    .png()
    .toBuffer();
  const read = memory({ a: big, b: await png(scene()) });
  const r = await pixelCheckFiles(
    { imageId: "i", anchorId: "a", imageFile: "a", anchorFile: "b" },
    { width: W * 2, height: H * 2 },
    REGIONS,
    read,
  );
  assert.ok(r.changed < 0.01, String(r.changed));
  assert.equal(pixelVerdict(r, T), "same-new-text");
  const f = (phash: string, width: number, height: number) => ({ phash, width, height });
  const p0 = "0".repeat(64);
  assert.equal(pixelCandidate(f(p0, 1080, 1920), f(p0, 540, 960)), true);
  assert.equal(pixelCandidate(f(p0, 1080, 1920), f(p0, 1080, 2340)), false, "other shape");
  assert.equal(
    pixelCandidate(f(p0, 1080, 1920), f(`${"1".repeat(14)}${"0".repeat(50)}`, 1080, 1920)),
    true,
  );
  assert.equal(
    pixelCandidate(f(p0, 1080, 1920), f(`${"1".repeat(15)}${"0".repeat(49)}`, 1080, 1920)),
    false,
  );
});

test("pixel check: thresholds and who is asked", () => {
  assert.equal(pixelVerdict({ outside: 0.005 }, T), "same-new-text");
  assert.equal(pixelVerdict({ outside: 0.0051 }, T), "same-screen");
  assert.equal(pixelVerdict({ outside: 0.05 }, T), "same-screen");
  assert.equal(pixelVerdict({ outside: 0.0501 }, T), "different");
  const strict = { sameMaxOutside: 0.001, differentMinOutside: 0.02 };
  assert.equal(pixelVerdict({ outside: 0.003 }, strict), "same-screen");
  assert.equal(pixelVerdict({ outside: 0.03 }, strict), "different");
  assert.equal(pixelAsks("same-new-text", 12), false);
  assert.equal(pixelAsks("same-screen", 12), true);
  assert.equal(pixelAsks("different", 10), true);
  assert.equal(pixelAsks("different", 11), false);
});

test("pixel check: cached per pair and per anchor boxes, versioned", async () => {
  const storage = new LocalFsStorage(mkdtempSync(join(tmpdir(), "pixel-")));
  const paths = { projectId: "p", library: null };
  const key = pixelKey(paths, "i", "a", REGIONS);
  assert.notEqual(key, pixelKey(paths, "i", "a", { ...REGIONS, texts: [] }));
  let reads = 0;
  const files = memory({ a: await png(scene()), b: await png(scene()) });
  const read: GreyReader = (f, w, h) => {
    reads++;
    return files(f, w, h);
  };
  const pair = { imageId: "i", anchorId: "a", imageFile: "a", anchorFile: "b" };
  const r1 = await pixelCheck(storage, key, pair, { width: W, height: H }, REGIONS, read);
  const r2 = await pixelCheck(storage, key, pair, { width: W, height: H }, REGIONS, read);
  assert.equal(reads, 2, "the second check is read from the cache");
  assert.deepEqual(r1, r2);
  assert.equal(r1.version, "pixel-check.v1");
});
