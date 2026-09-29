import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readLatest } from "../src/analysis/final-report.ts";
import { approvalProblem } from "../src/analysis/job.ts";
import { orderHistory } from "../src/analysis/orders.ts";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { isUsable, readRecords } from "../src/analysis/records.ts";
import { runAnalysis } from "../src/analysis/run.ts";
import { projectPaths } from "../src/config/load.ts";
import { savePick } from "../src/core/selection.ts";
import { getReportCurrent, getReportRun } from "../src/server/report-api.ts";
import { fakeProvider } from "./helpers/fake-provider.ts";
import { tempProject } from "./helpers/project.ts";

const DECKS = {
  "Archero 2": { phone: 3, tablet: 0 },
  "Capybara Go": { phone: 2, tablet: 0 },
  "Mini Tales": { phone: 1, tablet: 0 },
  Heroll: { phone: 1, tablet: 0 },
  Dicero: { phone: 1, tablet: 0 },
};
const PICK = [
  "com.xq.archeroii",
  "com.habby.capybara",
  "com.loadcomplete.minitales",
  "com.percent.aos.rollinghero",
  "com.bailing.lark.roll.dev",
];
const good = () => fakeProvider({ read: () => ({ screenType: "gameplay", headline: "FIGHT" }) });

async function setup() {
  const loaded = await tempProject(DECKS);
  savePick(loaded, PICK, "cli");
  return loaded;
}

function deps(p = good(), writer = good(), reviewSeverity?: "major" | "minor") {
  const reviewer = fakeProvider({
    family: "openai",
    read: () => ({ screenType: "gameplay", headline: "FIGHT" }),
    ...(reviewSeverity ? { reviewSeverity } : {}),
  });
  return {
    producer: p,
    reviewer,
    adjudicator: good(),
    writer,
    recommendationReviewer: reviewer,
    onProgress: () => {},
  };
}

test("an all-failing batch stops early, and the failed images are retried next time", async () => {
  const loaded = await setup();
  // One call at a time: exactly the old behaviour (the parallel case is in analysis-pool.test).
  loaded.config.options.speed.parallelCalls = 1;
  const plan = buildAnalysisPlan(loaded, "pilot");
  const broken = good();
  broken.call = async (c) => {
    broken.calls.push(c);
    return { ok: false, output: null, costUsd: null, error: "--json-schema is not valid JSON" };
  };
  const out = await runAnalysis(loaded, plan, deps(broken));
  assert.match(out.aborted ?? "", /3 images in a row failed with the same error/);
  assert.equal(out.records.length, 3);
  assert.equal(broken.calls.length, 3 * 2, "a failed call is retried once, then given up");
  assert.ok(out.errors.every((e) => /json-schema/.test(e.message)));
  assert.ok(existsSync(out.report), "a report is written even for a stopped batch");

  // failed is not done: the same 8 images are offered again, and all run.
  const again = buildAnalysisPlan(loaded, "pilot", { save: true });
  assert.equal(again.counts.full, 8);
  assert.equal(approvalProblem(again, again, again.planHash), null);
  const ok = await runAnalysis(loaded, again, deps());
  assert.equal(ok.aborted, null);
  assert.equal(ok.records.filter(isUsable).length, 8);
});

test("results are saved per image; a resumed run skips what is done", async () => {
  const loaded = await setup();
  const plan = buildAnalysisPlan(loaded, "pilot");
  const flaky = good();
  const inner = flaky.call.bind(flaky);
  let n = 0;
  flaky.call = async (c) => {
    n++;
    if (n === 3 || n === 4) {
      flaky.calls.push(c);
      return { ok: false, output: null, costUsd: null, error: "timed out" };
    }
    return inner(c);
  };
  const out = await runAnalysis(loaded, plan, deps(flaky));
  assert.equal(out.records.filter((r) => r.status === "failed").length, 1);
  assert.match(out.synthesisSkipped ?? "", /1 screenshots have no usable analysis/);
  assert.equal(readRecords(projectPaths(loaded)).size, 8);

  // The approved plan is replayed as if interrupted: only the missing image calls the model.
  const p2 = good();
  const out2 = await runAnalysis(loaded, plan, deps(p2));
  assert.equal(p2.calls.length, 1);
  assert.equal(out2.synthesisSkipped, null);
});

