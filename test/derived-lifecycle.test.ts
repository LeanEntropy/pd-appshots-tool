import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPaths } from "../src/config/load.ts";
import { buildReportVersion } from "../src/reports/build.ts";
import type { CountryReport } from "../src/reports/country-report-types.ts";
import {
  makeCountryReportsNow,
  readDerived,
  reconcileDerived,
} from "../src/reports/derived-relations.ts";
import { derivedReasons } from "../src/reports/derived-stale.ts";
import { listReports } from "../src/reports/list.ts";
import {
  createReport,
  listDefs,
  readDef,
  readVersionInputs,
  versionFileKey,
} from "../src/reports/store.ts";
import { getReportVersion, patchReport, removeReport } from "../src/server/reports-api.ts";
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

async function comparison() {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  const two = ["Capybara Go", "Mini Tales"];
  analyse(loaded, [ours, ...two]);
  readyReport(loaded, "core");
  for (const n of [ours, ...two])
    for (const [gl, hl] of [
      ["jp", "ja"],
      ["kr", "ko"],
    ] as const)
      await addDeck(
        loaded,
        n,
        gl,
        hl,
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
  const r = await buildReportVersion(loaded, def, { now: new Date("2026-09-29T07:08:42.508Z") });
  assert.ok(r.ok);
  return { loaded, paths, s, def, versionId: r.versionId };
}

test("country reports from a comparison: made once by code, linked both ways, suppressed on delete, restored on request", async () => {
  const { loaded, paths, s, def, versionId } = await comparison();
  // Its written parts are not paid for (partial): no country report is made by itself.
  assert.deepEqual(reconcileDerived(loaded).made, []);
  const made = makeCountryReportsNow(loaded, def.id).made;
  assert.deepEqual(
    made.map((m) => m.gl),
    ["jp", "kr"],
  );
  const jpId = `${def.id}-jp`;
  const jp = readDef(s, paths, jpId);
  assert.equal(jp?.type, "country");
  assert.deepEqual(jp?.derivedFrom, { reportId: def.id, gl: "jp" });
  const vid = jp?.versions[0]?.id ?? "";
  assert.equal(vid, versionId.replace(def.id, jpId), "the comparison version's time stamp");
  const v = readVersionInputs(s, paths, vid);
  assert.equal(v?.derivedFrom?.versionId, versionId);
  assert.equal(v?.displayScope?.gl, "jp");
  assert.ok(v?.dependencyScope?.records.every((r) => !("gl" in r)));
  assert.ok(
    v?.records.every((r) => r.gl === "jp"),
    "only this country's records",
  );
  // Idempotent: nothing twice.
  assert.deepEqual(makeCountryReportsNow(loaded, def.id).made, []);
  assert.equal(listDefs(s, paths).filter((d) => d.derivedFrom).length, 2);
  // The page: the band on the country report, the links on the comparison, the groups part.
  const page = getReportVersion(loaded, jpId, vid).body as {
    country: CountryReport & {
      links: { derived: { parentId: string; siblings: { gl: string }[] } };
    };
  };
  assert.equal(page.country.derived?.from.reportId, def.id);
  assert.equal(page.country.links.derived.parentId, def.id);
  assert.deepEqual(
    page.country.links.derived.siblings.map((x) => x.gl),
    ["kr"],
  );
  const cmp = getReportVersion(loaded, def.id, versionId).body as {
    country: { groups: unknown; links: { countryReports: { gl: string }[] } };
    html: string;
  };
  assert.deepEqual(
    cmp.country.links.countryReports.map((x) => x.gl),
    ["jp", "kr"],
  );
  assert.ok(cmp.country.groups, "the comparison gets its group part");
  assert.match(cmp.html, /Patterns across your countries/);
  // The list: a chip, and no "Newer data" right after.
  const row = listReports(loaded).find((x) => x.id === jpId);
  assert.deepEqual(row?.derivedFrom, { id: def.id, name: def.name });
  assert.equal(row?.newer, null);
  // Deleting a country report: not recreated by the next reconcile; "Make country reports now" restores it.
  assert.equal(removeReport(loaded, jpId).status, 200);
  assert.equal(
    readDerived(s, paths).comparisons[0]?.children.find((c) => c.gl === "jp")?.state,
    "suppressed",
  );
  reconcileDerived(loaded, { force: versionId });
  assert.equal(readDef(s, paths, jpId), null);
  assert.deepEqual(
    makeCountryReportsNow(loaded, def.id).made.map((m) => m.gl),
    ["jp"],
  );
  assert.ok(readDef(s, paths, jpId)?.versions.length);
  assert.ok(s.exists(versionFileKey(paths, vid, "country-report.json")));
  // Deleting the comparison leaves its country reports, whose band says so.
  assert.equal(removeReport(loaded, def.id).status, 200);
  const alone = getReportVersion(loaded, jpId, vid).body as {
    country: { links: { derived: { parentId: string | null } } };
  };
  assert.equal(alone.country.links.derived.parentId, null);
});

test("groups are saved on the comparison only, with at least 2 of its countries", async () => {
  const { loaded, s, paths, def } = await comparison();
  assert.equal(
    patchReport(loaded, def.id, { groups: [{ name: "Solo", countries: ["jp"] }] }).status,
    400,
  );
  assert.equal(
    patchReport(loaded, def.id, { groups: [{ name: "Pair", countries: ["jp", "us"] }] }).status,
    400,
  );
  assert.equal(
    patchReport(loaded, def.id, { groups: [{ name: "Pair", countries: ["jp", "kr"] }] }).status,
    200,
  );
  assert.deepEqual(readDef(s, paths, def.id)?.scope.groups, [
    { name: "Pair", countries: ["jp", "kr"] },
  ]);
  assert.equal(patchReport(loaded, def.id, { groups: [] }).status, 200);
  assert.equal(readDef(s, paths, def.id)?.scope.groups, undefined);
});

test("staleness is on the dependency scope: this country's pages or the main baseline, never another country", () => {
  const dep = {
    records: [{ appId: "a", position: 1, imageId: "x", updatedAt: "2026-09-27T00:00:00Z" }],
    orderDates: { "a@jp": "2026-09-27" },
    baseVersionId: "2026-09-28T22-16-28-904Z-core",
  };
  const names = { country: "Japan", main: "United States", game: (id: string) => id.toUpperCase() };
  const same = {
    records: dep.records,
    orderDates: dep.orderDates,
    baseVersionId: dep.baseVersionId,
  };
  assert.deepEqual(derivedReasons(dep, same, names), []);
  const moved = derivedReasons(
    dep,
    {
      ...same,
      records: [
        { ...dep.records[0], updatedAt: "2026-09-30T00:00:00Z" } as (typeof dep.records)[0],
      ],
    },
    names,
  );
  assert.match(moved[0] ?? "", /Japan's pages changed \(1 new or updated analysis\)/);
  assert.match(
    derivedReasons(dep, { ...same, orderDates: { "a@jp": "2026-10-01" } }, names)[0] ?? "",
    /new store pages of A/,
  );
  assert.match(
    derivedReasons(dep, { ...same, baseVersionId: "2026-10-01T00-00-00-000Z-core" }, names)[0] ??
      "",
    /the United States baseline changed/,
  );
});
