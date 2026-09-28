import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { eligibility } from "../src/reports/eligibility.ts";
import { buildScopePlan } from "../src/reports/scope-plan.ts";
import type { ReportScope } from "../src/reports/types.ts";
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

const JP = { gl: "jp", hl: "ja", label: "Japan" };
const KR = { gl: "kr", hl: "ko", label: "South Korea" };

test("Pilot and Full check scopes give exactly today's plan and fingerprint", async () => {
  const loaded = await builderProject();
  for (const type of ["pilot", "core"] as const) {
    const today = buildAnalysisPlan(loaded, type);
    const p = buildScopePlan(loaded, { type, markets: [], competitors: [], includeCharts: [] });
    assert.equal(p.planHash, today.planHash);
    assert.deepEqual(p.counts, today.counts);
    assert.deepEqual(p.usd, today.estimate.usd);
  }
});

test("anchors: identical is free, the same picture is a text comparison, the main image anchors", async () => {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  analyse(loaded, [ours, "Capybara Go"]);
  const jpOnly = await picture(501);
  // Ours in Japan: #1 the same file as in the US, #2 the US picture with new text, #3 Japan only.
  await addDeck(
    loaded,
    ours,
    "jp",
    "ja",
    [
      usBytes(loaded, idOf(loaded, ours), 1),
      await newText(usBytes(loaded, idOf(loaded, ours), 2)),
      jpOnly,
    ],
    "ours",
  );
  // Ours in Korea: the Japan-only picture with Korean text.
  await addDeck(loaded, ours, "kr", "ko", [await newText(jpOnly)], "ours");
  // Mini Tales is not analysed in the US: its US image becomes the anchor of Japan's copy.
  const mini = idOf(loaded, "Mini Tales");
  await addDeck(loaded, "Mini Tales", "jp", "ja", [await newText(usBytes(loaded, mini, 1))]);
  await addDeck(loaded, "Capybara Go", "jp", "ja", "unavailable");
  const scope: ReportScope = {
    type: "compare",
    markets: [JP, KR],
    competitors: idsOf(loaded, ["Capybara Go", "Mini Tales"]),
    includeCharts: [],
  };
  const p = buildScopePlan(loaded, scope);
  const at = (name: string, gl: string, pos: number) =>
    p.items.find((i) => i.name === name && i.gl === gl && i.position === pos && !i.anchorAdded);
  assert.equal(at(ours, "jp", 1)?.tier, "identical");
  assert.equal(at(ours, "jp", 2)?.tier, "layer-diff");
  assert.match(at(ours, "jp", 2)?.reason ?? "", /analysed image in the United States/);
  assert.equal(at(ours, "jp", 3)?.tier, "full");
  assert.equal(at(ours, "jp", 3)?.noMainVersion, true);
  assert.equal(at(ours, "kr", 1)?.tier, "layer-diff");
  assert.match(at(ours, "kr", 1)?.reason ?? "", /image in Japan \(no main-country version\)/);
  const anchor = p.items.find((i) => i.anchorAdded);
  assert.equal(anchor?.name, "Mini Tales");
  assert.equal(anchor?.gl, "us");
  assert.equal(anchor?.tier, "full");
  assert.equal(at("Mini Tales", "jp", 1)?.tier, "layer-diff");
  assert.equal(at("Mini Tales", "jp", 1)?.basedOn, anchor?.imageId);
  // Not sold in Japan: listed as such, nothing planned for it there.
  assert.equal(p.decks.find((d) => d.name === "Capybara Go" && d.gl === "jp")?.state, "not-sold");
  assert.equal(p.items.filter((i) => i.name === "Capybara Go").length, 0);
  assert.deepEqual(p.counts, { identical: 1, layerDiff: 3, full: 2, newImages: 5 });
  assert.equal(p.instant, false);
  assert.ok(p.usd[1] > p.images.usd[1], "the text-only steps are in the total");
});

test("a One country report of the main country from existing analyses is instant", async () => {
  const loaded = await builderProject();
  analyse(loaded, [loaded.config.ourApp.name, ...["Capybara Go", "Mini Tales", "Heroll"]]);
  const p = buildScopePlan(loaded, {
    type: "country",
    markets: [{ gl: "us", hl: "en", label: "United States (English)" }],
    competitors: idsOf(loaded, ["Capybara Go", "Mini Tales", "Heroll"]),
    includeCharts: [],
  });
  assert.equal(p.counts.newImages, 0);
  assert.equal(p.instant, true);
  assert.equal(p.text.later, false);
});

test("over the limit: the lowest-priority combinations are proposed, never applied silently", async () => {
  const base = await builderProject();
  const loaded = {
    ...base,
    config: {
      ...base.config,
      options: { ...base.config.options, spending: { maxUsdPerReport: 1 } },
    },
  };
  for (const n of ["Capybara Go", "Mini Tales"]) {
    await addDeck(loaded, n, "jp", "ja", [
      await picture(700 + n.length),
      await picture(710 + n.length),
    ]);
    await addDeck(loaded, n, "kr", "ko", [
      await picture(720 + n.length),
      await picture(730 + n.length),
    ]);
  }
  const scope: ReportScope = {
    type: "compare",
    markets: [JP, KR],
    competitors: idsOf(loaded, ["Capybara Go", "Mini Tales"]),
    includeCharts: [],
  };
  const p = buildScopePlan(loaded, scope);
  assert.equal(p.overLimit, true);
  assert.equal(p.drop?.leaveOut[0]?.name, "Mini Tales");
  assert.equal(p.drop?.leaveOut[0]?.gl, "kr");
  assert.ok((p.drop?.savesUsd ?? 0) > 0);
  // The scope itself is unchanged until the user applies it; applied, it is shown as left out.
  assert.equal(scope.leftOut, undefined);
  const applied = buildScopePlan(loaded, {
    ...scope,
    leftOut: (p.drop?.leaveOut ?? []).map((x) => ({ appId: x.appId, gl: x.gl })),
  });
  assert.equal(
    applied.decks.find((d) => d.name === "Mini Tales" && d.gl === "kr")?.state,
    "left-out",
  );
  assert.ok(applied.usd[1] < p.usd[1]);
});

test("chart games are never planned unless ticked", async () => {
  const loaded = await builderProject();
  await addDeck(loaded, "Chart Hit", "jp", "ja", [await picture(900)], "chart", { jp: 3 });
  const scope: ReportScope = { type: "country", markets: [JP], competitors: [], includeCharts: [] };
  assert.equal(
    buildScopePlan(loaded, scope).items.some((i) => i.name === "Chart Hit"),
    false,
  );
});

test("eligibility: every type opens after a Ready Pilot; the Full check is recommended, not required", async () => {
  const loaded = await builderProject();
  let e = eligibility(loaded);
  assert.equal(e.types.pilot.open, true);
  assert.equal(e.types.compare.open, false);
  assert.equal(e.types.compare.reason, "Available after the Pilot.");
  readyReport(loaded, "pilot");
  e = eligibility(loaded);
  assert.equal(e.types.compare.open, true);
  assert.equal(e.types.core.open, true);
  assert.match(
    e.warning ?? "",
    /^Highly recommended: run the Full check of the United States first \(5 competitors/,
  );
  readyReport(loaded, "core");
  assert.equal(eligibility(loaded).warning, null);
});
