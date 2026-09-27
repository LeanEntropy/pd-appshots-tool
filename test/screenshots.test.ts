import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baseUrl,
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
