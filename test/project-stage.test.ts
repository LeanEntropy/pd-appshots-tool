import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPaths } from "../src/config/load.ts";
import { projectState } from "../src/projects/state.ts";
import { postAnalysisPlan, postAnalysisRun, postSelection } from "../src/server/api.ts";
import { projectKey, workspaceStorage } from "../src/storage/index.ts";
import { quickRun, settle } from "./helpers/jobs.ts";
import { tempProject } from "./helpers/project.ts";

const FIVE = {
  "Capybara Go": { phone: 2, tablet: 0 },
  "Mini Tales": { phone: 2, tablet: 0 },
  Heroll: { phone: 2, tablet: 0 },
  Dicero: { phone: 2, tablet: 0 },
  "Archero 2": { phone: 2, tablet: 0 },
};

async function project() {
  const loaded = await tempProject(FIVE);
  postSelection(loaded, { coreCompetitors: Object.keys(FIVE) });
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  // A finished run: its folder with recommendations, and the latest pointer (as the runs write).
  const finished = (runId: string, stage: "pilot" | "core") => {
    s.putText(projectKey(paths, "reports", runId, "report.md"), "# report\n");
    s.putJson(projectKey(paths, "reports", runId, "recommendations.json"), { positions: [] });
    s.putJson(projectKey(paths, "reports", runId, "report-data.json"), {
      fit: { verdict: "on par", score: 0.8 },
    });
    s.putJson(projectKey(paths, "reports", `latest-${stage}.json`), {
      runId,
      file: "",
      createdAt: "",
      // Written from other data than the current analyses: "Newer data", not a step back.
      dataHash: "older",
      complete: true,
    });
  };
  return { loaded, finished };
}

const states = (s: ReturnType<typeof projectState>) => s.steps.map((x) => `${x.label}:${x.state}`);

test("stage from the saved reports: a Pilot report with recommendations moves on to the Core check", async () => {
  const { loaded, finished } = await project();
  assert.equal(projectState(loaded).stage, "pilot");
  finished("2026-09-27T22-29-48-097Z-pilot", "pilot");
  const s = projectState(loaded);
  assert.equal(s.stage, "core");
  assert.ok(states(s).includes("Pilot:done"));
});

test("regression: a finished Full check completes every step, even with newer data for the Pilot", async () => {
  const { loaded, finished } = await project();
  finished("2026-09-27T22-29-48-097Z-pilot", "pilot");
  finished("2026-09-28T16-21-48-545Z-core", "core");
  const s = projectState(loaded);
  assert.equal(s.stage, "recommendations");
  assert.deepEqual(states(s), [
    "Settings:done",
    "Download:done",
    "Pick competitors:done",
    "Pilot:done",
    "Core check:done",
    "Recommendations:done",
  ]);
  assert.equal(s.line, "Full check done: on par (80%)");
  assert.equal(s.next.label, "Create a report");
  assert.match(s.next.href, /#report$/);
});

test("the home line uses one version: the newest with recommendations, not a newer partial one", async () => {
  const { loaded, finished } = await project();
  finished("2026-09-28T16-21-48-545Z-core", "core");
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const partial = "2026-09-29T10-00-00-000Z-core";
  s.putText(projectKey(paths, "reports", partial, "report.md"), "# stopped\n");
  s.putJson(projectKey(paths, "reports", partial, "report-data.json"), {
    fit: { verdict: "very different", score: 0.2 },
  });
  assert.equal(projectState(loaded).line, "Full check done: on par (80%)");
});

test("when a run ends, the caller is told (the home card's summary is refreshed)", async () => {
  const { loaded } = await project();
  const plan = postAnalysisPlan(loaded, { stage: "pilot" }).body as { plan: { planHash: string } };
  let ended = 0;
  const r = postAnalysisRun(
    loaded,
    { stage: "pilot", planHash: plan.plan.planHash },
    { ...quickRun, onEnd: () => ended++ },
  );
  assert.equal(r.status, 202);
  await settle(loaded);
  await new Promise((done) => setImmediate(done));
  assert.equal(ended, 1);
});

test("a Full check version with recommendations counts even without the latest pointer", async () => {
  const { loaded } = await project();
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const run = "2026-09-28T16-21-48-545Z-core";
  s.putText(projectKey(paths, "reports", run, "report.md"), "# report\n");
  s.putJson(projectKey(paths, "reports", run, "recommendations.json"), { positions: [] });
  assert.equal(projectState(loaded).stage, "recommendations");
});
