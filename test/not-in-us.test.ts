import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { buildReportData } from "../src/analysis/report-data.ts";
import { reportInputs } from "../src/analysis/report-inputs.ts";
import { reportMarkdown } from "../src/analysis/report-md.ts";
import { projectPaths } from "../src/config/load.ts";
import { fitFor, notInCoreMarket } from "../src/core/selection.ts";
import { deckKey } from "../src/core/targets.ts";
import { PlayProblem } from "../src/play/lookup.ts";
import { renderGalleryHtml, runDeckView } from "../src/steps/deck-view.ts";
import type { DownloadPlan } from "../src/steps/preview.ts";
import { previewMarkdown, notInCoreMarket as previewNotes } from "../src/steps/preview-report.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { openImageDb } from "../src/store/imagedb.ts";
import { type DeckManifest, writeDeck } from "../src/store/manifest.ts";
import { latestRun } from "../src/view/model.ts";
import { DECKS, PICK } from "./helpers/imported.ts";
import { app, fakeScraper, lookup } from "./helpers/play.ts";
import { picture, tempProject } from "./helpers/project.ts";

const JP = { gl: "jp", hl: "ja", label: "Japan (Japanese)" };
const KR = { gl: "kr", hl: "ko", label: "South Korea (Korean)" };

