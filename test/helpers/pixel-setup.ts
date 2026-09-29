import assert from "node:assert/strict";
import sharp from "sharp";
import { type LoadedConfig, projectPaths } from "../../src/config/load.ts";
import { openImageDb } from "../../src/store/imagedb.ts";
import { readDeck } from "../../src/store/manifest.ts";
import { addDeck, analyse, builderProject, idOf, usBytes } from "./builder.ts";

/** A 64-bit fingerprint: anchor p owns bits 16p..16p+15; `flip` changes the first bits. */
export const hash = (p: number, flip = 0) =>
  Array.from({ length: 64 }, (_, i) => {
    const on = i >= 16 * p && i < 16 * p + 16;
    return (i < flip ? !on : on) ? "1" : "0";
  }).join("");

export async function paint(
  buf: Buffer,
  box: { x: number; y: number; w: number; h: number },
  v: number,
) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const x0 = Math.round((box.x / 100) * info.width);
  const y0 = Math.round((box.y / 100) * info.height);
  for (let y = y0; y < y0 + Math.round((box.h / 100) * info.height); y++)
    for (let x = x0; x < x0 + Math.round((box.w / 100) * info.width); x++)
      for (let c = 0; c < info.channels; c++) data[(y * info.width + x) * info.channels + c] = v;
  return sharp(data, { raw: info }).png().toBuffer();
}

export const JP = { gl: "jp", hl: "ja", label: "Japan" };

/**
 * Capybara Go analysed in the US; in Japan: #1 new text on the band, 5 bits away (a doubtful
 * text comparison today); #2 new text on the band, 9 bits away (a full analysis today); #3 a
 * different in-game screen, 3 bits away (a text comparison today).
 */
export async function setup() {
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

export const withMode = (l: LoadedConfig, mode: "off" | "suggest" | "automatic"): LoadedConfig => ({
  ...l,
  config: {
    ...l.config,
    options: { ...l.config.options, pixelCheck: { ...l.config.options.pixelCheck, mode } },
  },
});
