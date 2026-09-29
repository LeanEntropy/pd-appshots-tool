import type { CallLog, StoredObject } from "../analysis/call.ts";
import type { ProjectPaths } from "../config/load.ts";
import { libraryKey, projectKey, workspaceStorage } from "../storage/index.ts";
import { LAYOUT_STEP } from "./call.ts";
import { LAYOUT_USD_PER_IMAGE } from "./vocab.ts";

/** A layout run's log (runs/<run id>/layout.json): every call, and every image's outcome. */
export const LAYOUT_RUN_LOG = "layout.json";

/** Fewer recorded calls than this: the planned constant is used instead. */
const MIN_SAMPLES = 10;

export interface LayoutCostModel {
  /** Typical and high cost of ONE image's layout, retries and failed attempts included. */
  perImage: [number, number];
  /** Median and 90th percentile of one call. */
  perCall: [number, number];
  /** Calls per image (1 plus the repair attempts and failed images' calls). */
  callsPerImage: number;
  samples: number;
  /** Plain words: where the numbers come from. */
  basis: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[i] as number;
}

/** Every layout call the project's runs recorded (layout runs and analysis runs alike). */
export function recordedLayoutCalls(paths: ProjectPaths): CallLog[] {
  const storage = workspaceStorage(paths.workspace);
  const out: CallLog[] = [];
  for (const run of storage.children(projectKey(paths, "runs"))) {
    for (const file of [LAYOUT_RUN_LOG, "manifest.json", "calls.json"]) {
      const v = storage.getJson(projectKey(paths, "runs", run, file)) as
        | { calls?: CallLog[] }
        | undefined;
      const list = Array.isArray(v?.calls) ? v.calls : [];
      for (const c of list) if (c?.step === LAYOUT_STEP && Array.isArray(c.imageIds)) out.push(c);
    }
  }
  return out;
}

/**
 * The saved layout answers, for projects whose runs recorded no layout calls yet: each answer's
 * last call cost, and its attempts (repairs) as the calls it took. Failed images left no answer.
 */
function storedAnswers(paths: ProjectPaths): { costs: number[]; calls: number } {
  const storage = workspaceStorage(paths.workspace);
  const dir = paths.library
    ? libraryKey("objects", LAYOUT_STEP)
    : projectKey(paths, "objects", LAYOUT_STEP);
  const costs: number[] = [];
  let calls = 0;
  for (const name of storage.children(dir)) {
    const o = storage.getJson(`${dir}/${name}`) as Partial<StoredObject> | undefined;
    if (typeof o?.costUsd !== "number") continue;
    const tries = Math.max(1, o.attempts ?? 1);
    // spentUsd (newer answers) covers every attempt; older ones kept only the last call.
    costs.push(typeof o.spentUsd === "number" ? o.spentUsd / tries : o.costUsd);
    calls += tries;
  }
  return { costs, calls };
}

/**
 * What a layout really costs, from what was spent before: the median and 90th percentile of the
 * recorded calls, times the calls an image took on average (repairs and failed images included).
 * Falls back to the saved answers, then to the planned constant.
 */
export function layoutCostModel(paths: ProjectPaths): LayoutCostModel {
  const logged = recordedLayoutCalls(paths);
  const paid = logged.map((c) => c.costUsd).filter((u): u is number => typeof u === "number");
  let costs: number[];
  let calls: number;
  let images: number;
  let from: string;
  if (paid.length >= MIN_SAMPLES) {
    costs = paid;
    calls = logged.length;
    images = new Set(logged.map((c) => c.imageIds.join(","))).size;
    from = `${calls} recorded layout calls`;
  } else {
    const s = storedAnswers(paths);
    costs = s.costs;
    calls = s.calls;
    images = s.costs.length;
    from = `${images} saved layouts`;
  }
  if (costs.length < MIN_SAMPLES || !images) {
    const [lo, hi] = LAYOUT_USD_PER_IMAGE;
    return {
      perImage: [lo, hi],
      perCall: [lo, hi],
      callsPerImage: 1,
      samples: costs.length,
      basis: "planned cost (too few layouts recorded yet)",
    };
  }
  const sorted = [...costs].sort((a, b) => a - b);
  const perCall: [number, number] = [quantile(sorted, 0.5), quantile(sorted, 0.9)];
  const callsPerImage = Math.max(1, calls / images);
  const perImage: [number, number] = [
    round2(perCall[0] * callsPerImage),
    round2(perCall[1] * callsPerImage),
  ];
  return {
    perImage,
    perCall,
    callsPerImage: Math.round(callsPerImage * 100) / 100,
    samples: costs.length,
    basis: `from ${from}: $${perCall[0].toFixed(2)} typical, $${perCall[1].toFixed(2)} high per call, ${callsPerImage.toFixed(2)} calls per image (second attempts included)`,
  };
}
