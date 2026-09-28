import type { RunDeps, RunOutcome } from "../../src/analysis/run.ts";
import { type LoadedConfig, projectPaths } from "../../src/config/load.ts";
import type { RunnerOptions } from "../../src/jobs/index.ts";
import { running } from "../../src/jobs/runner.ts";
import { fakeProvider } from "./fake-provider.ts";

export function outcome(over: Partial<RunOutcome> = {}): RunOutcome {
  return {
    runId: "2026-01-01T00-00-00-000Z-pilot",
    records: [],
    spentUsd: 0,
    stoppedForBudget: false,
    cancelled: false,
    aborted: null,
    errors: [],
    patterns: null,
    oursVs: null,
    synthesis: null,
    synthesisSkipped: null,
    report: "",
    ...over,
  };
}

/** Fake model providers (no model is ever called in tests). */
export function fakeDeps(onProgress: RunDeps["onProgress"], costUsd = 0.1): RunDeps {
  const read = () => ({ screenType: "gameplay", headline: "EPIC BOSS FIGHTS!" });
  return {
    producer: fakeProvider({ model: "claude-fable-5-1", read, costUsd }),
    reviewer: null,
    adjudicator: fakeProvider({ model: "claude-opus-5-5", read, costUsd }),
    onProgress,
  };
}

/** A run that does nothing and finishes at once. */
export const quickRun: RunnerOptions = {
  run: async () => outcome(),
  depsFor: (cb) => fakeDeps(cb),
};

/** Waits for this project's job in this process to end. */
export async function settle(loaded: LoadedConfig): Promise<void> {
  await running.get(projectPaths(loaded).projectId)?.done;
}