test("patterns, ours vs patterns, recommendations, review and the final report", async () => {
  const loaded = await setup();
  const paths = projectPaths(loaded);
  const plan = buildAnalysisPlan(loaded, "pilot");
  const writer = good();
  const out = await runAnalysis(loaded, plan, deps(good(), writer));
  assert.ok(out.patterns && out.oursVs && out.synthesis?.recommendations);
  assert.equal(out.patterns.perPosition[0]?.top?.key, "gameplay");
  assert.equal(out.oursVs.positions[0]?.verdict, "following");
  assert.equal(out.synthesis.review?.verdict, "ok");
  assert.equal(writer.calls.length, 2, "pattern summary + recommendations");
  const md = readFileSync(out.report, "utf8");
  for (const h of [
    "## 1. Summary: the bottom line",
    "### A/B tests to run next",
    "## Contents",
    "## 2. Patterns across competitors",
    "## 3. Position by position",
    "## 4. Recommendations",
    "## 5. A/B test details",
    "## 6. Store text and keywords",
    "## 7. Detailed statistics",
  ])
    assert.ok(md.includes(h), h);
  assert.ok(md.indexOf("## 1. Summary") < md.indexOf("## Contents"), "bottom line first");
  assert.match(md, /\*\*Verdict: our deck is /);
  assert.ok(md.indexOf("## 3. Position by position") < md.indexOf("## 4. Recommendations"));
  const dir = join(paths.reports, out.runId);
  for (const f of [
    "patterns.json",
    "ours-vs.json",
    "recommendations.json",
    "review.json",
    "report-data.json",
  ])
    assert.ok(existsSync(join(dir, f)), f);
  const rec = readRecords(paths).get(out.records[0]?.imageId ?? "");
  assert.equal(rec?.identity?.game, "Rogue Legend");
  assert.equal(rec?.identity?.appId, "com.pockethaven.roguelegend");
  assert.match(rec?.identity?.files.original?.relative ?? "", /^images\/orig\/[0-9a-f]{64}\.png$/);
  assert.equal(rec?.identity?.files.original?.exists, true);
  assert.equal(rec?.identity?.files.model.exists, true);
  assert.deepEqual(
    rec?.identity?.appearances.map((a) => a.gl),
    ["us"],
  );
  assert.match(rec?.identity?.storePage ?? "", /id=com\.pockethaven\.roguelegend&gl=us&hl=en/);
  assert.match(rec?.taxonomy ?? "", /^mobile-rpg@3/);
  const hist = orderHistory(paths, "com.xq.archeroii", "us", "en");
  assert.equal(hist.length, 1);
  assert.equal(hist[0]?.derived?.complete, true);
  assert.equal(hist[0]?.derived?.positions[0]?.screenType, "gameplay");

  // Nothing new and the report is current: the batch has nothing to do.
  assert.equal(readLatest(paths, "pilot")?.complete, true);
  const again = buildAnalysisPlan(loaded, "pilot");
  assert.equal(again.synthesisNeeded, false);
  assert.match(approvalProblem(again, again, again.planHash) ?? "", /already/);

  const cur = getReportCurrent(loaded, "pilot").body as {
    data: { synthesis: { state: string }; games: { rows: unknown[] }[]; ai: { current: boolean } };
    runs: { runId: string; hasData: boolean }[];
  };
  assert.equal(cur.data.synthesis.state, "current");
  assert.equal(cur.data.ai.current, true);
  assert.deepEqual(
    cur.data.games.map((g) => g.rows.length),
    [3, 3, 2],
  );
  assert.equal(cur.runs[0]?.runId, out.runId);
  assert.equal(cur.runs[0]?.hasData, true);
  assert.equal(getReportRun(loaded, "pilot", "../../etc").status, 404);
  // An older run without saved data is shown from its markdown.
  rmSync(join(dir, "report-data.json"));
  const old = getReportRun(loaded, "pilot", out.runId).body as { html: string };
  assert.match(old.html, /<h3>4\. Recommendations<\/h3>/);
  assert.match(old.html, /class="info" data-info="[0-9a-f]{64}"/);
  assert.doesNotMatch(old.html, /\.\.\/\.\.\/images/);
});

test("a major finding in the recommendation check leads to one revision", async () => {
  const loaded = await setup();
  const plan = buildAnalysisPlan(loaded, "pilot");
  const writer = good();
  const out = await runAnalysis(loaded, plan, deps(good(), writer, "major"));
  assert.equal(writer.calls.length, 3);
  assert.ok(out.synthesis?.draft);
  // Facts first (shared with the first draft, so the prompt cache serves them), instruction last.
  const [draft, revision] = [writer.calls[1]?.prompt ?? "", writer.calls[2]?.prompt ?? ""];
  assert.match(revision, /\n\nRevise your recommendations\. [^]*$/);
  const shared = draft.slice(0, draft.indexOf("\n\nInterpretation:"));
  assert.ok(shared.length > 1000 && revision.startsWith(shared), "the revision starts like the draft");
});
