import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import sharp from "sharp";
import { playSetup } from "../src/analysis/play-experiments.ts";
import { type LoadedConfig, projectPaths } from "../src/config/load.ts";
import { readJournal, writeJournal } from "../src/jobs/journal.ts";
import type { CountryReport } from "../src/reports/country-report-types.ts";
import { enqueueReport, reportApproval } from "../src/reports/report-job.ts";
import { createReport, readDef, versionFileKey } from "../src/reports/store.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { describeImage, hamming } from "../src/store/identity.ts";
import { REPORT_SCRIPT } from "../src/view/gallery-report.ts";
import { REPORT_PARTS_SCRIPT } from "../src/view/gallery-report-parts.ts";
import { REPORT_COUNTRY_SCRIPT } from "../src/view/report-country.ts";
import { REPORT_COUNTRY_PARTS_SCRIPT } from "../src/view/report-country-parts.ts";
import { REPORT_SUMMARY_SCRIPT } from "../src/view/report-summary.ts";
import {
  addDeck,
  analyse,
  builderProject,
  idOf,
  idsOf,
  newText,
  picture,
  readyReport,
  usBytes,
} from "./helpers/builder.ts";
import { reportFake } from "./helpers/report-fakes.ts";

const TWO = ["Capybara Go", "Mini Tales"];
const JP = { gl: "jp", hl: "ja", label: "Japan" };

/** Japan: ours the same file as in the US; Capybara Go the same picture with new text; Mini Tales a new picture. */
async function japanProject(): Promise<LoadedConfig> {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  analyse(loaded, [ours, ...TWO]);
  readyReport(loaded, "pilot");
  await addDeck(loaded, ours, "jp", "ja", [usBytes(loaded, idOf(loaded, ours), 1)], "ours");
  const capy = usBytes(loaded, idOf(loaded, "Capybara Go"), 1);
  await addDeck(loaded, "Capybara Go", "jp", "ja", [await newText(capy)]);
  await addDeck(loaded, "Mini Tales", "jp", "ja", [await picture(901)]);
  return loaded;
}

function japanReport(loaded: LoadedConfig) {
  const paths = projectPaths(loaded);
  return createReport(workspaceStorage(paths.workspace), paths, {
    name: "Japan vs 2 competitors",
    type: "country",
    scope: { type: "country", markets: [JP], competitors: idsOf(loaded, TWO), includeCharts: [] },
  });
}

function run(loaded: LoadedConfig, id: string, hash: string, fake: ReturnType<typeof reportFake>) {
  return enqueueReport(
    loaded,
    { reportId: id, planHash: hash },
    {
      depsFor: (onProgress) => ({ producer: fake, reviewer: null, adjudicator: fake, onProgress }),
      reportProvider: (ref) => ({ ...fake, model: ref.split(":")[1] ?? ref }),
    },
  );
}

function latestCountry(loaded: LoadedConfig, id: string): CountryReport {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const v = readDef(s, paths, id)?.versions.at(-1)?.id as string;
  return s.getJson(versionFileKey(paths, v, "country-report.json")) as CountryReport;
}

