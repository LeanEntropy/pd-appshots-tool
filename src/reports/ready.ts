import { readLatest } from "../analysis/final-report.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import { runFolders, versionFileKey } from "./store.ts";

export interface PresetOutcome {
  /** A Ready version with its recommendations written exists (plan-reports D1). */
  ready: boolean;
  /** The verdict and fit score of that same ready version, when it saved its report data. */
  verdict: string | null;
  score: number | null;
}

/**
 * How far the Pilot or the Full check got, from its saved versions: ready when the latest pointer
 * says complete or any saved version of that stage has its recommendations. Newer data after that
 * is the report's "Newer data" badge, not a step back. Read only: nothing is written.
 */
export function presetOutcome(loaded: LoadedConfig, stage: "pilot" | "core"): PresetOutcome {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const mine = [...runFolders(s, paths)]
    .filter(([id]) => id.endsWith(`-${stage}`))
    .sort(([a], [b]) => b.localeCompare(a));
  // One coherent version: the newest with its recommendations, else the complete latest run.
  const latest = readLatest(paths, stage);
  const done =
    mine.find(([, f]) => f.has("recommendations.json"))?.[0] ??
    (latest?.complete ? latest.runId : undefined);
  const ready = done !== undefined;
  let verdict: string | null = null;
  let score: number | null = null;
  if (done && mine.some(([id, f]) => id === done && f.has("report-data.json")))
    try {
      const d = s.getJson(versionFileKey(paths, done, "report-data.json")) as {
        fit?: { verdict?: unknown; score?: unknown } | null;
      };
      if (typeof d?.fit?.verdict === "string") verdict = d.fit.verdict;
      if (typeof d?.fit?.score === "number") score = d.fit.score;
    } catch {
      // An unreadable version has no verdict to show.
    }
  return { ready, verdict, score };
}
