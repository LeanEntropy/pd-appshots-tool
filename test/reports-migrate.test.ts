import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { readLatest } from "../src/analysis/final-report.ts";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { type LoadedConfig, projectPaths } from "../src/config/load.ts";
import type { listReports } from "../src/reports/list.ts";
import { syncPresetReports } from "../src/reports/migrate.ts";
import { defKey, listDefs, readDef, versionFileKey } from "../src/reports/store.ts";
import { postSelection } from "../src/server/api.ts";
import { getReports, getReportVersion } from "../src/server/reports-api.ts";
import { projectKey, workspaceStorage } from "../src/storage/index.ts";
import { tempProject } from "./helpers/project.ts";

const US = { gl: "us", hl: "en", label: "United States (English)" };
const RUNS = {
  md: "2026-09-27T12-33-00-745Z-pilot",
  report: "2026-09-27T16-56-00-426Z-pilot",
  broken: "2026-09-27T21-43-48-128Z-pilot",
  partial: "2026-09-27T22-15-08-781Z-pilot",
  core: "2026-09-28T16-21-48-545Z-core",
};

async function project(): Promise<LoadedConfig> {
  const loaded = await tempProject({
    "Capybara Go": { phone: 2, tablet: 0 },
    "Mini Tales": { phone: 2, tablet: 0 },
  });
  postSelection(loaded, { coreCompetitors: ["Capybara Go", "Mini Tales"] });
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const put = (run: string, name: string, text: string) =>
    s.putText(versionFileKey(paths, run, name), text);
  // The oldest format: only pilot.md. Then report.md only, a broken and a partial report-data.json.
  put(
    RUNS.md,
    "pilot.md",
    "# Core pilot result\n\n[![1](../../images/thumb/a.webp)](../../images/orig/a.png)\n",
  );
  put(RUNS.report, "report.md", "# Core pilot: final report\n");
  put(RUNS.broken, "report.md", "# broken data\n");
  put(RUNS.broken, "report-data.json", "{ not json");
  put(RUNS.partial, "report.md", "# partial data\n");
  put(RUNS.partial, "report-data.json", JSON.stringify({ games: [] }));
  put(RUNS.core, "report.md", "# Core check: final report\n");
  put("current-pilot", "report.md", "# not a version\n");
  s.putJson(projectKey(paths, "reports", "latest-pilot.json"), {
    runId: RUNS.partial,
    file: "x",
    createdAt: "2026-09-27T22:16:00.000Z",
    dataHash: "old",
    complete: true,
  });
  s.putJson(
    projectKey(paths, "pending", "analysis-plan-pilot.json"),
    buildAnalysisPlan(loaded, "pilot"),
  );
  s.putJson(projectKey(paths, "state", "charts.json"), []);
  return loaded;
}

function snapshot(loaded: LoadedConfig): Map<string, string> {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const out = new Map<string, string>();
  for (const dir of ["reports", "pending", "state"])
    for (const k of s.list(projectKey(paths, dir))) {
      if (k.includes("/reports/defs/")) continue;
      const b = s.getBytes(k) ?? Buffer.alloc(0);
      out.set(k, createHash("sha256").update(b).digest("hex"));
    }
  return out;
}

