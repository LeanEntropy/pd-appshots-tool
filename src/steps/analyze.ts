import { defaultDeps, runApproved } from "../analysis/job.ts";
import { buildAnalysisPlan, readSavedPlan, type Stage } from "../analysis/plan.ts";
import { describeAnalysisPlan } from "../analysis/report.ts";
import type { LoadedConfig } from "../config/load.ts";
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

async function start(
  loaded: LoadedConfig,
  stage: Stage,
  hash: string,
  log: (s: string) => void,
): Promise<boolean> {
  const r = await runApproved(loaded, stage, hash, (setState) =>
    defaultDeps(loaded, (p) => {
      setState(p);
      log(`  ${p.message} (spent so far $${p.spentUsd.toFixed(2)})`);
    }),
  );
  log(r.message);
  return r.ok;
}
