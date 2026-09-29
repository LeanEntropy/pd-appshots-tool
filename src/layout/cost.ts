import type { CallLog, StoredObject } from "../analysis/call.ts";
import { readRecords } from "../analysis/records.ts";
import type { ProjectPaths } from "../config/load.ts";
import { libraryKey, projectKey, workspaceStorage } from "../storage/index.ts";
import { LAYOUT_STEP } from "./call.ts";
import { readLayoutFile } from "./store.ts";
import { LAYOUT_CONTRACT, LAYOUT_USD_PER_IMAGE } from "./vocab.ts";

/** A layout run's log (runs/<run id>/layout.json): every call, and every image's outcome. */
export const LAYOUT_RUN_LOG = "layout.json";

/** Fewer recorded calls than this: the planned constant is used instead. */
const MIN_SAMPLES = 10;

export interface LayoutCostModel {
  /**
   * Typical and high cost of ONE image's layout: what was spent per image tried, and per image
   * saved (the money spent on failed images counted against the ones that worked).
   */
  perImage: [number, number];
  /** Median and 90th percentile of one call. */
  perCall: [number, number];
  /** Calls per image tried (1 plus the repair attempts and failed images' calls). */
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

/**
 * Every layout call of today's layout contract the project's runs recorded (layout runs and
 * analysis runs alike): an older contract asked for less and cost less, so it never counts.
 */
export function recordedLayoutCalls(paths: ProjectPaths): CallLog[] {
  const storage = workspaceStorage(paths.workspace);
  const out: CallLog[] = [];
  // A run may keep the same call in more than one of its files: each call counts once.
  const seen = new Set<string>();
  for (const run of storage.children(projectKey(paths, "runs"))) {
    for (const file of [LAYOUT_RUN_LOG, "manifest.json", "calls.json"]) {
      const v = storage.getJson(projectKey(paths, "runs", run, file)) as
        | { calls?: CallLog[] }
        | undefined;
      const list = Array.isArray(v?.calls) ? v.calls : [];
      for (const c of list) {
        if (c?.step !== LAYOUT_STEP || c.contract !== LAYOUT_CONTRACT) continue;
        const id = `${run}|${c.key}|${c.at}`;
        if (!Array.isArray(c.imageIds) || seen.has(id)) continue;
        seen.add(id);
        out.push(c);
      }
    }
  }
  return out;
}

/** The saved layouts of today's contract: image id to the cached answer it was read from. */
function currentLayouts(paths: ProjectPaths): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of readRecords(paths).values()) {
    const f = readLayoutFile(paths, r);
    if (f?.contract === LAYOUT_CONTRACT && typeof f.object === "string")
      out.set(r.imageId, f.object);
  }
  return out;
}

/**
 * For projects whose runs recorded no layout calls yet: what each saved answer of today's
 * contract cost, all its attempts together (older answers kept only the last call, so it is
 * that times the attempts). Failed images left no answer, so their cost is not seen here.
 */
function storedAnswers(
  paths: ProjectPaths,
  current: Set<string>,
): { costs: number[]; perCall: number[]; calls: number } {
  const storage = workspaceStorage(paths.workspace);
  const dir = paths.library
    ? libraryKey("objects", LAYOUT_STEP)
    : projectKey(paths, "objects", LAYOUT_STEP);
  const costs: number[] = [];
  const perCall: number[] = [];
  let calls = 0;
  for (const name of storage.children(dir)) {
    const o = storage.getJson(`${dir}/${name}`) as Partial<StoredObject> | undefined;
    if (typeof o?.costUsd !== "number" || typeof o.key !== "string" || !current.has(o.key))
      continue;
    const tries = Math.max(1, o.attempts ?? 1);
    costs.push(typeof o.spentUsd === "number" ? o.spentUsd : o.costUsd * tries);
    perCall.push(o.costUsd);
    calls += tries;
  }
  return { costs, perCall, calls };
}

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

/**
 * What a layout really costs, from what was spent before on today's contract: the recorded
 * calls' total per image tried (typical) and per image saved (high, at least 10% above).
 * Falls back to the saved answers (which cannot see failed images, so never below the planned
 * cost), then to the planned constant.
 */
export function layoutCostModel(paths: ProjectPaths): LayoutCostModel {
  const [lo, hi] = LAYOUT_USD_PER_IMAGE;
  const layouts = currentLayouts(paths);
  const logged = recordedLayoutCalls(paths);
  const paid = logged.map((c) => c.costUsd ?? 0);
  const tried = new Set(logged.map((c) => c.imageIds.join(",")));
  if (logged.length >= MIN_SAMPLES && tried.size) {
    const spent = paid.reduce((s, u) => s + u, 0);
    const saved = [...tried].filter((id) => layouts.has(id)).length;
    const typical = spent / tried.size;
    const high = Math.max(typical * 1.1, saved ? spent / saved : 0);
    const sorted = [...paid].sort((a, b) => a - b);
    return {
      perImage: [round2(typical), round2(high)],
      perCall: [round2(quantile(sorted, 0.5)), round2(quantile(sorted, 0.9))],
      callsPerImage: round2(logged.length / tried.size),
      samples: logged.length,
      basis: `from ${logged.length} recorded layout calls on ${tried.size} images ($${spent.toFixed(2)}; ${saved} saved): $${typical.toFixed(2)} per image tried, $${high.toFixed(2)} per image saved`,
    };
  }
  const s = storedAnswers(paths, new Set(layouts.values()));
  if (s.costs.length >= MIN_SAMPLES) {
    const typical = Math.max(mean(s.costs), lo);
    const sorted = [...s.perCall].sort((a, b) => a - b);
    return {
      perImage: [round2(typical), round2(Math.max(typical * 1.1, hi))],
      // Only each answer's last call is known: the high end is never below the planned one.
      perCall: [round2(quantile(sorted, 0.5)), round2(Math.max(quantile(sorted, 0.9), hi))],
      callsPerImage: round2(s.calls / s.costs.length),
      samples: s.costs.length,
      basis: `from ${s.costs.length} saved layouts ($${mean(s.costs).toFixed(2)} each; failed images are not seen there, so not below the last run's $${lo.toFixed(2)} to $${hi.toFixed(2)})`,
    };
  }
  return {
    perImage: [lo, hi],
    perCall: [lo, hi],
    callsPerImage: 1,
    samples: s.costs.length,
    basis: "planned cost (too few layouts recorded yet)",
  };
}
