import { defaultDeps, fitProblem } from "../analysis/job.ts";
import { buildAnalysisPlan, readSavedPlan, type Stage } from "../analysis/plan.ts";
import { describeAnalysisPlan } from "../analysis/report.ts";
import type { LoadedConfig } from "../config/load.ts";
import { enqueue } from "../jobs/index.ts";
import { ensureSameScreens } from "../reports/same-screen-run.ts";
import { confirm } from "../util/cli-io.ts";

/**
 * Shows the approval screen for a stage (no AI). The run starts only after explicit approval:
 * typing "yes" in a terminal, or --yes, which is accepted only if the batch is unchanged since
 * the approval screen was last shown (so --yes can never approve numbers nobody saw).
 */
export async function runAnalyzeStep(
  loaded: LoadedConfig,
  stage: Stage,
  opts: { yes: boolean; dryRun: boolean },
  log: (s: string) => void,
): Promise<boolean> {
  const guard = fitProblem(loaded, stage);
  if (guard) {
    log(guard);
    return false;
  }
  // "Same screen uploaded twice" (free, cached per pair): the plan reuses repeated screens.
  await ensureSameScreens(loaded);
  const previous = readSavedPlan(loaded, stage);
  if (opts.yes) {
    if (!previous) {
      log(
        "There is no approval screen for this batch yet. Run it once without --yes to see the numbers.",
      );
      return false;
    }
    const current = buildAnalysisPlan(loaded, stage);
    log(describeAnalysisPlan(current));
    return start(loaded, stage, previous.planHash, log);
  }
  const plan = buildAnalysisPlan(loaded, stage, { save: true });
  log(describeAnalysisPlan(plan));
  if (opts.dryRun || !process.stdin.isTTY) {
    log(
      "\nNo AI call was made. To approve, answer yes in Claude Code (/analyze), press Approve and run in the gallery (npm run gallery), or run this again with --yes.",
    );
    return true;
  }
  if (!(await confirm("\nApprove and run this batch?", false))) {
    log("Not approved. No AI call was made.");
    return false;
  }
  return start(loaded, stage, plan.planHash, log);
}

/** Runs the approved batch through the jobs module: the same AI lock as the page. */
async function start(
  loaded: LoadedConfig,
  stage: Stage,
  hash: string,
  log: (s: string) => void,
): Promise<boolean> {
  const r = enqueue(
    loaded,
    "analysis",
    { stage, planHash: hash },
    {
      depsFor: (onProgress) =>
        defaultDeps(loaded, (p) => {
          onProgress(p);
          log(`  ${p.message} (spent so far $${p.spentUsd.toFixed(2)})`);
        }),
    },
  );
  if (!r.ok) {
    log(r.problem);
    return false;
  }
  const job = await r.done;
  log(`${job.error ?? "Finished."}${job.report ? ` Report: ${job.report}` : ""}`);
  return job.state === "finished";
}
