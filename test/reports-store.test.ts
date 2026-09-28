import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { syncPresetReports } from "../src/reports/migrate.ts";
import {
  addVersion,
  createReport,
  deleteReport,
  listDefs,
  readDef,
  renameReport,
  setArchived,
  versionFileKey,
  writeVersionInputs,
} from "../src/reports/store.ts";
import { dateFromRunId, type VersionInputs } from "../src/reports/types.ts";
import { LocalFsStorage, projectKey } from "../src/storage/index.ts";

const US = { gl: "us", hl: "en", label: "United States (English)" };
const c = { projectId: "p1" };

function fresh() {
  return new LocalFsStorage(mkdtempSync(join(tmpdir(), "ssr-rep-")));
}

function hashes(s: LocalFsStorage, prefix: string): Map<string, string> {
  return new Map(
    [...s.list(prefix)].map((k) => [
      k,
      createHash("sha256")
        .update(s.getBytes(k) ?? Buffer.alloc(0))
        .digest("hex"),
    ]),
  );
}

const inputs = (reportId: string): VersionInputs => ({
  reportId,
  type: "country",
  generatedAt: "2026-09-28T10:00:00.000Z",
  createdAt: "2026-09-28T10:00:00.000Z",
  mainMarket: US,
  scope: { type: "country", markets: [US], competitors: [], includeCharts: [] },
  pick: [],
  orderDates: {},
  records: [],
  versions: { prompts: {}, schema: "s", taxonomy: "t", fit: "f" },
  planHash: null,
  dataHash: "d1",
  aiRunId: null,
});

function japanReport(s: LocalFsStorage) {
  return createReport(s, c, {
    name: "Japan vs 3 competitors",
    type: "country",
    scope: { type: "country", markets: [US], competitors: [], includeCharts: [] },
  });
}

test("generation date of a run folder comes from its id", () => {
  assert.equal(dateFromRunId("2026-09-27T22-29-48-097Z-pilot"), "2026-09-27T22:29:48.097Z");
  assert.equal(dateFromRunId("current-pilot"), null);
});

test("a version is write-once; rename and archive change only the def", () => {
  const s = fresh();
  const def = japanReport(s);
  assert.equal(def.id, "r-japan-vs-3-competitors-1");
  const vid = `2026-09-28T10-00-00-000Z-${def.id}`;
  assert.equal(writeVersionInputs(s, c, vid, inputs(def.id)), true);
  assert.equal(writeVersionInputs(s, c, vid, { ...inputs(def.id), dataHash: "d2" }), false);
  s.putText(versionFileKey(c, vid, "report.md"), "# r\n");
  addVersion(s, c, def.id, { id: vid, generatedAt: "2026-09-28T10:00:00.000Z" });
  const before = hashes(s, projectKey(c, "reports", vid));
  assert.equal(renameReport(s, c, def.id, "  Japan   only ").ok, true);
  assert.equal(readDef(s, c, def.id)?.name, "Japan only");
  assert.equal(setArchived(s, c, def.id, true).ok, true);
  assert.equal(readDef(s, c, def.id)?.archived, true);
  assert.deepEqual(hashes(s, projectKey(c, "reports", vid)), before);
  assert.equal(readDef(s, c, def.id)?.versions.length, 1);
});

test("names stay unique: a number is added on collision", () => {
  const s = fresh();
  const a = japanReport(s);
  const b = japanReport(s);
  assert.equal(b.name, "Japan vs 3 competitors (2)");
  assert.notEqual(a.id, b.id);
  const r = renameReport(s, c, b.id, "japan VS 3 competitors");
  assert.ok(r.ok && r.def.name === "japan VS 3 competitors (2)");
  assert.equal(renameReport(s, c, b.id, "   ").ok, false);
  assert.equal(renameReport(s, c, "r-none", "x").ok, false);
});

test("re-doing a Pilot archives the previous version; other types keep theirs current", () => {
  const s = fresh();
  syncPresetReports(s, c, US);
  addVersion(s, c, "r-pilot", {
    id: "2026-09-27T10-00-00-000Z-pilot",
    generatedAt: "2026-09-27T10:00:00.000Z",
  });
  let def = addVersion(s, c, "r-pilot", {
    id: "2026-09-28T10-00-00-000Z-pilot",
    generatedAt: "2026-09-28T10:00:00.000Z",
  });
  assert.deepEqual(
    def.versions.map((v) => v.archived),
    [true, false],
  );
  // Registering the same version again changes nothing.
  def = addVersion(s, c, "r-pilot", { id: "2026-09-28T10-00-00-000Z-pilot", generatedAt: "x" });
  assert.equal(def.versions.length, 2);
  const j = japanReport(s);
  addVersion(s, c, j.id, { id: `2026-09-27T10-00-00-000Z-${j.id}`, generatedAt: "2026-09-27" });
  const jd = addVersion(s, c, j.id, {
    id: `2026-09-28T10-00-00-000Z-${j.id}`,
    generatedAt: "2026-09-28",
  });
  assert.deepEqual(
    jd.versions.map((v) => v.archived),
    [false, false],
  );
});

test("delete removes only the report's own files; Pilot and Full check cannot be deleted", () => {
  const s = fresh();
  syncPresetReports(s, c, US);
  const pilotRun = "2026-09-27T10-00-00-000Z-pilot";
  s.putText(versionFileKey(c, pilotRun, "report.md"), "# pilot\n");
  s.putJson(projectKey(c, "reports", "latest-pilot.json"), { runId: pilotRun });
  s.putJson(projectKey(c, "analysis", "x.json"), { kept: true });
  syncPresetReports(s, c, US);
  const j = japanReport(s);
  const vid = `2026-09-28T10-00-00-000Z-${j.id}`;
  s.putText(versionFileKey(c, vid, "report.md"), "# japan\n");
  writeVersionInputs(s, c, vid, inputs(j.id));
  addVersion(s, c, j.id, { id: vid, generatedAt: "2026-09-28T10:00:00.000Z" });
  const others = hashes(s, projectKey(c));
  for (const k of others.keys()) if (k.includes(j.id)) others.delete(k);
  const r = deleteReport(s, c, j.id);
  assert.equal(r.ok, true);
  assert.equal(readDef(s, c, j.id), null);
  assert.equal(s.exists(versionFileKey(c, vid, "report.md")), false);
  assert.deepEqual(hashes(s, projectKey(c)), others, "nothing else changed");
  const p = deleteReport(s, c, "r-pilot");
  assert.ok(!p.ok && p.status === 409);
  const core = deleteReport(s, c, "r-core");
  assert.ok(!core.ok && core.status === 409);
  assert.ok(readDef(s, c, "r-pilot"));
  assert.deepEqual(
    listDefs(s, c)
      .map((d) => d.id)
      .sort(),
    ["r-core", "r-pilot"],
  );
});

test("the storage delete refuses anything but a report def or report version folder", () => {
  const s = fresh();
  for (const k of [
    projectKey(c, "reports", "latest-pilot.json"),
    projectKey(c, "reports", "2026-09-27T10-00-00-000Z-pilot"),
    projectKey(c, "reports", "current-pilot"),
    projectKey(c, "analysis"),
    projectKey(c, "reports"),
    "library/images",
  ])
    assert.throws(() => s.deleteReportFiles(k), /Refusing to delete/);
});