test("migration lists every pilot and core run as versions; no existing file changes", async () => {
  const loaded = await project();
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const before = snapshot(loaded);
  const planHash = buildAnalysisPlan(loaded, "pilot").planHash;
  const latest = readLatest(paths, "pilot");
  const list = getReports(loaded).body as { reports: ReturnType<typeof listReports> };
  const pilot = list.reports.find((r) => r.id === "r-pilot");
  const core = list.reports.find((r) => r.id === "r-core");
  assert.equal(pilot?.name, "Pilot report");
  assert.equal(core?.name, "Full check report");
  assert.deepEqual(pilot?.competitorNames, ["Capybara Go", "Mini Tales"]);
  assert.deepEqual(
    pilot?.versions.map((v) => v.id),
    [RUNS.partial, RUNS.broken, RUNS.report, RUNS.md],
  );
  assert.deepEqual(
    pilot?.versions.map((v) => v.archived),
    [false, true, true, true],
  );
  assert.equal(pilot?.generatedAt, "2026-09-27T22:15:08.781Z");
  assert.deepEqual(
    core?.versions.map((v) => v.id),
    [RUNS.core],
  );
  assert.equal(pilot?.deletable, false);
  assert.equal(pilot?.status.text, "Partial: no recommendations written");
  assert.equal(pilot?.newer, "New or updated analyses since this version was made.");
  // Nothing moved or rewritten; the approval numbers and freshness pointers stay the same.
  assert.deepEqual(snapshot(loaded), before);
  assert.equal(buildAnalysisPlan(loaded, "pilot").planHash, planHash);
  assert.deepEqual(readLatest(paths, "pilot"), latest);
  // Idempotent: a second run writes nothing.
  const defs = s.getText(defKey(paths, "r-pilot"));
  assert.deepEqual(syncPresetReports(s, paths, US), []);
  assert.equal(s.getText(defKey(paths, "r-pilot")), defs);
});

test("an interrupted migration run again gives the same result, with no duplicates", async () => {
  const loaded = await project();
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  // Interrupted after the first def was written, with only one version in it.
  s.putJson(defKey(paths, "r-pilot"), {
    id: "r-pilot",
    name: "Pilot report",
    type: "pilot",
    scope: { type: "pilot", markets: [US], competitors: [], includeCharts: [] },
    createdAt: "2026-09-28T00:00:00.000Z",
    archived: false,
    versions: [{ id: RUNS.md, generatedAt: "2026-09-27T12:33:00.745Z", archived: false }],
  });
  syncPresetReports(s, paths, US);
  syncPresetReports(s, paths, US);
  const def = readDef(s, paths, "r-pilot");
  assert.equal(def?.versions.length, 4);
  assert.equal(new Set(def?.versions.map((v) => v.id)).size, 4);
  assert.equal(def?.versions.filter((v) => !v.archived).length, 1);
  assert.equal(
    listDefs(s, paths).filter((d) => d.type === "pilot").length,
    1,
    "no second Pilot report",
  );
  // Interrupted with every version listed but the archive flags not set: they are repaired.
  const all = readDef(s, paths, "r-pilot");
  s.putJson(defKey(paths, "r-pilot"), {
    ...all,
    versions: all?.versions.map((v) => ({ ...v, archived: false })).reverse(),
  });
  syncPresetReports(s, paths, US);
  const fixed = readDef(s, paths, "r-pilot");
  assert.deepEqual(
    fixed?.versions.map((v) => v.archived),
    [true, true, true, false],
  );
  assert.equal(fixed?.versions.at(-1)?.id, RUNS.partial);
});

test("old runs are shown as their markdown; broken or partial data never crashes", async () => {
  const loaded = await project();
  getReports(loaded);
  const read = (vid: string) =>
    getReportVersion(loaded, "r-pilot", vid).body as {
      data?: unknown;
      html?: string;
      note?: string;
      generatedAt?: string;
    };
  const md = read(RUNS.md);
  assert.match(md.html ?? "", /Core pilot result/);
  assert.match(md.html ?? "", /<img loading="lazy" src="\/images\/thumb\/a\.webp"/, "as today");
  assert.equal(md.generatedAt, "2026-09-27T12:33:00.745Z");
  assert.match(read(RUNS.broken).note ?? "", /incomplete/);
  assert.match(read(RUNS.broken).html ?? "", /broken data/);
  assert.match(read(RUNS.partial).html ?? "", /partial data/);
  const now = read("now");
  assert.ok(now.data, "the live report of the Pilot");
  assert.equal(getReportVersion(loaded, "r-pilot", "2026-01-01T00-00-00-000Z-pilot").status, 404);
  assert.equal(getReportVersion(loaded, "r-pilot", "current-pilot").status, 404);
  assert.equal(getReportVersion(loaded, "r-none", "now").status, 404);
  assert.equal(getReportVersion(loaded, "../x", "now").status, 404);
});
