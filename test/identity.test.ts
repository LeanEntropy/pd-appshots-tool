import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { classifyPair, describeImage } from "../src/store/identity.ts";
import { ImageDb } from "../src/store/imagedb.ts";

/** A test picture: gradient with a block whose position depends on `seed`. */
async function picture(seed: number, width = 180, height = 320, format: "png" | "jpeg" = "png") {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const inBlock = Math.abs(x / width - ((seed * 0.37) % 1)) < 0.2 && y / height < 0.5;
      raw[i] = inBlock ? 250 : (x * 255) / width;
      raw[i + 1] = inBlock ? 30 : (y * 255) / height;
      raw[i + 2] = ((x + y) * 255) / (width + height);
    }
  }
  const img = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === "png" ? img.png().toBuffer() : img.jpeg({ quality: 90 }).toBuffer();
}

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "ssr-db-"));
  return { dir, db: ImageDb.open(join(dir, "db.json"), join(dir, "orig"), join(dir, "thumb")) };
}

test("identical bytes are stored once, with every place they were seen", async () => {
  const { dir, db } = tempDb();
  const buf = await picture(1);
  const a = await db.ingest(buf, { appId: "x", gl: "us", hl: "en", position: 1 }, "gid-us");
  const b = await db.ingest(buf, { appId: "x", gl: "jp", hl: "ja", position: 3 }, "gid-jp");
  assert.equal(a.isNew, true);
  assert.equal(b.isNew, false);
  assert.equal(db.size, 1);
  assert.equal(a.record.id, b.record.id);
  assert.equal(db.get(a.record.id)?.sources.length, 2);
  assert.equal(db.byGoogleId("gid-jp")?.id, a.record.id);
  db.save();
  const reopened = ImageDb.open(join(dir, "db.json"), join(dir, "orig"), join(dir, "thumb"));
  assert.equal(reopened.size, 1);
  assert.equal(reopened.byGoogleId("gid-us")?.id, a.record.id);
});

test("concurrent ingest of the same image keeps one record and both Google ids", async () => {
  const { db } = tempDb();
  const buf = await picture(2);
  await Promise.all([db.ingest(buf, undefined, "g1"), db.ingest(buf, undefined, "g2")]);
  assert.equal(db.size, 1);
  assert.deepEqual(db.all()[0]?.googleIds.sort(), ["g1", "g2"]);
});

test("identity: identical, near-identical (resized and re-encoded), different", async () => {
  const a = await describeImage(await picture(1));
  const aSmall = await describeImage(await picture(1, 90, 160, "jpeg"));
  const b = await describeImage(await picture(2));
  assert.equal(classifyPair(a, a), "identical");
  assert.equal(classifyPair(a, aSmall), "near-identical");
  assert.equal(classifyPair(a, b), "different");
  assert.equal(a.width, 180);
  assert.equal(a.phash.length, 64);
});
