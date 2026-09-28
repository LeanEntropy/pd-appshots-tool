import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReportInputs } from "../src/analysis/report-data.ts";
import { SCHEMA_VERSION } from "../src/analysis/schema.ts";
import { newerReason } from "../src/reports/stale.ts";
import { presetVersionInputs } from "../src/reports/version.ts";

const US = { gl: "us", hl: "en", label: "United States (English)" };

function inputs(o: {
  games?: { appId: string; name: string }[];
  updatedAt?: string;
  orderDate?: string;
  taxonomy?: string;
  hash?: string;
}): ReportInputs {
  const games = (
    o.games ?? [
      { appId: "ours", name: "Ours" },
      { appId: "a", name: "Archero 2" },
    ]
  ).map((g) => ({ ...g, positions: [1] }));
  const records = new Map(
    games.map((g) => [
      `${g.appId}-img`,
      {
        status: "ok",
        schema: SCHEMA_VERSION,
        final: {},
        updatedAt: g.appId === "a" ? (o.updatedAt ?? "2026-09-27T10:00:00.000Z") : "2026-09-27",
      },
    ]),
  );
  return {
    plan: {
      stage: "pilot",
      market: US,
      games,
      items: games.map((g) => ({ appId: g.appId, position: 1, imageId: `${g.appId}-img` })),
      versions: { prompts: {}, schema: "s", taxonomy: o.taxonomy ?? "t1", fit: "f" },
      planHash: "p",
    },
    approved: true,
    ourAppId: "ours",
    records,
    orderDates: new Map(
      games.map((g) => [g.appId, g.appId === "a" ? (o.orderDate ?? "2026-09-27") : "2026-09-27"]),
    ),
    dataHash: o.hash ?? "h1",
    latestAi: null,
  } as unknown as ReportInputs;
}

const saved = presetVersionInputs(inputs({}), {
  reportId: "r-pilot",
  stage: "pilot",
  main: US,
  now: new Date(0),
});

test("no badge when the fingerprint is the same", () => {
  assert.equal(newerReason(inputs({}), US, saved, "h1"), null);
});

test("each kind of change gets its reason in plain words", () => {
  const changed = (o: Parameters<typeof inputs>[0]) =>
    newerReason(inputs({ hash: "h2", ...o }), US, saved, "h1");
  assert.equal(
    newerReason(inputs({ hash: "h2" }), { gl: "jp", hl: "ja" }, saved, "h1"),
    "The main country changed.",
  );
  assert.equal(
    changed({
      games: [
        { appId: "ours", name: "Ours" },
        { appId: "c", name: "Capybara Go" },
      ],
    }),
    "The pick changed (Capybara Go added, Archero 2 removed); 1 new or updated analysis.",
  );
  assert.equal(changed({ taxonomy: "t2" }), "The screen-type list was updated.");
  assert.equal(changed({ updatedAt: "2026-09-28T10:00:00.000Z" }), "1 new or updated analysis.");
  assert.equal(changed({ orderDate: "2026-09-30" }), "Archero 2's store page changed on 30 Sep.");
  assert.equal(changed({}), "The data changed since this version was made.");
  // Older runs have no version.json: the fingerprint comparison only, as before.
  assert.equal(
    newerReason(inputs({ hash: "h2" }), US, null, "h1"),
    "New or updated analyses since this version was made.",
  );
});
