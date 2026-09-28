import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { estimate } from "../src/analysis/estimate.ts";
import { configHash, loadConfig } from "../src/config/load.ts";
import { configFromSettings, loadDefaults, settingsFromConfig } from "../src/config/project.ts";
import type { ProjectSettings } from "../src/config/project-schema.ts";
import { baselineMarket, buildTargets, coreMarket, mainMarket } from "../src/core/targets.ts";
import { settingsOf } from "../src/settings/access.ts";

const REPO = join(import.meta.dirname, "..");
const defaults = loadDefaults(REPO);
const fixture = loadConfig(join(REPO, "test", "fixtures", "config.json")).config;
const base: ProjectSettings = {
  ...settingsFromConfig(fixture, defaults, "2026-09-28T00:00:00.000Z"),
  overrides: undefined,
};
const withOver = (overrides: Record<string, unknown>) =>
  configFromSettings({ ...base, overrides } as ProjectSettings, defaults);

test("settings accessor: the defaults a project starts with", () => {
  const t = settingsOf(configFromSettings(base, defaults));
  assert.equal(t.mainMarket.gl, "us");
  const on = Object.fromEntries(Object.entries(t.steps).map(([k, v]) => [k, v.secondOpinion]));
  assert.deepEqual(on, {
    screenshotAnalysis: false,
    textLayer: false,
    patterns: false,
    recommendations: true,
    countryAdvice: true,
    conceptMap: false,
    abTests: false,
  });
  assert.deepEqual(t.earlyStop, { minDecks: 5, window: 2, maxShareShift: 0.1 });
  assert.deepEqual(t.spending, { perBatchUsd: 30, perReportUsd: 30 });
  assert.deepEqual(t.coreSize, { target: 85, cap: 100 });
  assert.deepEqual(t.suggestions, {
    reuseShare: 0.9,
    splitLow: 0.4,
    splitHigh: 0.6,
    weakN: 4,
    staleDays: 30,
  });
  assert.equal(t.traffic("jp"), "unknown");
  assert.deepEqual(t.pdf, { paper: "A4", orientation: "landscape", images: true });
  assert.equal(t.steps.screenshotAnalysis.model, "claude:claude-fable-5-1");
  assert.equal(t.steps.countryAdvice.reviewer, "codex:gpt-5.6-sol");
});

test("main country: one resolver, and every caller gets the same market after a change", () => {
  const us = configFromSettings(base, defaults);
  const jp = withOver({ core: { market: "jp" } });
  for (const [c, gl] of [
    [us, "us"],
    [jp, "jp"],
  ] as const) {
    assert.equal(mainMarket(c).gl, gl);
    assert.equal(baselineMarket(c), mainMarket(c));
    assert.equal(coreMarket(c), mainMarket(c));
    assert.deepEqual(
      c.markets.filter((m) => m.baseline).map((m) => m.gl),
      [gl],
    );
    assert.equal(settingsOf(c).mainMarket.gl, gl);
  }
  // Chart games are also read in the main country's locale.
  const charts = [
    { gl: "kr", status: "ok" as const, entries: [{ appId: "a.b", title: "X", rank: 1 }] },
  ];
  const t = buildTargets(jp, charts as never).filter((x) => x.appId === "a.b");
  assert.deepEqual(t.map((x) => x.gl).sort(), ["jp", "kr"]);
  // A main country no longer in the project falls back to the first one.
  assert.equal(mainMarket(withOver({ core: { market: "fr" } })).gl, "us");
});

test("report options never change the download fingerprint; tool values do", () => {
  const plain = configFromSettings(base, defaults);
  const pdf = withOver({ options: { pdf: { paper: "Letter" }, traffic: { jp: "high" } } });
  assert.equal(configHash(pdf), configHash(plain));
  assert.notEqual(configHash(withOver({ budget: { maxUsdPerIncrement: 10 } })), configHash(plain));
});

test("the recommendations second opinion follows its own switch", () => {
  const on = configFromSettings(base, defaults);
  const off = withOver({ options: { secondOpinion: { recommendations: false } } });
  const check = (c: typeof on) =>
    estimate(c, [], true).passes.find((p) => p.role === "Recommendation check")?.calls;
  assert.equal(check(on), 1);
  assert.equal(check(off), 0);
  assert.equal(settingsOf(off).steps.screenshotAnalysis.secondOpinion, false);
});