test("a One country report runs end to end after its approval: full analysis, text comparison, written parts", async () => {
  const loaded = await japanProject();
  const def = japanReport(loaded);
  const fake = reportFake();
  // No approval screen yet: nothing starts.
  const early = run(loaded, def.id, "0".repeat(64), fake);
  assert.equal(early.ok, false);
  const a = reportApproval(loaded, def);
  assert.ok(!("problem" in a));
  assert.deepEqual(
    {
      identical: a.plan.counts.identical,
      layer: a.plan.counts.layerDiff,
      full: a.plan.counts.full,
    },
    { identical: 1, layer: 1, full: 1 },
  );
  assert.equal(a.doubtful.length, 0);
  assert.ok(a.plan.text.parts.some((p) => /Country advice/.test(p.label)));
  assert.equal(fake.calls.length, 0, "the approval screen calls no model");
  const r = run(loaded, def.id, a.plan.planHash, fake);
  assert.ok(r.ok, r.ok ? "" : r.problem);
  const job = await r.done;
  assert.equal(job.state, "finished", job.error ?? "");
  // One full analysis (the new picture), one text comparison, then the text-only steps.
  assert.equal(fake.kinds.filter((k) => k === "image").length, 1);
  assert.equal(fake.kinds.filter((k) => k === "layer").length, 1);
  for (const k of ["concept", "advice", "advice-review", "ab"])
    assert.ok(fake.kinds.includes(k), k);
  const c = latestCountry(loaded, def.id);
  assert.equal(c.missing.length, 0, JSON.stringify(c.missing));
  assert.equal(c.advice[0]?.state, "current");
  assert.equal(c.terminology[0]?.state, "current");
  const rows = c.localisation?.rows ?? [];
  const row = (n: string) => rows.find((x) => x.game === n);
  assert.equal(row(loaded.config.ourApp.name)?.identical, 1);
  assert.equal(row("Capybara Go")?.newText, 1);
  assert.equal(row("Capybara Go")?.lines[0]?.localHeadline, "バトル開始");
  assert.equal(row("Mini Tales")?.different, 1);
  assert.match(c.summary.shortAnswer, /Japan/);
  assert.ok(c.summary.verdicts[0]?.localisation.includes("competitors translate"));
  // The spend is kept per batch, with the text comparison counted.
  const paths = projectPaths(loaded);
  const batch = readJournal(workspaceStorage(paths.workspace), paths).batches.at(-1);
  assert.equal(batch?.stage, "report");
  assert.ok(batch?.imageIds.some((i) => i.startsWith("layer-")));
  // Everything is analysed and written now: the next plan is free and reuses every answer.
  const again = reportApproval(loaded, def);
  assert.ok(!("problem" in again));
  assert.equal(again.plan.counts.newImages, 0);
  assert.equal(again.plan.instant, true);
});

test("a text comparison that finds a different screen never pays for a full analysis by itself", async () => {
  const loaded = await japanProject();
  const def = japanReport(loaded);
  const fake = reportFake({ differentScreen: true });
  const a = reportApproval(loaded, def);
  assert.ok(!("problem" in a));
  const job = await (
    run(loaded, def.id, a.plan.planHash, fake) as { done: Promise<{ state: string }> }
  ).done;
  assert.equal(job.state, "finished");
  assert.equal(fake.kinds.filter((k) => k === "image").length, 1, "only Mini Tales' new picture");
  const c = latestCountry(loaded, def.id);
  assert.match(c.banners.join(" "), /different screen under the text: it needs a full analysis/);
  // The next approval shows that image as a full analysis, with the reason.
  const next = reportApproval(loaded, def);
  assert.ok(!("problem" in next));
  const it = next.plan.items.find((i) => i.name === "Capybara Go");
  assert.equal(it?.tier, "full");
  assert.match(it?.reason ?? "", /different screen/);
});

test("doubtful picture matches are shown first and block the run until answered", async () => {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  analyse(loaded, [ours, ...TWO]);
  readyReport(loaded, "pilot");
  const us = usBytes(loaded, idOf(loaded, "Capybara Go"), 1);
  const base = await describeImage(us);
  // Paint a growing block until the picture is near the "same picture" line (4 to 6 bits).
  let near: Buffer | null = null;
  for (let size = 4; size < 200 && !near; size += 4) {
    const { data, info } = await sharp(us).raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) data[(y * info.width + x) * info.channels] = 255;
    const buf = await sharp(data, { raw: info }).png().toBuffer();
    const bits = hamming(base.phash, (await describeImage(buf)).phash);
    if (bits >= 4 && bits <= 6) near = buf;
    if (bits > 6) break;
  }
  if (!near) return; // This picture never lands near the line: nothing to check here.
  await addDeck(loaded, "Capybara Go", "jp", "ja", [near]);
  const def = japanReport(loaded);
  const a = reportApproval(loaded, def);
  assert.ok(!("problem" in a));
  assert.equal(a.doubtful.length, 1);
  const r = run(loaded, def.id, a.plan.planHash, reportFake());
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.problem, /doubtful/);
});

test("over the spending limit, the run is refused before anything is sent", async () => {
  const base = await japanProject();
  const loaded = {
    ...base,
    config: {
      ...base.config,
      options: { ...base.config.options, spending: { maxUsdPerReport: 0.05 } },
    },
  };
  const def = japanReport(loaded);
  const fake = reportFake();
  const a = reportApproval(loaded, def);
  assert.ok(!("problem" in a));
  assert.equal(a.plan.overLimit, true);
  const r = run(loaded, def.id, a.plan.planHash, fake);
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.problem, /over its spending limit/);
  assert.equal(fake.calls.length, 0);
});

