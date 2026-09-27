import assert from "node:assert/strict";
import { test } from "node:test";
import type { MarketOverview } from "../src/overview/overview.ts";
import { asiaVsUs, overviewMarkdown, writeOverview } from "../src/overview/overview-report.ts";
import { getOverview } from "../src/server/api.ts";
import { tempProject } from "./helpers/project.ts";

const m = (gl: string, images: number, landscape: number): MarketOverview => ({
  gl,
  hl: "x",
  label: gl.toUpperCase(),
  games: 1,
  images,
  orientation: [
    { key: "landscape", n: Math.round(images * landscape), share: landscape },
    { key: "portrait", n: images - Math.round(images * landscape), share: 1 - landscape },
  ],
  ratios: [],
  deckLength: { min: 5, median: 6, max: 7 },
  reusedFromUs: gl === "us" ? null : 0.5,
  colours: [],
  tabletImages: 0,
});

test("Asia vs US landscape share: image-weighted, US and the Philippines left out of Asia", () => {
  const r = asiaVsUs([m("us", 10, 0.2), m("jp", 10, 0.8), m("kr", 30, 0.4), m("ph", 50, 1)]);
  assert.deepEqual(r, { us: 0.2, asia: 0.5 });
});

test("the free overview is built from the downloaded data only and served to the page", async () => {
  const loaded = await tempProject({ "Archero 2": { phone: 2, tablet: 1 } });
  const { overview, file } = await writeOverview(loaded);
  const us = overview.namedMarkets.find((x) => x.gl === "us");
  assert.equal(
    us?.images,
    5,
    "3 ours + 2 Archero phone images; the appended tablet image is not counted",
  );
  assert.equal(us?.tabletImages, 1);
  assert.equal(us?.orientation[0]?.key, "portrait");
  assert.ok((us?.colours.length ?? 0) > 0, "measured colours");
  const md = overviewMarkdown(overview);
  assert.match(md, /US English only/);
  const body = getOverview(loaded).body as { overview: { file: string; html: string } };
  assert.equal(body.overview.file, file);
  assert.match(body.overview.html, /Store overview \(free, no AI\)/);
});
