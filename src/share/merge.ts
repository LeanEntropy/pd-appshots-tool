import { type AnalysisRecord, isUsable } from "../analysis/records.ts";
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

const usable = (r: unknown) => isUsable(r as AnalysisRecord);

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
    // Replaced only by a usable record that is strictly newer, or when the local one is unusable.
    const newer = !mine.success || Date.parse(theirs.updatedAt) > Date.parse(mine.data.updatedAt);
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
  if (/^library\/icons\/apps\/[^/]+\.json$/.test(key)) {
    // A game's icon index here without a stored copy takes the package's (its icon file comes
    // with it), keeping this computer's latest store-read URL: no download on the next view.
    const mine = parse(local) as { sha?: unknown; url?: unknown } | undefined;
    const theirs = parse(bytes) as { sha?: unknown; from?: unknown; checkedAt?: unknown };
    const sha = typeof theirs?.sha === "string" && /^[0-9a-f]{64}$/.test(theirs.sha);
    const held =
      typeof mine?.sha === "string" &&
      /^[0-9a-f]{64}$/.test(mine.sha) &&
      storage.exists(`library/icons/${mine.sha}.webp`);
    if (held || !sha || typeof theirs.from !== "string") return "kept";
    const url = typeof mine?.url === "string" && mine.url ? mine.url : theirs.from;
    storage.putJson(key, {
      url,
      sha: theirs.sha,
      from: theirs.from,
      ...(typeof theirs.checkedAt === "string" ? { checkedAt: theirs.checkedAt } : {}),
    });
    return "updated";
  }
  return "kept";
}