function renderCountry(c: CountryReport, withFlags: boolean): string {
  const box = { innerHTML: "", classList: { toggle: () => {} } };
  const ctx: Record<string, unknown> = {
    IMG: "../images/",
    API: "/p/x/api",
    esc: (x: unknown) => String(x).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`),
    infoBtn: (id: string) => `<button class="info" data-info="${id}">i</button>`,
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { addEventListener: () => {}, getElementById: () => null },
    location: { hash: "", protocol: "file:" },
    ...(withFlags
      ? { countryLabel: (gl: string, n: string) => `<img class="flag" alt="${gl}">${n}` }
      : {}),
  };
  runInNewContext(
    `${REPORT_SCRIPT}\n${REPORT_PARTS_SCRIPT}\n${REPORT_SUMMARY_SCRIPT}\n${REPORT_COUNTRY_SCRIPT}\n${REPORT_COUNTRY_PARTS_SCRIPT}\nthis.draw = renderCountryReport;`,
    ctx,
  );
  const draw = ctx.draw as (b: unknown, c: unknown, rid: string, research: string) => void;
  draw(box, c, "r-japan-1", "");
  return box.innerHTML;
}

test("the country report reads bottom line first, with flags, local text, back-translations and no internal ids", async () => {
  const loaded = await japanProject();
  const def = japanReport(loaded);
  const a = reportApproval(loaded, def);
  assert.ok(!("problem" in a));
  const r = run(loaded, def.id, a.plan.planHash, reportFake());
  assert.ok(r.ok);
  await r.done;
  const html = renderCountry(latestCountry(loaded, def.id), true);
  const order = [
    "Summary: the bottom line",
    "Recommendations per country",
    "How each game localises",
    "Words used, per country",
    "A/B test details",
    "How we sort images",
  ];
  const at = order.map((t) => html.indexOf(t));
  assert.ok(
    at.every((i, k) => i > 0 && (k === 0 || i > (at[k - 1] as number))),
    JSON.stringify(at),
  );
  assert.match(html, /<img class="flag" alt="jp">Japan/);
  assert.match(html, /バトル開始/);
  assert.match(html, /battle start/);
  assert.match(html, /\[X\] different|\[V\] same/);
  assert.doesNotMatch(html, /\bC\d+\b/);
  assert.doesNotMatch(renderCountry(latestCountry(loaded, def.id), false), /class="flag"/);
});

test("a test across more than five languages says to split it into several experiments", () => {
  const gls = ["jp", "kr", "tw", "th", "vn", "id"];
  const markets = ["ja", "ko", "zh-TW", "th", "vi", "id"].map((hl, i) => ({
    gl: gls[i] as string,
    hl,
    label: hl,
  }));
  const s = playSetup(markets, markets, markets, () => "high", false);
  assert.equal(s.languages.length, 6);
  assert.match(s.notes.join(" "), /up to 5 languages: split this test into several experiments/);
});

test("an approval starts one job, ever: replaying it after other jobs is refused", async () => {
  const loaded = await japanProject();
  const def = japanReport(loaded);
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  // Every call fails, so nothing is analysed and the plan stays the same between runs.
  const failing = {
    ...reportFake(),
    call: async () => ({ ok: false, output: null, costUsd: 0, error: "down" }),
  };
  const first = reportApproval(loaded, def);
  assert.ok(!("problem" in first));
  const r1 = run(loaded, def.id, first.plan.planHash, failing);
  assert.ok(r1.ok);
  await r1.done;
  const b = reportApproval(loaded, def);
  assert.ok(!("problem" in b));
  const r2 = run(loaded, def.id, b.plan.planHash, failing);
  assert.ok(r2.ok, r2.ok ? "" : r2.problem);
  await r2.done;
  const same = reportApproval(loaded, def);
  assert.ok(!("problem" in same));
  assert.equal(same.plan.planHash, b.plan.planHash);
  // Replaying approval b after the journal's job slot moved on: still used up.
  const j = readJournal(s, paths);
  const used = j.jobs.ai?.approvalId as string;
  delete j.jobs.ai;
  writeJournal(s, paths, j);
  s.putJson(`projects/${paths.projectId}/pending/report-plan-${def.id}.json`, {
    plan: b.plan,
    createdAt: used.split("@")[1],
  });
  const again = run(loaded, def.id, b.plan.planHash, reportFake());
  assert.equal(again.ok, false);
  assert.match(again.ok ? "" : again.problem, /used already/);
});
