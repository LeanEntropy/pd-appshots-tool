/**
 * Shared parts of the layout benchmark (docs/plan-layout-wireframes.md section 7). Everything
 * runs against a SCRATCH copy (BENCH_ROOT: configs/, taxonomies/ and a workspace/ holding
 * projects.json, the project's project.json, refs.json and run-config.json, and for the 4 images
 * their library/analysis records, producer answers, facts, originals and model copies); nothing is
 * written to the real workspace. Paid calls share one spending record (spend.json) with a hard $1.20 cap.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ledger } from "../../src/analysis/budget.ts";
import type { CallContext, CallLog } from "../../src/analysis/call.ts";
import { type LoadedConfig, loadTaxonomy } from "../../src/config/load.ts";
import { loadProject } from "../../src/config/project.ts";
import { workspaceStorage } from "../../src/storage/index.ts";

export const REPO = resolve(import.meta.dirname, "..", "..");
export const BENCH_ROOT = process.env.BENCH_ROOT ?? "";
export const OUT = process.env.BENCH_OUT ?? join(REPO, "docs", "samples", "layout-benchmark");
/** User decision D1 (2026-09-29): hard stop for the whole benchmark, retries included. */
export const CAP_USD = 1.2;
export const PROJECT = "rogue-legend";

/** The 4 images with an agent breakdown (the answer key), by name. */
export const IMAGES: { name: string; id: string; why: string }[] = [
  {
    name: "archero2-4",
    id: "b799e91aee76927b805be9c807e1892ea169d45aadc645dbc29608176b35ba21",
    why: "UI screen (hero hub) with a tilted corner band and a hero cut-out",
  },
  {
    name: "roguelegend-1",
    id: "ddd7f0710af668e6ed7d088a2e010a8704b1b3a34b6500f2de30c5f9a8dea732",
    why: "ours: full-screen key art with a logo only",
  },
  {
    name: "legend-of-mushroom-3",
    id: "ce1c0012193fae117746075beee7b27af321fd86e732f5610ffc2837d938545b",
    why: "landscape: one capture inside marketing art, cut-outs",
  },
  {
    name: "survivorio-jp-4",
    id: "9890be41062c557eb4ac1b6261516a3d47acc9c41009f68aca3302b930c01ce7",
    why: "text-heavy Japanese image with tilted bands",
  },
];

export function need(): void {
  if (!BENCH_ROOT) throw new Error("Set BENCH_ROOT to the scratch copy (see the top of this file).");
  const root = resolve(BENCH_ROOT).toLowerCase();
  const forbidden = [REPO, resolve(REPO, "..", "..", "..")].map((p) => resolve(p).toLowerCase());
  if (forbidden.includes(root)) throw new Error("BENCH_ROOT must be a scratch copy.");
  mkdirSync(OUT, { recursive: true });
}

export function load(): LoadedConfig {
  const loaded = loadProject(PROJECT, { root: BENCH_ROOT });
  // Review is paused: the benchmark measures the producer call only.
  loaded.config.review.enabled = false;
  return loaded;
}

interface Spend {
  usd: number;
  calls: CallLog[];
}

export function readSpend(name = "spend.json"): Spend {
  const f = join(OUT, name);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Spend) : { usd: 0, calls: [] };
}

/**
 * A call context whose answers go to the scratch store and whose spend is capped across runs.
 * Ceiling $0.45 per call (production reserves $0.40), never more than what is left under the cap.
 */
export function benchContext(
  loaded: LoadedConfig,
  cap = CAP_USD,
  spendFile = "spend.json",
  oneAtATime = false,
): CallContext {
  const spend = readSpend(spendFile);
  const left = cap - spend.usd;
  if (left <= 0.2) throw new Error(`Benchmark cap reached: $${spend.usd.toFixed(2)} spent.`);
  // Never more than what is left under the cap (the last call may reserve a little less).
  const ceiling = Math.min(0.45, Math.floor((left - 0.005) * 100) / 100);
  const store = workspaceStorage(join(BENCH_ROOT, "workspace"));
  const { taxonomy, hash } = loadTaxonomy(loaded);
  let spent = 0;
  // One at a time: each call reserves everything left (the CLI budget is at most $0.45).
  const book = ledger(left, () => spent, oneAtATime ? {} : { "full-analysis": ceiling });
  const save = () => writeFileSync(join(OUT, spendFile), JSON.stringify(spend, null, 1));
  return {
    storage: store,
    answerKey: (step, key) => `library/objects/${step}-layout-bench/${key}.json`,
    taxonomy,
    taxonomyHash: hash,
    maxBudgetUsd: ceiling,
    remainingUsd: book.remaining,
    timeoutMs: 600_000,
    onCost: (u) => {
      spent += u;
      spend.usd = Math.round((spend.usd + u) * 10000) / 10000;
      save();
    },
    reserve: book.reserve,
    onCall: (c) => {
      spend.calls.push(c);
      save();
    },
  };
}

export function writeOut(name: string, data: unknown): void {
  writeFileSync(join(OUT, name), `${JSON.stringify(data, null, 1)}\n`);
}

export function readOut<T>(name: string): T | null {
  const f = join(OUT, name);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : null;
}
