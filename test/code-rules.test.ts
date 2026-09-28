import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

const REPO = join(import.meta.dirname, "..");

/**
 * Older modules that still call the file system directly (plan 12B, B2). This list may only
 * shrink: a module that stops using node:fs must be removed from it, and nothing may be added.
 * Everything else reaches files through src/storage/.
 */
const LEGACY_FS_ALLOWED = [
  "src/analysis/final-report.ts",
  "src/analysis/orders.ts",
  "src/analysis/prompts.ts",
  "src/analysis/providers.ts",
  "src/cli.ts",
  "src/config/load.ts",
  "src/overview/overview-report.ts",
  "src/play/client.ts",
  "src/server/api.ts",
  "src/steps/deck-view.ts",
  "src/steps/doctor.ts",
  "src/steps/own-assets.ts",
  "src/steps/select.ts",
  "src/store/imagedb-legacy.ts",
  "src/util/fsx.ts",
  "src/util/proc.ts",
  "src/view/model.ts",
];
const MAX_ALLOWED = 17;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
  );
}

const rel = (f: string) => relative(REPO, f).split("\\").join("/");
const usesFs = (text: string) =>
  /from\s+["'](node:)?fs(\/promises)?["']|require\(\s*["'](node:)?fs["']\s*\)/.test(text);

test("feature code reaches files only through src/storage (legacy allow-list only shrinks)", () => {
  const offenders: string[] = [];
  const stillUsing = new Set<string>();
  for (const f of files(join(REPO, "src"))) {
    const r = rel(f);
    if (!usesFs(readFileSync(f, "utf8"))) continue;
    if (r.startsWith("src/storage/")) continue;
    if (LEGACY_FS_ALLOWED.includes(r)) stillUsing.add(r);
    else offenders.push(r);
  }
  assert.deepEqual(offenders, [], "direct node:fs use outside src/storage and the allow-list");
  const stale = LEGACY_FS_ALLOWED.filter((f) => !stillUsing.has(f));
  assert.deepEqual(stale, [], "these no longer use node:fs: remove them from the allow-list");
  assert.ok(LEGACY_FS_ALLOWED.length <= MAX_ALLOWED, "the allow-list may only shrink");
});

test("every source and test file stays within 300 lines", () => {
  const long = [...files(join(REPO, "src")), ...files(join(REPO, "test"))]
    .map((f) => ({ f: rel(f), n: readFileSync(f, "utf8").trimEnd().split("\n").length }))
    .filter((x) => x.n > 300);
  assert.deepEqual(long, []);
});
