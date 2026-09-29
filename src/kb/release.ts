import { z } from "zod";
import { libraryKey, type Storage } from "../storage/index.ts";
import type { KbFiles } from "../storage/kb-files.ts";
import { stableHash } from "../util/hash.ts";
import {
  ChecksSchema,
  type EnforcedCheck,
  type Entry,
  EntryFileSchema,
  type ReleaseMeta,
  ReleaseMetaSchema,
  type Source,
  SourceFileSchema,
  TagsSchema,
} from "./schema.ts";
import { type Computed, computeAll } from "./trust.ts";

/** kb/dimension-tags.json: computed facts (pattern ids, gap kinds, variables) to tags. */
export const DimensionTagsSchema = z.strictObject({
  version: z.number().int().min(1),
  /** Key prefix (e.g. "position-1-logo", "variable:order") to tags; longest prefix first wins all. */
  map: z.record(z.string().min(1), z.array(z.string().regex(/^[a-z_]{2,40}$/))),
});
export type DimensionTags = z.infer<typeof DimensionTagsSchema>;

/** The content of one release (or of the inbox): what a report pins by its hash. */
export interface KbContent {
  meta: ReleaseMeta;
  entries: Entry[];
  sources: Source[];
  tags: string[];
  checks: EnforcedCheck[];
  dimensionTags: DimensionTags;
}

export interface Kb extends KbContent {
  hash: string;
  byId: Map<string, Entry>;
  sourceById: Map<string, Source>;
  computed: Map<string, Computed>;
  problems: string[];
}

const EMPTY_META: ReleaseMeta = {
  version: 0,
  date: "",
  contentHash: "",
  counts: {},
  changelog: [],
};
const EMPTY_DIMS: DimensionTags = { version: 1, map: {} };

/** The content hash that pins a release (every file the prompts and checks depend on). */
export function contentHash(c: Omit<KbContent, "meta"> & { meta?: ReleaseMeta }): string {
  return stableHash({
    entries: [...c.entries].sort((a, b) => a.id.localeCompare(b.id)),
    sources: [...c.sources].sort((a, b) => a.id.localeCompare(b.id)),
    tags: c.tags,
    checks: c.checks,
    dimensionTags: c.dimensionTags,
  });
}

/** Cross-reference problems: unknown sources, counter-claims, tags and check entries. */
export function crossProblems(c: Omit<KbContent, "meta">): string[] {
  const out: string[] = [];
  const tags = new Set(c.tags);
  const src = new Set(c.sources.map((s) => s.id));
  const ids = new Set<string>();
  for (const e of c.entries) {
    if (ids.has(e.id)) out.push(`entry ${e.id} is listed twice`);
    ids.add(e.id);
  }
  for (const e of c.entries) {
    for (const t of e.tags) if (!tags.has(t)) out.push(`entry ${e.id}: unknown tag "${t}"`);
    for (const s of e.support)
      if (!src.has(s.sourceId)) out.push(`entry ${e.id}: unknown source ${s.sourceId}`);
    for (const x of e.contradicts)
      if (!ids.has(x)) out.push(`entry ${e.id}: counter-claim ${x} is not in this set`);
  }
  for (const k of c.checks)
    if (!k.entryIds.length && !k.policyUrls.length)
      out.push(`check ${k.id}: needs entry ids or policy pages`);
  return out;
}

export function assemble(content: KbContent, today: string, problems: string[] = []): Kb {
  return {
    ...content,
    hash: contentHash(content),
    byId: new Map(content.entries.map((e) => [e.id, e])),
    sourceById: new Map(content.sources.map((s) => [s.id, s])),
    computed: computeAll(content.entries, new Map(content.sources.map((s) => [s.id, s])), today),
    problems: [...problems, ...crossProblems(content)],
  };
}

function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  what: string,
  problems: string[],
): T | null {
  if (value === undefined) return null;
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  problems.push(
    `${what}: ${r.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")} ${i.message}`)
      .join("; ")}`,
  );
  return null;
}

/**
 * The released knowledge base (kb/entries, kb/sources.json) or the inbox (kb/inbox), with the
 * shared tag list, checks and dimension map. Files that do not parse are reported, never used.
 */
export function loadKb(files: KbFiles, part: "release" | "inbox", today: string): Kb {
  const problems: string[] = [];
  const base = part === "release" ? "" : "inbox/";
  const entryDir = part === "release" ? "entries" : "inbox";
  const tags = parse(TagsSchema, files.getJson("tags.json"), "tags.json", problems)?.tags ?? [];
  const checks = parse(ChecksSchema, files.getJson("checks.json"), "checks.json", problems);
  const dims = parse(
    DimensionTagsSchema,
    files.getJson("dimension-tags.json"),
    "dimension-tags.json",
    problems,
  );
  const meta = parse(ReleaseMetaSchema, files.getJson("release.json"), "release.json", problems);
  const sources =
    parse(SourceFileSchema, files.getJson(`${base}sources.json`), `${base}sources.json`, problems)
      ?.sources ?? [];
  const entries: Entry[] = [];
  for (const name of files.list(entryDir)) {
    if (!name.startsWith("entries-") && part === "inbox") continue;
    const f = parse(
      EntryFileSchema,
      files.getJson(`${entryDir}/${name}`),
      `${entryDir}/${name}`,
      problems,
    );
    if (f) entries.push(...f.entries);
  }
  return assemble(
    {
      meta: meta ?? EMPTY_META,
      entries,
      sources,
      tags,
      checks: checks?.checks ?? [],
      dimensionTags: dims ?? EMPTY_DIMS,
    },
    today,
    problems,
  );
}

/** The immutable snapshot of a release in the shared library, by its content hash. */
export const snapshotKey = (hash: string) => libraryKey("kb", `${hash}.json`);

/** Stores the release once (write-once) so a report can be rebuilt from it later. */
export function pinRelease(storage: Storage, kb: Kb): string {
  const content: KbContent = {
    meta: kb.meta,
    entries: kb.entries,
    sources: kb.sources,
    tags: kb.tags,
    checks: kb.checks,
    dimensionTags: kb.dimensionTags,
  };
  storage.putJsonOnce(snapshotKey(kb.hash), content);
  return kb.hash;
}

/** A pinned release as it was, or null when the snapshot is missing. */
export function loadPinned(storage: Storage, hash: string, today: string): Kb | null {
  const raw = storage.getJson(snapshotKey(hash)) as KbContent | undefined;
  if (!raw) return null;
  const kb = assemble(raw, today);
  return kb.hash === hash ? kb : null;
}
