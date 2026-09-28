import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFinalReport } from "../src/analysis/final-report.ts";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { projectPaths } from "../src/config/load.ts";
import { reportCommand } from "../src/reports/cli.ts";
import type { ReportSummary } from "../src/reports/list.ts";
import { addVersion, createReport, readDef, versionFileKey } from "../src/reports/store.ts";
import { postSelection } from "../src/server/api.ts";
import { startAppServer } from "../src/server/app-server.ts";
import { getReportVersion } from "../src/server/reports-api.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { openImageDb } from "../src/store/imagedb.ts";
import { newRunId } from "../src/store/manifest.ts";
import { outcome } from "./helpers/jobs.ts";
import { tempProject } from "./helpers/project.ts";

const TOKEN = "test-token";
const US = { gl: "us", hl: "en", label: "United States (English)" };

test("reports API: list, read, rename, archive, delete, with the page's token", async () => {
  const loaded = await tempProject({ "Capybara Go": { phone: 2, tablet: 0 } });
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const id = paths.projectId;
  const { server, origin } = await startAppServer({
    root: loaded.root,
    projects: [loaded],
    token: TOKEN,
  });
  const api = `${origin}/p/${id}/api/reports`;
  const write = (method: string, path: string, body: unknown, token = TOKEN) =>
    fetch(`${api}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "X-SSR-Token": token },
      body: JSON.stringify(body),
    });
  try {
    const list = (await (await fetch(api)).json()) as { reports: ReportSummary[] };
    assert.deepEqual(list.reports.map((r) => r.id).sort(), ["r-core", "r-pilot"]);
    assert.equal(list.reports.find((r) => r.id === "r-pilot")?.status.text, "Not run yet");
    const j = createReport(s, paths, {
      name: "Japan vs 1 competitor",
      type: "country",
      scope: { type: "country", markets: [US], competitors: [], includeCharts: [] },
    });
    const vid = `2026-09-28T10-00-00-000Z-${j.id}`;
    s.putText(versionFileKey(paths, vid, "report.md"), "# Japan <b>x</b>\n");
    addVersion(s, paths, j.id, { id: vid, generatedAt: "2026-09-28T10:00:00.000Z" });
    const v = await (await fetch(`${api}/${j.id}/versions/${vid}`)).json();
    assert.match(v.html, /Japan/);
    assert.equal((await fetch(`${api}/${j.id}/versions/now`)).status, 404);
    assert.equal((await fetch(`${api}/r-nope/versions/${vid}`)).status, 404);
    // Writes: the token is required, bodies are validated, unknown ids are 404.
    assert.equal((await write("PATCH", `/${j.id}`, { name: "x" }, "bad")).status, 403);
    assert.equal((await write("PATCH", `/${j.id}`, { name: 5 })).status, 400);
    assert.equal((await write("PATCH", `/${j.id}`, { other: 1 })).status, 400);
    assert.equal((await write("PATCH", "/r-nope", { name: "x" })).status, 404);
    assert.equal((await write("POST", `/${j.id}`, {})).status, 405);
    const renamed = await (await write("PATCH", `/${j.id}`, { name: "Japan only" })).json();
    assert.equal(renamed.name, "Japan only");
    await write("PATCH", `/${j.id}`, { archived: true });
    assert.equal(readDef(s, paths, j.id)?.archived, true);
    await write("PATCH", "/r-pilot", { archived: true });
    await write("PATCH", "/r-pilot", { archived: false });
    assert.equal(readDef(s, paths, "r-pilot")?.archived, false);
    const refused = await write("DELETE", "/r-pilot", {});
    assert.equal(refused.status, 409);
    assert.match(JSON.stringify(await refused.json()), /cannot be deleted/);
    assert.equal((await write("DELETE", `/${j.id}`, {})).status, 200);
    assert.equal(readDef(s, paths, j.id), null);
    assert.equal(s.exists(versionFileKey(paths, vid, "report.md")), false);
  } finally {
    server.close();
  }
});

test("each finished Pilot run is the newest version; the previous one is archived", async () => {
  const loaded = await tempProject({
    "Capybara Go": { phone: 2, tablet: 0 },
    "Mini Tales": { phone: 2, tablet: 0 },
  });
  postSelection(loaded, { coreCompetitors: ["Capybara Go", "Mini Tales"] });
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const plan = buildAnalysisPlan(loaded, "pilot");
  const first = newRunId("pilot", new Date("2026-09-27T10:00:00.000Z"));
  const second = newRunId("pilot", new Date("2026-09-28T10:00:00.000Z"));
  writeFinalReport(loaded, plan, outcome({ runId: first }), openImageDb(paths));
  writeFinalReport(loaded, plan, outcome({ runId: second }), openImageDb(paths));
  const def = readDef(s, paths, "r-pilot");
  assert.deepEqual(
    def?.versions.map((v) => [v.id, v.archived]),
    [
      [first, true],
      [second, false],
    ],
  );
  const v = s.getJson(versionFileKey(paths, second, "version.json")) as {
    reportId: string;
    pick: { name: string }[];
  };
  assert.equal(v.reportId, "r-pilot");
  assert.deepEqual(
    v.pick.map((g) => g.name),
    ["Rogue Legend", "Capybara Go", "Mini Tales"],
  );
  // The archived version stays readable.
  const old = getReportVersion(loaded, "r-pilot", first).body as {
    data?: unknown;
    archived: boolean;
  };
  assert.ok(old.data);
  assert.equal(old.archived, true);
  // npm run report -- "Pilot (United States, English)": a new version, no AI.
  const lines: string[] = [];
  assert.equal(
    reportCommand(loaded, "pilot (united states, english)", (l) => lines.push(l)),
    0,
  );
  assert.deepEqual(
    readDef(s, paths, "r-pilot")?.versions.map((x) => x.archived),
    [true, true, false],
  );
  assert.match(lines.join("\n"), /New version of "Pilot \(United States, English\)"/);
  assert.equal(
    reportCommand(loaded, "nothing like this", (l) => lines.push(l)),
    1,
  );
});
