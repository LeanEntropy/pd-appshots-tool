import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { projectPaths } from "../src/config/load.ts";
import {
  getAnalysisStatus,
  postAnalysisPlan,
  postAnalysisRun,
  postSelection,
} from "../src/server/api.ts";
import { GRID_SCRIPT } from "../src/view/gallery-grid.ts";
import { galleryHtml } from "../src/view/gallery-html.ts";
import { GALLERY_SCRIPT } from "../src/view/gallery-script.ts";
import type { ViewModel } from "../src/view/model.ts";
import { quickRun, settle } from "./helpers/jobs.ts";
import { tempProject } from "./helpers/project.ts";

interface FakeImage {
  position: number;
  imageId: string;
  thumb: string;
  full: string;
  width: number;
  height: number;
  device: string;
  analysis: null | { screen: string };
}

const deck = (phone: number, tablet: number, analysed = 0): FakeImage[] =>
  Array.from({ length: phone + tablet }, (_, i) => ({
    position: i + 1,
    imageId: `id${i}`,
    thumb: `t${i}.webp`,
    full: `f${i}.png`,
    width: i < phone ? 1080 : 2048,
    height: i < phone ? 1920 : 2732,
    device: i < phone ? "phone" : "tablet",
    analysis: i < analysed ? { screen: "Battle" } : null,
  }));

const app = (appId: string, images: FakeImage[]) => ({
  appId,
  name: appId,
  decks: [{ gl: "us", hl: "en", status: "ok", images }],
});

/** Runs the grid script with a tiny fake page and returns the rendered grid HTML. */
function renderGrid(stage: "pilot" | "core"): string {
  const els: Record<string, { innerHTML: string; value?: string; hidden?: boolean }> = {
    grid: { innerHTML: "" },
    gridHint: { innerHTML: "" },
    stage: { innerHTML: "", value: stage },
  };
  const named = new Map([
    ["A", app("A", deck(6, 6))],
    ["B", app("B", deck(5, 5))],
    ["C", app("C", deck(4, 0))],
  ]);
  const ctx = {
    DATA: {
      ours: [app("Ours", deck(7, 0, 2))],
      coreMarket: { gl: "us", hl: "en", label: "US" },
      deviceClasses: ["phone"],
      pilotCompetitors: 2,
    },
    selection: ["A", "B", "C"],
    named,
    fit: () => ({ kept: ["A", "B", "C"] }),
    esc: (s: unknown) => String(s),
    IMG: "../images/",
    infoBtn: () => "",
    caption: () => "",
    document: {
      getElementById: (id: string) => els[id] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    window: { addEventListener: () => {} },
  };
  runInNewContext(`${GRID_SCRIPT}\nrenderGrid();`, ctx);
  return els.grid?.innerHTML ?? "";
}

test("the grid marks and counts every image of the pilot batch", () => {
  const html = renderGrid("pilot");
  assert.match(html, /Pilot: 5 of 7 will be analysed \(2 already analysed, no AI\)/);
  assert.match(html, /Pilot: 6 of 12 will be analysed \(6 tablet-shaped excluded\)/);
  assert.match(html, /Pilot: 5 of 10 will be analysed \(5 tablet-shaped excluded\)/);
  assert.match(html, /Pilot: 0 of 4 \(not in this batch\)/);
  assert.equal(html.match(/gbadge next/g)?.length, 5 + 6 + 5);
  assert.equal(html.match(/gbadge done/g)?.length, 2);
  assert.match(html, /Not analysed: tablet-shaped screenshot/);
  assert.match(html, /Not analysed: not in the core pilot/);
  // Fixed-size thumbnails: a wide image cannot widen a column for every game.
  assert.match(html, /width="100" height="160"/);
});

test("the full core batch includes every fitted deck", () => {
  const html = renderGrid("core");
  assert.match(html, /Core check: 4 of 4 will be analysed/);
  assert.equal(html.match(/gbadge next/g)?.length, 5 + 6 + 5 + 4);
});

test("the page script parses; approval is a modal dialog; the overview starts folded", () => {
  assert.doesNotThrow(() => new Function(GALLERY_SCRIPT));
  const vm = { coreMarket: { label: "US" }, pilotCompetitors: 2 } as unknown as ViewModel;
  const html = galleryHtml(vm, "t");
  assert.match(html, /<dialog id="approvalDlg"[^>]*><div id="approval" tabindex="-1">/);
  assert.match(html, /<div id="status"[^>]*tabindex="-1"/);
  assert.doesNotMatch(GALLERY_SCRIPT, /<details open><summary><strong>Store overview/);
});

test("a project page's top bar has Settings and Games library side by side", () => {
  const vm = { coreMarket: { label: "US" }, pilotCompetitors: 2 } as unknown as ViewModel;
  const served = { name: "Demo", apiBase: "/p/demo/api", steps: [], stage: "setup" };
  const html = galleryHtml(vm, "t", served);
  assert.match(
    html,
    /href="\/p\/demo\/settings">Settings<\/a> <a class="btn-new" href="\/games">Games library<\/a>/,
  );
});

test("the status lists the images of the approved batch, also after a restart", async () => {
  const loaded = await tempProject({
    "Archero 2": { phone: 2, tablet: 2 },
    Heroll: { phone: 2, tablet: 0 },
  });
  postSelection(loaded, { coreCompetitors: ["Archero 2", "Heroll"] });
  const shown = postAnalysisPlan(loaded, { stage: "pilot" }).body as { plan: { planHash: string } };
  const run = { stage: "pilot", planHash: shown.plan.planHash };
  assert.equal(postAnalysisRun(loaded, run, quickRun).status, 202);
  await settle(loaded);
  // A plan shown after the approval does not change the batch the run reports.
  postSelection(loaded, { coreCompetitors: ["Heroll", "Archero 2"] });
  postAnalysisPlan(loaded, { stage: "pilot" });
  // An old status file (from before the job journal) is not read once the journal exists.
  const saved = { running: true, stage: "pilot", startedAt: "2026-09-28T00:00:00.000Z" };
  writeFileSync(join(projectPaths(loaded).pending, "analysis-status.json"), JSON.stringify(saved));
  const body = getAnalysisStatus(loaded).body as {
    running: boolean;
    batch: { estimateUsd: number[]; items: { name: string; position: number }[] };
  };
  // A status saved by a server that is gone is not reported as running.
  assert.equal(body.running, false);
  assert.equal(body.batch.estimateUsd.length, 2);
  assert.deepEqual(
    body.batch.items.map((i) => `${i.name} #${i.position}`),
    [
      "Rogue Legend #1",
      "Rogue Legend #2",
      "Rogue Legend #3",
      "Archero 2 #1",
      "Archero 2 #2",
      "Heroll #1",
      "Heroll #2",
    ],
  );
});

test("the store overview always starts folded, with a clear toggle", () => {
  assert.match(GALLERY_SCRIPT, /Click to expand or fold/);
  assert.doesNotMatch(
    GALLERY_SCRIPT,
    /<details class="sec" open><summary><span class="sec-t">Store overview/,
  );
});
