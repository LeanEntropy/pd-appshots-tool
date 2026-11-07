import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

// The one place tests make temp dirs (test/temp-guard.test.ts enforces it). Every dir is removed
// after the file's tests, pass or fail, and again on exit if the run stops early.
const made = new Set<string>();

const removeAll = () => {
  for (const dir of made) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // A file still locked on Windows must never fail a test.
    }
  }
};

// Registered while this module loads, so the hook belongs to the file, not to one test.
after(() => {
  removeAll();
  // The storage touches each workspace's .locks/data-changed marker on exit, which recreates a
  // removed dir: this listener moves to the end so it runs after that and removes it again.
  process.removeListener("exit", removeAll);
  process.on("exit", removeAll);
});
process.on("exit", removeAll);

/** A fresh temp dir under the OS temp folder, removed when the test file ends. */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  made.add(dir);
  return dir;
}

/** An environment whose TEMP/TMP/TMPDIR point into a temp dir, for child processes. */
export function tempEnv(prefix = "ssr-child-"): NodeJS.ProcessEnv {
  const dir = tempDir(prefix);
  return { ...process.env, TEMP: dir, TMP: dir, TMPDIR: dir };
}
