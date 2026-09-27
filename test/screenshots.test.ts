import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baseUrl,
  deckDeviceClasses,
  dedupScreenshots,
  fullResUrl,
  googleImageId,
  guessDeviceClass,
} from "../src/play/screenshots.ts";

const U = "https://play-lh.googleusercontent.com/";

test("repeated screenshot entries collapse to one per image, in store order", () => {
  const raw = [
    `${U}a=w526`,
    `${U}b=w526`,
    `${U}c`,
    `${U}a=w1052`,
    `${U}b`,
    `${U}c=h900`,
    `${U}a`,
    `${U}b`,
    `${U}c`,
  ];
  assert.deepEqual(dedupScreenshots(raw), [`${U}a`, `${U}b`, `${U}c`]);
});

test("full resolution URL uses =s0 and replaces any size suffix", () => {
  assert.equal(fullResUrl(`${U}abc=w526-h296`), `${U}abc=s0`);
  assert.equal(fullResUrl(`${U}abc`), `${U}abc=s0`);
  assert.equal(baseUrl(`${U}abc=s0`), `${U}abc`);
});

test("Google image id is the last path segment without the size suffix", () => {
  assert.equal(googleImageId(`${U}xyz123=w100`), "xyz123");
});

test("device class guess by aspect ratio", () => {
  assert.equal(guessDeviceClass(1242, 2208).deviceClass, "phone");
  assert.equal(guessDeviceClass(2208, 1242).orientation, "landscape");
  assert.equal(guessDeviceClass(1536, 2048).deviceClass, "tablet");
  assert.equal(guessDeviceClass(1000, 1650).deviceClass, "unknown");
  assert.equal(guessDeviceClass(0, 100).confidence, 0);
});

test("device classes by deck: the leading set is the phone deck, appended tablet sets are tablet", () => {
  const sz = (w: number, h: number, n: number) =>
    Array.from({ length: n }, () => ({ width: w, height: h }));
  // Landscape phone marketing images, then an appended iPad set (Sword x Staff).
  assert.deepEqual(deckDeviceClasses([...sz(2688, 1242, 2), ...sz(2732, 2048, 2)]), [
    "phone",
    "phone",
    "tablet",
    "tablet",
  ]);
  // Portrait phone set followed by landscape phone marketing art: all phone.
  assert.deepEqual(deckDeviceClasses([...sz(1080, 1920, 2), ...sz(1920, 1080, 1)]), [
    "phone",
    "phone",
    "phone",
  ]);
  // A deck with only tablet-shaped images: that is what phone users see.
  assert.deepEqual(deckDeviceClasses(sz(2732, 2048, 3)), ["phone", "phone", "phone"]);
  // 16:10 lead set, then the same pictures at other tablet resolutions (CookieRun: Kingdom).
  assert.deepEqual(deckDeviceClasses([...sz(1280, 800, 2), ...sz(1920, 1200, 2)]), [
    "phone",
    "phone",
    "tablet",
    "tablet",
  ]);
  // A single 3:2 landscape marketing image after portrait phone images is not a tablet set.
  assert.deepEqual(deckDeviceClasses([...sz(1080, 1920, 3), ...sz(1200, 800, 1)]), [
    "phone",
    "phone",
    "phone",
    "phone",
  ]);
  // Portrait iPad set appended after a portrait phone set.
  assert.deepEqual(deckDeviceClasses([...sz(1242, 2208, 1), ...sz(2048, 2732, 1)]), [
    "phone",
    "tablet",
  ]);
});
