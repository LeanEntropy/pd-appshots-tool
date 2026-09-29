import { USABLE } from "../analysis/records.ts";
import { GoogleIdSchema } from "../library/refs.ts";
import type { Storage } from "../storage/index.ts";
import { AttemptLogSchema, isRecordLike, RecordSchema } from "./validate.ts";

/**
 * Merging one incoming library file into the shared library (plan 12C, C5). Content-addressed
 * files (pictures, facts, cached checks, model answers) are kept when present: the same name
 * means the same content, so nothing is stored twice. Google-id files and cost records are
 * unions. An analysis record already here wins, unless the incoming one is newer and usable.
 */
export type MergeResult = "added" | "same" | "kept" | "updated";

const usable = (r: { status: string; final: unknown }) =>
  (USABLE as readonly string[]).includes(r.status) && r.final !== null && r.final !== undefined;

function parse(bytes: Buffer | undefined): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return undefined;
  }
}

export function mergeLibraryFile(storage: Storage, key: string, bytes: Buffer): MergeResult {
  // Originals are checked against their name (content address) on write.
  const orig = /^library\/images\/orig\/([0-9a-f]{64})\./.exec(key)?.[1];
  const local = storage.getBytes(key);
  if (!local) {
    storage.putBlob(key, bytes, orig);
    return "added";
  }
  if (local.equals(bytes)) return "same";
  if (key.startsWith("library/analysis/") && isRecordLike(parse(bytes))) {
    const mine = RecordSchema.safeParse(parse(local));
    const theirs = RecordSchema.parse(parse(bytes));
    const newer = !mine.success || theirs.updatedAt > mine.data.updatedAt;
    const better = usable(theirs) && (!mine.success || !usable(mine.data) || newer);
    if (!better) return "kept";
    storage.putJson(key, parse(bytes));
    return "updated";
  }
  if (key.startsWith("library/google/")) {
    const mine = GoogleIdSchema.safeParse(parse(local));
    const theirs = GoogleIdSchema.parse(parse(bytes));
    if (!mine.success) return "kept";
    const seen = new Set(mine.data.entries.map((e) => e.sha256));
    const extra = theirs.entries.filter((e) => !seen.has(e.sha256));
    if (!extra.length) return "same";
    const entries = [...mine.data.entries, ...extra].sort((a, b) =>
      a.firstSeen.localeCompare(b.firstSeen),
    );
    storage.putJson(key, { ...mine.data, entries });
    return "updated";
  }
  if (key.startsWith("library/attempts/")) {
    const mine = AttemptLogSchema.safeParse(parse(local));
    const theirs = AttemptLogSchema.parse(parse(bytes));
    if (!mine.success) return "kept";
    const seen = new Set(mine.data.attempts.map((a) => a.attemptId));
    const extra = theirs.attempts.filter((a) => !seen.has(a.attemptId));
    if (!extra.length) return "same";
    storage.putJson(key, { ...mine.data, attempts: [...mine.data.attempts, ...extra] });
    return "updated";
  }
  return "kept";
}
