import { libraryKey, type Storage } from "../storage/index.ts";
import { stableStringify } from "../util/hash.ts";

const TRIAL = "structure-test-v0.json";

export interface TrialCleanup {
  /** Trial files found in the library (storage keys). */
  found: string[];
  /** Removed (only with `apply`): identical to the sample kept in docs/samples. */
  removed: string[];
  /** Kept, with the reason (no sample copy, or it differs: nothing is lost unnoticed). */
  kept: { key: string; reason: string }[];
}

/**
 * The 2026-09-28 layout trial left structure-test-v0.json files in three images' analysis
 * folders (plan-layout-wireframes section 4). They are copies of the samples in
 * docs/samples/<name>/structure.json. A file is removed only when its content equals its
 * sample's (same image, same JSON); anything else is kept and listed.
 */
export function cleanupTrialFiles(
  storage: Storage,
  samples: readonly unknown[],
  apply: boolean,
): TrialCleanup {
  const out: TrialCleanup = { found: [], removed: [], kept: [] };
  const bySha = new Map<string, string>();
  for (const s of samples) {
    const sha = (s as { imageSha256?: unknown } | null)?.imageSha256;
    if (typeof sha === "string") bySha.set(sha, stableStringify(s));
  }
  for (const key of storage.list(libraryKey("analysis"))) {
    if (!key.endsWith(`/${TRIAL}`)) continue;
    out.found.push(key);
    const sha = key.split("/")[2] ?? "";
    const sample = bySha.get(sha);
    if (!sample) {
      out.kept.push({ key, reason: "no copy in docs/samples" });
      continue;
    }
    if (stableStringify(storage.getJson(key)) !== sample) {
      out.kept.push({ key, reason: "differs from its copy in docs/samples" });
      continue;
    }
    if (apply) {
      storage.deleteTrialFile(key);
      out.removed.push(key);
    }
  }
  return out;
}