test("lookup: a game missing in the US is read in the first project country where it exists", async () => {
  const s = workspaceStorage(mkdtempSync(join(tmpdir(), "ssr-nus-")));
  const f = fakeScraper([app("com.kr.only", "Korea Only", "GAME_ROLE_PLAYING", ["kr"])]);
  const play = lookup(s, f.scraper);
  const us = { gl: "us", hl: "en", label: "United States (English)" };
  const r = await play.detailsAnywhere("com.kr.only", [us, JP, KR]);
  assert.equal(r.app.title, "Korea Only");
  assert.deepEqual(r.reference, KR, "Japan was tried first, then South Korea");
  const again = f.calls.app;
  await play.detailsAnywhere("com.kr.only", [us, JP, KR]);
  assert.equal(f.calls.app, again, "the misses and the hit are cached");
  await assert.rejects(play.detailsAnywhere("com.kr.only", [us, JP]), (e: unknown) => {
    assert.ok(e instanceof PlayProblem);
    assert.match(e.message, /United States or in this project's other countries/);
    return true;
  });
  // Real Google Play shows the page of a game not sold in the US, marked "available: false".
  const shown = fakeScraper([]);
  shown.scraper.app = async ({ country }) => ({
    ...app("jp.co.game", "Shown Anyway"),
    available: country === "jp",
  });
  const r2 = await lookup(s, shown.scraper).detailsAnywhere("jp.co.game", [us, KR, JP]);
  assert.deepEqual(r2.reference, JP, "a page marked unavailable counts as not there");
  const inUs = fakeScraper([app("com.us.game", "US Game")]);
  assert.equal(
    (await lookup(s, inUs.scraper).detailsAnywhere("com.us.game", [JP])).reference,
    null,
  );
});

/** Survivor.io: not on Google Play in the US, a phone deck in Japan, not in Korea. */
async function projectWithJapanOnly() {
  const loaded = await tempProject(DECKS);
  const paths = projectPaths(loaded);
  const db = openImageDb(paths);
  const img = await picture(99);
  const { record } = await db.ingest(
    img,
    { appId: "com.dxx.firenow", gl: "jp", hl: "ja", position: 1 },
    "jp-1",
  );
  db.save();
  const base = {
    appId: "com.dxx.firenow",
    name: "Survivor.io",
    group: "named" as const,
    tier: "same_audience" as const,
    chartRanks: {},
    rawCount: 0,
    deckLength: 0,
    deviceMix: { phone: 0, tablet: 0, unknown: 0 },
    slots: [],
    fetchedAt: "",
  };
  const us: DeckManifest = { ...base, gl: "us", hl: "en", status: "unavailable" };
  const kr: DeckManifest = { ...base, gl: "kr", hl: "ko", status: "unavailable" };
  const jp: DeckManifest = {
    ...base,
    gl: "jp",
    hl: "ja",
    status: "ok",
    title: "Survivor.io",
    rawCount: 1,
    deckLength: 1,
    deviceMix: { phone: 1, tablet: 0, unknown: 0 },
    slots: [
      {
        position: 1,
        googleId: "jp-1",
        imageId: record.id,
        width: record.width,
        height: record.height,
        deviceClass: record.deviceClass,
        deviceConfidence: record.deviceConfidence,
        orientation: record.orientation,
      },
    ],
  };
  for (const d of [us, jp, kr]) writeDeck(paths.decks, d);
  const run = latestRun(paths.runs);
  assert.ok(run);
  const file = join(paths.runs, run.runId, "manifest.json");
  writeFileSync(file, JSON.stringify({ ...run, decks: [...run.decks, us, jp, kr] }));
  return loaded;
}

test("pipeline: a competitor without a US page is left out of the core, shown where it exists", async () => {
  const loaded = await projectWithJapanOnly();
  assert.deepEqual(
    notInCoreMarket(loaded).map((c) => c.name),
    ["Survivor.io"],
  );
  const view = fitFor(loaded, ["com.dxx.firenow", ...PICK]);
  assert.deepEqual(
    view.fit.skipped.map((s) => [s.candidate.name, s.reason]),
    [["Survivor.io", "no-deck"]],
  );
  assert.equal(view.fit.selected.length, 5, "the others still fit");
  const plan = buildAnalysisPlan(loaded, "pilot");
  assert.ok(!plan.items.some((i) => i.appId === "com.dxx.firenow"), "never analysed in the core");

  const html = renderGalleryHtml(loaded, "t");
  assert.match(html, /"notInBaseline":\{"availableIn":\["Japan"\]\}/);
  assert.match(html, /Not on Google Play in/);
  const out = runDeckView(loaded);
  assert.match(
    readFileSync(out.index, "utf8"),
    /Survivor\.io .*not on Google Play in .*: not in the core check/,
  );

  const x = reportInputs(loaded, "pilot");
  const md = reportMarkdown(buildReportData(x), x.label).join("\n");
  assert.match(md, /Not in this check: Survivor\.io \(not on Google Play in /);
});

test("download preview: says which competitors are not in the US and where they are downloaded", () => {
  const cfg = {
    core: { market: "us" },
    markets: [
      { gl: "us", hl: "en", label: "United States (English)" },
      { gl: "jp", hl: "ja", label: "Japan" },
      { gl: "kr", hl: "ko", label: "South Korea" },
    ],
    competitors: [
      { id: "a.jp", name: "Japan Only", tier: "direct" },
      { id: "b.us", name: "Everywhere", tier: "direct" },
    ],
  };
  const t = (appId: string, gl: string, hl: string) => ({
    appId,
    name: appId,
    group: "named" as const,
    tier: "direct",
    gl,
    hl,
    chartRanks: {},
  });
  const targets = [
    t("a.jp", "us", "en"),
    t("a.jp", "jp", "ja"),
    t("a.jp", "kr", "ko"),
    t("b.us", "us", "en"),
  ];
  const st = {
    "a.jp|us": "unavailable",
    "a.jp|jp": "ok",
    "a.jp|kr": "unavailable",
    "b.us|us": "ok",
  };
  const listings = Object.fromEntries(
    targets.map((x) => [
      deckKey(x),
      { status: st[`${x.appId}|${x.gl}` as keyof typeof st], screenshots: [], title: x.appId },
    ]),
  );
  const plan = { targets, listings, createdAt: "t" } as unknown as DownloadPlan;
  const config = cfg as unknown as Parameters<typeof previewMarkdown>[1];
  assert.deepEqual(previewNotes(plan, config), [
    "Japan Only: not on Google Play in United States (English), so it is not in the core check. Downloaded in Japan.",
  ]);
  assert.match(previewMarkdown(plan, config), /> Japan Only: not on Google Play in United States/);
});
