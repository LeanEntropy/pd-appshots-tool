/**
 * Shared parts of the speed benchmark (docs/plan-analysis-speed.md section 9). Everything runs
 * against a SCRATCH copy of the workspace (BENCH_ROOT/workspace); nothing is written to the real
 * workspace. Paid calls share one spending record (spend.json) with a hard cap.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ledger } from "../../src/analysis/budget.ts";
import type { CallContext, CallLog } from "../../src/analysis/call.ts";
import { type AnalysisRecord, readRecord } from "../../src/analysis/records.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../../src/config/load.ts";
import { loadProject } from "../../src/config/project.ts";
import { workspaceStorage } from "../../src/storage/index.ts";

export const REPO = resolve(import.meta.dirname, "..", "..");
export const BENCH_ROOT = process.env.BENCH_ROOT ?? "";
export const OUT = process.env.BENCH_OUT ?? "";
export const CAP_USD = 3;
export const PROJECT = "rogue-legend";

/** The 10 already-analysed images (stratified, plan section 9), by id prefix. */
export const IMAGES: { prefix: string; why: string }[] = [
  { prefix: "704abf82ee", why: "ours (Rogue Legends US #4), three captures" },
  { prefix: "7faff58709", why: "ours (Rogue Legends US #2), heavy band, settled earlier" },
  { prefix: "afd912586a", why: "multi-capture composite (portrait)" },
  { prefix: "50643e8866", why: "multi-capture composite (landscape)" },
  { prefix: "f2b013c413", why: "full-screen art: title with logo (Archero 2 #1)" },
  { prefix: "98742f3c3a", why: "full-screen art: feature art (Capybara Go #2)" },
  { prefix: "ce1c001219", why: "landscape, capture in marketing art" },
  { prefix: "dd853ada50", why: "Japanese text (Rogue Legends Japan #3), three captures" },
  { prefix: "a09e24ef3b", why: "Japanese text (Capybara Go Japan #1)" },
  { prefix: "fe87b878fc", why: "gameplay with three bands (Survivor.io #4)" },
];

export function need(): void {
  if (!BENCH_ROOT || !OUT) throw new Error("Set BENCH_ROOT (scratch copy) and BENCH_OUT.");
  // Never the real workspace: the repo root, or the main checkout above a worktree.
  const root = resolve(BENCH_ROOT).toLowerCase();
  const forbidden = [REPO, resolve(REPO, "..", "..", "..")].map((p) => resolve(p).toLowerCase());
  if (forbidden.includes(root)) throw new Error("BENCH_ROOT must be a scratch copy.");
  mkdirSync(OUT, { recursive: true });
}

export function load(): LoadedConfig {
  const loaded = loadProject(PROJECT, { root: BENCH_ROOT });
  // Review is paused; the benchmark measures the producer only (both arms).
  loaded.config.review.enabled = false;
  return loaded;
}

export function fullIds(loaded: LoadedConfig): string[] {
  const paths = projectPaths(loaded);
  const dir = join(paths.workspace, "_library", "analysis");
  const all = readdirNames(dir);
  return IMAGES.map((i) => {
    const id = all.find((x) => x.startsWith(i.prefix));
    if (!id) throw new Error(`image ${i.prefix} not found`);
    return id;
  });
}

function readdirNames(dir: string): string[] {
  return readdirSync(dir);
}

/** The existing final record of each image (the starting answer key). */
export function keyRecords(loaded: LoadedConfig, ids: string[]): Map<string, AnalysisRecord> {
  const paths = projectPaths(loaded);
  const out = new Map<string, AnalysisRecord>();
  for (const id of ids) {
    const r = readRecord(paths, id);
    if (!r?.final) throw new Error(`no record for ${id}`);
    out.set(id, r);
  }
  return out;
}

interface Spend {
  usd: number;
  calls: (CallLog & { arm: string })[];
}

export function readSpend(): Spend {
  const f = join(OUT, "spend.json");
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Spend) : { usd: 0, calls: [] };
}

/** A call context whose answers go to the bench store and whose spend is capped across runs. */
export function benchContext(
  loaded: LoadedConfig,
  arm: string,
  cap = CAP_USD,
  ceilings: Record<string, number> = { "full-analysis": 0.3 },
): CallContext {
  const spend = readSpend();
  const left = cap - spend.usd;
  if (left <= 0.3) throw new Error(`Benchmark cap reached: $${spend.usd.toFixed(2)} spent.`);
  const store = workspaceStorage(join(OUT, "answers", arm));
  const { taxonomy, hash } = loadTaxonomy(loaded);
  let spent = 0;
  // A tighter ceiling than the tool's $0.40 so the $3 cap funds both arms (p90 was $0.24).
  const book = ledger(left, () => spent, ceilings);
  const save = () => writeFileSync(join(OUT, "spend.json"), JSON.stringify(spend, null, 1));
  return {
    storage: store,
    answerKey: (step, key) => `shared/${step}/${key}.json`,
    taxonomy,
    taxonomyHash: hash,
    maxBudgetUsd: 0.6,
    remainingUsd: book.remaining,
    timeoutMs: 600_000,
    onCost: (u) => {
      spent += u;
      spend.usd = Math.round((spend.usd + u) * 10000) / 10000;
      save();
    },
    reserve: book.reserve,
    onCall: (c) => {
      spend.calls.push({ ...c, arm });
      save();
    },
  };
}

export function writeOut(name: string, data: unknown): void {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 1));
}

export function readOut<T>(name: string): T | null {
  const f = join(OUT, name);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T) : null;
}
