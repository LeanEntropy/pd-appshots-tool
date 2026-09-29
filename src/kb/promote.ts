import type { KbFiles } from "../storage/kb-files.ts";
import { assemble, contentHash, loadKb } from "./release.ts";
import { entryHash, syncOfficial } from "./review.ts";
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
  // D4: current official entries are approved automatically first (written unless a dry run).
  const decisions = syncOfficial(files, today, !dryRun).decisions;
  const ok = new Map(
    decisions.filter((d) => d.decision === "approved").map((d) => [d.entryId, d.contentHash]),
  );
  const rejected = new Set(
    decisions.filter((d) => d.decision === "rejected").map((d) => d.entryId),
  );
  const ids = new Set(inbox.entries.filter((e) => ok.get(e.id) === entryHash(e)).map((e) => e.id));
  const held: string[] = [];
  // A claim linked to a counter-claim that is not decided yet is held back (never released
  // without its counter-claim, which could make a contested claim look uncontested). A link to
  // a rejected counter-claim is dropped. Repeated until nothing changes (links go both ways).
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => links.set(a, (links.get(a) ?? new Set()).add(b));
  for (const e of inbox.entries)
    for (const c of e.contradicts) {
      link(e.id, c);
      link(c, e.id);
    }
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of [...ids]) {
      const open = [...(links.get(id) ?? [])].filter((c) => !ids.has(c) && !rejected.has(c));
      if (!open.length) continue;
      ids.delete(id);
      held.push(`${id}: held back until its counter-claims are decided (${open.join(", ")})`);
      changed = true;
    }
  }
  const entries: Entry[] = inbox.entries
    .filter((e) => ids.has(e.id))
    .map((e) => ({ ...e, contradicts: e.contradicts.filter((c) => ids.has(c)) }));
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
