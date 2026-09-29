import type { KbFiles } from "../storage/kb-files.ts";
import { assemble, contentHash, loadKb } from "./release.ts";
import { entryHash, readApprovals } from "./review.ts";
import type { Entry, ReleaseMeta } from "./schema.ts";
import { TRUST_LEVELS } from "./trust.ts";

/**
 * The promotion step (plan section 6): the inbox entries the user approved (with the content they
 * approved) become the next release in kb/entries and kb/sources.json, with a new version number,
 * the counts per trust level and a changelog. Run from Claude Code (npm run kb -- release) and
 * committed like code; the tool itself only reads the release.
 */
export interface Promotion {
  version: number;
  hash: string;
  added: string[];
  changed: string[];
  removed: string[];
  counts: Record<string, number>;
  /** Approved entries left out (a counter-claim or source problem), with the reason. */
  held: string[];
  unchanged: boolean;
}

export function promote(files: KbFiles, today: string, dryRun = false): Promotion {
  const inbox = loadKb(files, "inbox", today);
  const current = loadKb(files, "release", today);
  const ok = new Map(
    readApprovals(files)
      .filter((d) => d.decision === "approved")
      .map((d) => [d.entryId, d.contentHash]),
  );
  const approved = inbox.entries.filter((e) => ok.get(e.id) === entryHash(e));
  const ids = new Set(approved.map((e) => e.id));
  const held: string[] = [];
  // A counter-claim that is not approved is left out of the link (it cannot travel along).
  const entries: Entry[] = approved.map((e) => {
    const missing = e.contradicts.filter((c) => !ids.has(c));
    if (missing.length)
      held.push(`${e.id}: counter-claims not approved yet (${missing.join(", ")}); link left out`);
    return { ...e, contradicts: e.contradicts.filter((c) => ids.has(c)) };
  });
  const used = new Set(
    entries.flatMap((e) => [...e.support, ...e.counterSupport].map((s) => s.sourceId)),
  );
  const sources = inbox.sources.filter((s) => used.has(s.id));
  // Checks whose entries are not all released keep only the released ones (inactive if none).
  const next = {
    entries,
    sources,
    tags: inbox.tags,
    checks: current.checks,
    dimensionTags: current.dimensionTags,
  };
  const hash = contentHash(next);
  const before = new Map(current.entries.map((e) => [e.id, entryHash(e)]));
  const added = entries.filter((e) => !before.has(e.id)).map((e) => e.id);
  const changed = entries
    .filter((e) => before.has(e.id) && before.get(e.id) !== entryHash(e))
    .map((e) => e.id);
  const removed = [...before.keys()].filter((id) => !ids.has(id));
  const kb = assemble({ ...next, meta: current.meta }, today);
  const counts: Record<string, number> = Object.fromEntries(TRUST_LEVELS.map((t) => [t, 0]));
  for (const c of kb.computed.values()) counts[c.trust] = (counts[c.trust] ?? 0) + 1;
  const unchanged = hash === current.hash;
  const version = unchanged ? current.meta.version : current.meta.version + 1;
  if (!dryRun && !unchanged) {
    const byFile = new Map<string, Entry[]>();
    const fileOf = new Map<string, string>();
    for (const name of files.list("inbox"))
      if (name.startsWith("entries-"))
        for (const e of (files.getJson(`inbox/${name}`) as { entries?: { id: string }[] })
          ?.entries ?? [])
          fileOf.set(e.id, name.replace(/^entries-/, "").replace(/\.json$/, ""));
    for (const e of entries) {
      const f = fileOf.get(e.id) ?? "misc";
      byFile.set(f, [...(byFile.get(f) ?? []), e]);
    }
    for (const old of files.list("entries"))
      if (!byFile.has(old.replace(/\.json$/, ""))) files.remove(`entries/${old}`);
    for (const [f, list] of byFile) files.putJson(`entries/${f}.json`, { file: f, entries: list });
    files.putJson("sources.json", { sources });
    const meta: ReleaseMeta = {
      version,
      date: today,
      contentHash: hash,
      counts,
      changelog: [...current.meta.changelog, { version, date: today, added, changed, removed }],
    };
    files.putJson("release.json", meta);
  }
  return { version, hash, added, changed, removed, counts, held, unchanged };
}
