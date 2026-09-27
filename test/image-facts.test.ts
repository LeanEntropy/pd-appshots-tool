import assert from "node:assert/strict";
import { test } from "node:test";
import { batchDataHash } from "../src/analysis/entries.ts";
import {
  type ImageFacts,
  imageFacts,
  orientationOf,
  ratioLabel,
} from "../src/analysis/image-facts.ts";
import { captureLines, imageLine, pendingMessage } from "../src/analysis/info-text.ts";
import { type AnalysisRecord, infoViews, writeRecord } from "../src/analysis/records.ts";
import { compositionProblems } from "../src/analysis/schema.ts";
import { projectPaths } from "../src/config/load.ts";
import { renderGalleryHtml } from "../src/steps/deck-view.ts";
import { ImageDb } from "../src/store/imagedb.ts";
import { reading } from "./helpers/fake-provider.ts";
import { tempProject } from "./helpers/project.ts";

test("orientation and aspect ratio come from the pixel size, never 'not applicable'", () => {
  assert.equal(orientationOf(1242, 2208), "portrait");
  assert.equal(orientationOf(2208, 1242), "landscape");
  assert.equal(orientationOf(1000, 1010), "square");
  assert.equal(ratioLabel(1242, 2208), "9:16");
  assert.equal(ratioLabel(1080, 2340), "9:19.5");
  assert.equal(ratioLabel(2048, 2732), "3:4");
});

test("image facts are computed from the file (size, orientation, colorthief palette) and cached", async () => {
  const loaded = await tempProject({});
  const paths = projectPaths(loaded);
  const db = ImageDb.open(paths.imageDb, paths.imagesOrig, paths.imagesThumb);
  const id = (db.all()[0] as { id: string }).id;
  const f = await imageFacts(paths, db, id);
  assert.equal(f?.orientation, "portrait");
  assert.equal(f?.ratio, "9:16");
  assert.ok((f?.dominantColours.length ?? 0) > 0);
  assert.ok(f?.dominantColours.every((c) => /^#[0-9a-f]{6}$/.test(c.hex)));
  assert.deepEqual(await imageFacts(paths, db, id), f);
});

const facts = { orientation: "portrait", width: 1242, height: 2208, ratio: "9:16" } as ImageFacts;

function pureArt(type: string) {
  const r = reading("img1", type, "ARCHERO 2");
  r.screenshot.composition = "pure_art";
  r.screenshot.captures = [];
  r.screenshot.captureAreaPercent = 0;
  return r;
}

test("the capture lines only say something meaningful", () => {
  assert.equal(imageLine(facts), "Portrait, 1242 × 2208 (9:16)");
  assert.deepEqual(captureLines(pureArt("title_image"), facts), [], "no noise for a title image");
  const noCap = pureArt("gameplay");
  noCap.screenshot.composition = "capture_in_marketing_art";
  assert.deepEqual(captureLines(noCap, facts), ["none"]);
  assert.deepEqual(captureLines(reading("img1", "gameplay", ""), facts), [
    "Gameplay, fills the image, 85% of the image",
  ]);
  // A landscape marketing image holding two portrait screenshots.
  const land: ImageFacts = { ...facts, orientation: "landscape" };
  const two = reading("img1", "gameplay", "");
  const cap = two.screenshot.captures[0] as (typeof two.screenshot.captures)[number];
  two.screenshot.composition = "multiple_captures";
  two.screenshot.captures = [
    { ...cap, subtype: "battle", framing: "device_frame", areaPercent: 30 },
    { ...cap, screenType: "metagame", framing: "rounded_card", areaPercent: 25 },
  ];
  assert.deepEqual(captureLines(two, land), [
    "Gameplay / Battle, portrait (the image is landscape), in a phone frame, 30% of the image",
    "Metagame, portrait (the image is landscape), on a rounded card, 25% of the image",
  ]);
});

test("composition must match the captures (schema v3)", () => {
  const t = {
    id: "t",
    version: "1",
    definitions: {},
    subtypeLabels: {},
    screenTypes: [
      { id: "gameplay", label: "Gameplay", subtypes: ["battle"] },
      { id: "title_image", label: "Title image", subtypes: [] },
    ],
  };
  assert.deepEqual(compositionProblems(t, reading("img1", "gameplay", "")), []);
  assert.deepEqual(compositionProblems(t, pureArt("title_image")), []);
  const bad = reading("img1", "gameplay", "");
  bad.screenshot.composition = "multiple_captures";
  assert.match(compositionProblems(t, bad)[0] ?? "", /does not match 1 captures/);
  assert.match(compositionProblems(t, pureArt("gameplay"))[0] ?? "", /pure art must be/);
  const area = reading("img1", "gameplay", "");
  area.screenshot.captureAreaPercent = 20;
  assert.match(compositionProblems(t, area)[0] ?? "", /sum of the captures/);
});

test("failed records show a plain pending message, the error only as details", async () => {
  const loaded = await tempProject({});
  const paths = projectPaths(loaded);
  const db = ImageDb.open(paths.imageDb, paths.imagesOrig, paths.imagesThumb);
  const id = (db.all()[0] as { id: string }).id;
  const rec: AnalysisRecord = {
    imageId: id,
    appId: loaded.config.ourApp.id,
    gl: "us",
    hl: "en",
    position: 1,
    status: "failed",
    final: null,
    producer: null,
    reviewer: null,
    adjudication: null,
    differences: [],
    problems: [
      "Error: --json-schema is not valid JSON: JSON Parse error: Invalid escape character #",
    ],
    runId: "r",
    updatedAt: "",
  };
  assert.equal(
    pendingMessage(rec),
    "Not analysed yet. An earlier attempt failed (a tool bug, since fixed). It will be analysed in the next run.",
  );
  writeRecord(paths, rec);
  const v = infoViews(paths)[id];
  assert.ok(v?.pending?.startsWith("Not analysed yet"));
  assert.equal(v?.final, null);
  const html = renderGalleryHtml(loaded, "t");
  const script = html.split("<script>")[1]?.split("</script>")[0] ?? "";
  assert.doesNotThrow(() => new Function(script), "the page script parses");
  assert.match(script, /class="info pending"/);
});

test("a deterministic refresh (image facts or mapping) invalidates the patterns and recommendations", () => {
  const plan = {
    games: [{ appId: "a", name: "A", positions: [1] }],
    items: [{ appId: "a", position: 1, imageId: "x" }],
    versions: { prompts: {}, schema: "s", taxonomy: "t" },
  } as never;
  const rec = {
    ...({} as AnalysisRecord),
    imageId: "x",
    status: "ok",
    schema: "analysis-schema.v2",
    final: reading("img1", "gameplay", ""),
    updatedAt: "u",
    mapping: "m1",
  } as AnalysisRecord;
  const h1 = batchDataHash(plan, new Map([["x", rec]]));
  const h2 = batchDataHash(plan, new Map([["x", { ...rec, mapping: "m2" }]]));
  assert.notEqual(h1, h2);
});
