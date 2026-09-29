import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { englishKey, readEnglish, saveEnglish } from "../src/analysis/english-store.ts";
import { appIconKey, appIconSrc } from "../src/library/app-icon.ts";
import { LIB } from "../src/library/layout.ts";
import { collectProject } from "../src/share/collect.ts";
import { importPackage } from "../src/share/import.ts";
import { checkFile } from "../src/share/validate.ts";
import { libraryKey } from "../src/storage/index.ts";
import { sha256 } from "../src/util/hash.ts";
import { pack, receiver, sender, upload } from "./helpers/share.ts";

// A package carries the icons of every game of the project, the saved English of its texts, its
// layouts and its same-screen and pixel checks; the import puts them back.
const OURS = "com.pockethaven.roguelegend";
const RIVAL = "com.habby.capybara";
const CHART = "com.chart.onlyhere";

test("share: icons of all games, saved English, layouts and picture checks travel", async () => {
  const s = await sender();
  const refsKey = `projects/${s.id}/refs.json`;
  const refs = s.storage.getJson(refsKey) as {
    images: Record<
      string,
      { sources: { appId: string; gl: string; hl: string; position: number }[] }
    >;
  };
  const shas = Object.keys(refs.images);
  const [a, b] = [shas[0] as string, shas[1] as string];
  // A chart game seen only in the refs (not ours, not a named competitor).
  refs.images[a]?.sources.push({ appId: CHART, gl: "us", hl: "en", position: 9 });
  s.storage.putJson(refsKey, refs);
  const icons: Record<string, string> = {};
  for (const [i, appId] of [OURS, RIVAL, CHART].entries()) {
    const webp = await sharp({
      create: { width: 128, height: 128, channels: 3, background: { r: 40 * i, g: 90, b: 20 } },
    })
      .webp()
      .toBuffer();
    const sha = sha256(webp);
    s.storage.putBlob(appIconKey(sha), webp, sha);
    const url = `https://play-lh.googleusercontent.com/${appId}`;
    s.storage.putJson(libraryKey("icons", "apps", `${appId}.json`), {
      url,
      sha,
      from: url,
      checkedAt: new Date().toISOString(),
    });
    icons[appId] = `/app-icons/${sha}.webp`;
  }
  // The English step's saved answer for a text on one of the pictures, and one for nothing here.
  const rec = [...s.storage.list(LIB.analysisDir(a))]
    .map(
      (k) =>
        s.storage.getJson(k) as {
          final?: { marketingLayer?: { texts?: { text: string; language: string }[] } };
        },
    )
    .find((r) => r?.final?.marketingLayer?.texts?.length);
  const t = rec?.final?.marketingLayer?.texts?.[0];
  assert.ok(t, "the fixture has a picture with text");
  const at = new Date().toISOString();
  saveEnglish(s.storage, {
    text: t.text,
    language: t.language,
    english: "IN ENGLISH",
    model: "m",
    at,
  });
  saveEnglish(s.storage, { text: "elsewhere", language: "ja", english: "no", model: "m", at });
  // A layout, a same-screen check and a pixel check of the project's pictures.
  const [x, y] = a < b ? [a, b] : [b, a];
  const extras = [
    LIB.layout(a, "k1"),
    libraryKey("same-screen", x, `${y}.v1.json`),
    libraryKey("pixel-check", a, `${b}-r1.json`),
  ];
  for (const k of extras) s.storage.putJson(k, { saved: k });

  const names = new Set((await collectProject(s.storage, s.id)).files.map((f) => f.key));
  for (const appId of [OURS, RIVAL, CHART]) {
    assert.ok(names.has(libraryKey("icons", "apps", `${appId}.json`)), `${appId} icon index`);
    const sha = icons[appId]?.slice("/app-icons/".length, -".webp".length) ?? "";
    assert.ok(names.has(appIconKey(sha)), `${appId} icon`);
  }
  assert.ok(names.has(englishKey(t.text, t.language)), "the saved English");
  assert.ok(!names.has(englishKey("elsewhere", "ja")), "only this project's texts");
  for (const k of extras) assert.ok(names.has(k), k);

  const r = receiver();
  // This computer read the game's store page once (URL only, no stored copy yet).
  r.storage.putJson(libraryKey("icons", "apps", `${OURS}.json`), {
    url: "https://play-lh.googleusercontent.com/newer",
  });
  await importPackage(r.storage, upload(r.storage, await pack(s, "light")), "new");
  for (const appId of [OURS, RIVAL, CHART])
    assert.equal(appIconSrc(r.storage, appId), icons[appId], `${appId} shows without a download`);
  const ours = r.storage.getJson(libraryKey("icons", "apps", `${OURS}.json`)) as { url: string };
  assert.equal(
    ours.url,
    "https://play-lh.googleusercontent.com/newer",
    "the local store read stays",
  );
  assert.equal(readEnglish(r.storage, t.text, t.language), "IN ENGLISH");
  for (const k of extras) assert.deepEqual(r.storage.getJson(k), { saved: k });
});

test("share: a saved English file must sit under its own text's name", () => {
  const good = {
    version: "english.v1",
    text: "Hi",
    language: "ja",
    english: "Hi",
    model: "m",
    at: "x",
  };
  const bytes = (v: unknown) => Buffer.from(JSON.stringify(v));
  assert.equal(checkFile(englishKey("Hi", "ja"), bytes(good), new Set()), null);
  assert.match(
    checkFile(englishKey("Other", "ja"), bytes(good), new Set()) ?? "",
    /not a valid saved English/,
  );
});
