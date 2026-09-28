import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPaths } from "../src/config/load.ts";
import { buildReportVersion } from "../src/reports/build.ts";
import { listReports } from "../src/reports/list.ts";
import { createReport, runFolders } from "../src/reports/store.ts";
import { getReportVersion } from "../src/server/reports-api.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import {
  addDeck,
  analyse,
  builderProject,
  idOf,
  idsOf,
  readyReport,
  usBytes,
} from "./helpers/builder.ts";

test("a Compare countries report with nothing new to analyse builds at once, one part per country", async () => {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  const two = ["Capybara Go", "Mini Tales"];
  analyse(loaded, [ours, ...two]);
  readyReport(loaded, "pilot");
  // Japan and Korea reuse the US files exactly: free.
  for (const n of [ours, ...two])
    for (const gl of ["jp", "kr"])
      await addDeck(
        loaded,
        n,
        gl,
        gl === "jp" ? "ja" : "ko",
        [usBytes(loaded, idOf(loaded, n), 1)],
        n === ours ? "ours" : "named",
      );
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const def = createReport(s, paths, {
    name: "Japan, South Korea vs 2 competitors",
    type: "compare",
    scope: {
      type: "compare",
      markets: [
        { gl: "jp", hl: "ja", label: "Japan" },
        { gl: "kr", hl: "ko", label: "South Korea" },
      ],
      competitors: idsOf(loaded, two),
      includeCharts: [],
    },
  });
  const r = await buildReportVersion(loaded, def, { now: new Date("2026-09-28T12:00:00.000Z") });
  assert.ok(r.ok, r.ok ? "" : r.problem);
  const files = runFolders(s, paths).get(r.versionId);
  assert.ok(
    files?.has("country-report.json") && files.has("report.md") && files.has("version.json"),
  );
  assert.equal(files?.has("report-data.json"), false);
  const v = getReportVersion(loaded, def.id, r.versionId).body as {
    country: { countries: { gl: string; data: { games: unknown[] } }[]; name: string };
  };
  assert.deepEqual(
    v.country.countries.map((c) => c.gl),
    ["jp", "kr"],
  );
  assert.equal(v.country.countries[0]?.data.games.length, 3);
  assert.equal(v.country.name, "Japan, South Korea vs 2 competitors");
  // Listed as ready with its generation date; no newer data right after the build.
  const card = listReports(loaded).find((x) => x.id === def.id);
  // The written parts are not paid for yet: a partial version that says so.
  assert.equal(card?.status.kind, "partial");
  assert.equal(card?.versions[0]?.format, "data");
  assert.equal(card?.newer, null);
  // A Full check now exists: the report built on the Pilot only says so.
  readyReport(loaded, "core");
  assert.match(
    listReports(loaded).find((x) => x.id === def.id)?.newer ?? "",
    /A Full check is now available/,
  );
});
