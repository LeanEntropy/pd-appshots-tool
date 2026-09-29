import { z } from "zod";
import type { KbFiles } from "../storage/kb-files.ts";
import type { Entry, Source } from "./schema.ts";
import { platformOf } from "./trust.ts";

/**
 * Source dates (user rule, 2026-09-29): a source published or updated before SOURCE_CUTOFF is
 * removed when the inbox is built, and trust is counted without it (an entry may drop a level; an
 * entry with no source left is dropped). An undated source counts only when the last
 * `npm run kb -- refresh-official` saw it: an official Google Play or Apple page or a law text
 * when it was live (its current version), any other source when the page shows a date on or after
 * the cutoff. The refresh results live in kb/source-refresh.json.
 */
export const SOURCE_CUTOFF = "2023-01-01";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RefreshLogSchema = z.strictObject({
  lastRun: z.union([z.string().regex(DATE), z.literal("")]),
  sources: z.record(
    z.string(),
    z.strictObject({
      url: z.string(),
      checkedAt: z.string().regex(DATE),
      status: z.enum(["ok", "gone", "moved", "error"]),
      httpStatus: z.number().int(),
      finalUrl: z.string(),
      /** The last date the page was fetched and read successfully ("" = never). */
      verified: z.union([z.string().regex(DATE), z.literal("")]),
      /** The latest publication or update date the page states in its markup ("" = none). */
      pageDate: z.union([z.string().regex(DATE), z.literal("")]).default(""),
    }),
  ),
  entries: z.record(
    z.string(),
    z.strictObject({
      contentHash: z.string(),
      checkedAt: z.string().regex(DATE),
      problems: z.array(z.string()),
    }),
  ),
});
export type RefreshLog = z.infer<typeof RefreshLogSchema>;
export const REFRESH_FILE = "source-refresh.json";

export function readRefresh(files: KbFiles): RefreshLog {
  const r = RefreshLogSchema.safeParse(files.getJson(REFRESH_FILE));
  return r.success ? r.data : { lastRun: "", sources: {}, entries: {} };
}

/** The last day of a published period ("2022" is 2022-12-31, "2023-04" is 2023-04-31). */
const periodEnd = (p: string) => (p.length === 4 ? `${p}-12-31` : p.length === 7 ? `${p}-31` : p);

/** Undated sources that count once the refresh saw the page live. */
export const liveCounts = (s: Source) =>
  s.type === "law" || (s.type === "official" && platformOf(s.url) !== null);

/** Why a source is removed by the date rule, or null when it stays. */
export function dateProblem(s: Source, log: RefreshLog): string | null {
  if (s.published !== "unknown")
    return periodEnd(s.published) < SOURCE_CUTOFF ? `published ${s.published}` : null;
  const seen = log.sources[s.id];
  if (liveCounts(s))
    return seen?.status === "ok" ? null : "undated, not confirmed live by a refresh";
  if (seen?.pageDate && seen.pageDate >= SOURCE_CUTOFF) return null;
  return seen?.pageDate
    ? `undated, the page shows ${seen.pageDate}`
    : "undated, no date on the page";
}

export interface DateCut {
  removed: { id: string; type: Source["type"]; published: string; reason: string }[];
  dropped: string[];
}

/** The entries and sources without the sources the date rule removes. */
export function applyDateCut(
  entries: readonly Entry[],
  sources: readonly Source[],
  log: RefreshLog,
): { entries: Entry[]; sources: Source[]; cut: DateCut } {
  const cut: DateCut = { removed: [], dropped: [] };
  const gone = new Set<string>();
  for (const s of sources) {
    const reason = dateProblem(s, log);
    if (!reason) continue;
    gone.add(s.id);
    cut.removed.push({ id: s.id, type: s.type, published: s.published, reason });
  }
  const kept: Entry[] = [];
  for (const e of entries) {
    const support = e.support.filter((x) => !gone.has(x.sourceId));
    if (!support.length) {
      cut.dropped.push(e.id);
      continue;
    }
    const counterSupport = e.counterSupport.filter((x) => !gone.has(x.sourceId));
    const same =
      support.length === e.support.length && counterSupport.length === e.counterSupport.length;
    kept.push(same ? e : { ...e, support, counterSupport });
  }
  const ids = new Set(kept.map((e) => e.id));
  const out = kept.map((e) =>
    e.contradicts.every((c) => ids.has(c))
      ? e
      : { ...e, contradicts: e.contradicts.filter((c) => ids.has(c)) },
  );
  return { entries: out, sources: sources.filter((s) => !gone.has(s.id)), cut };
}
