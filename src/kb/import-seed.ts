import { basename } from "node:path";
import { type KbFiles, readSeedDir } from "../storage/kb-files.ts";
import { convertV1, isV1File } from "./import-v1.ts";
import { assemble, loadKb } from "./release.ts";
import { type Entry, EntrySchema, type Source, SourceSchema, TagsSchema } from "./schema.ts";
import { type DateCut, SOURCE_CUTOFF } from "./source-date.ts";
import { TRUST_LEVELS } from "./trust.ts";

/**
 * Seed import (milestone K0): the research agents' seed files become the inbox (kb/inbox), where
 * the user reviews them. Re-runnable: each run rebuilds the inbox from exactly the folders given
 * (the user's decisions live apart, in kb/approvals.json, keyed by entry and content, so a
 * re-import keeps every decision on unchanged entries). Nothing invalid is imported: every
 * reject is listed with its reasons in kb/inbox/import-report.json. The counts are those of the
 * inbox as the tool reads it: with the source-date rule applied (source-date.ts).
 */
type Raw = Record<string, unknown>;

export interface Reject {
  file: string;
  id: string;
  reasons: string[];
}

export interface ImportReport {
  importedAt: string;
  folders: string[];
  files: {
    name: string;
    format: "v2" | "v1" | "sources" | "skipped";
    entries: number;
    imported: number;
  }[];
  sources: number;
  imported: number;
  rejects: Reject[];
  warnings: string[];
  byTrust: Record<string, number>;
  byRuleClass: Record<string, number>;
  byKind: Record<string, number>;
  /** Entries per market (country code, or "global"). */
  byMarket: Record<string, number>;
  dateRule: {
    cutoff: string;
    removedSources: DateCut["removed"];
    removedByType: Record<string, number>;
    droppedEntries: string[];
    trustChanged: { id: string; from: string; to: string }[];
  };
}

const ENTRY_KEYS = new Set(Object.keys(EntrySchema.shape));
const SOURCE_KEYS = new Set(Object.keys(SourceSchema.shape));

function pick(raw: Raw, keys: ReadonlySet<string>): Raw {
  return Object.fromEntries(Object.entries(raw).filter(([k]) => keys.has(k)));
}

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) =>
  e.issues.slice(0, 5).map((i) => `${i.path.join(".") || "entry"}: ${i.message}`);

const fileName = (seedName: string, v1: boolean) =>
  `entries-${v1 ? "v1-" : ""}${basename(seedName, ".json")
    .replace(/^entries-/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 50)}`;

export function importSeeds(
  files: KbFiles,
  folders: readonly string[],
  today: string,
): ImportReport {
  const tagList = TagsSchema.safeParse(files.getJson("tags.json"));
  const known = new Set(tagList.success ? tagList.data.tags : []);
  const report: ImportReport = {
    importedAt: new Date().toISOString(),
    folders: [...folders],
    files: [],
    sources: 0,
    imported: 0,
    rejects: [],
    warnings: tagList.success ? [] : ["kb/tags.json is missing or invalid: every tag is rejected"],
    byTrust: {},
    byRuleClass: {},
    byKind: {},
    byMarket: {},
    dateRule: {
      cutoff: SOURCE_CUTOFF,
      removedSources: [],
      removedByType: {},
      droppedEntries: [],
      trustChanged: [],
    },
  };
  const sources = new Map<string, Source>();
  const rules = files.getJson("import-rules.json") as { replaceableOrigins?: string[] } | undefined;
  const replaceable = new Set(rules?.replaceableOrigins ?? []);
  const addSource = (raw: Raw, file: string) => {
    const origin = String(raw.evidenceOrigin ?? "");
    const r = SourceSchema.safeParse({
      ...pick(raw, SOURCE_KEYS),
      ...(replaceable.has(origin) ? { replaceableByToolData: true } : {}),
    });
    const id = String(raw.id ?? "?");
    if (!r.success)
      return report.rejects.push({ file, id: `source ${id}`, reasons: issues(r.error) });
    const had = sources.get(r.data.id);
    if (had && JSON.stringify(had) !== JSON.stringify(r.data) && !r.data.id.startsWith("v1s-"))
      return report.warnings.push(
        `source ${id} is defined twice with different details; the first is kept (${file})`,
      );
    if (!had) sources.set(r.data.id, r.data);
  };
  const pending: { file: string; out: string; raw: Raw }[] = [];
  for (const folder of folders)
    for (const f of readSeedDir(folder)) {
      if (f.error) {
        report.rejects.push({
          file: f.name,
          id: "(file)",
          reasons: [`not valid JSON: ${f.error}`],
        });
        continue;
      }
      const json = f.json as Raw;
      if (f.name.startsWith("sources-")) {
        const list = Array.isArray(json.sources) ? (json.sources as Raw[]) : [];
        for (const s of list) addSource(s, f.name);
        report.files.push({
          name: f.name,
          format: "sources",
          entries: list.length,
          imported: list.length,
        });
        continue;
      }
      const list = Array.isArray(json.entries) ? (json.entries as Raw[]) : null;
      if (!list || f.name.startsWith("_")) {
        report.files.push({ name: f.name, format: "skipped", entries: 0, imported: 0 });
        continue;
      }
      const v1 = isV1File(json);
      const out = fileName(f.name, v1);
      report.files.push({
        name: f.name,
        format: v1 ? "v1" : "v2",
        entries: list.length,
        imported: 0,
      });
      for (const raw of list) {
        if (!v1) {
          pending.push({ file: f.name, out, raw });
          continue;
        }
        const c = convertV1(raw, known);
        for (const s of c.sources) addSource(s, f.name);
        if (c.entry) pending.push({ file: f.name, out, raw: c.entry });
        else
          report.rejects.push({
            file: f.name,
            id: `v1-${String(raw.id ?? "?")}`,
            reasons: c.reasons,
          });
      }
    }
  const accepted: { out: string; file: string; entry: Entry }[] = [];
  const ids = new Set<string>();
  for (const p of pending) {
    const extra = Object.keys(p.raw).filter(
      (k) => !ENTRY_KEYS.has(k) && !["trust", "researcherConfidence"].includes(k),
    );
    if (extra.length)
      report.warnings.push(`${p.file} ${String(p.raw.id)}: ignored fields ${extra.join(", ")}`);
    const r = EntrySchema.safeParse(pick(p.raw, ENTRY_KEYS));
    const id = String(p.raw.id ?? "?");
    if (!r.success) {
      report.rejects.push({ file: p.file, id, reasons: issues(r.error) });
      continue;
    }
    const e = r.data;
    const reasons = [
      ...e.tags.filter((t) => !known.has(t)).map((t) => `unknown tag "${t}"`),
      ...[...e.support, ...e.counterSupport]
        .filter((s) => !sources.has(s.sourceId))
        .map((s) => `unknown source ${s.sourceId}`),
      ...(ids.has(e.id) ? ["the id is used by another entry"] : []),
    ];
    if (reasons.length) {
      report.rejects.push({ file: p.file, id, reasons });
      continue;
    }
    ids.add(e.id);
    accepted.push({ out: p.out, file: p.file, entry: e });
  }
  // A counter-claim link to an entry that was not imported is dropped, with a warning.
  for (const a of accepted) {
    const missing = a.entry.contradicts.filter((c) => !ids.has(c));
    if (missing.length) {
      report.warnings.push(`${a.entry.id}: counter-claims not imported: ${missing.join(", ")}`);
      a.entry.contradicts = a.entry.contradicts.filter((c) => ids.has(c));
    }
  }
  const byFile = new Map<string, Entry[]>();
  for (const a of accepted) byFile.set(a.out, [...(byFile.get(a.out) ?? []), a.entry]);
  for (const old of files.list("inbox"))
    if (old.startsWith("entries-") && !byFile.has(basename(old, ".json")))
      files.remove(`inbox/${old}`);
  for (const [out, entries] of byFile) files.putJson(`inbox/${out}.json`, { file: out, entries });
  const used = new Set(
    accepted.flatMap((a) => [...a.entry.support, ...a.entry.counterSupport].map((s) => s.sourceId)),
  );
  const kept = [...sources.values()].filter((s) => used.has(s.id));
  files.putJson("inbox/sources.json", { sources: kept });
  for (const f of report.files)
    f.imported =
      accepted.filter((a) => a.file === f.name).length || (f.format === "sources" ? f.imported : 0);
  report.sources = kept.length;
  report.imported = accepted.length;
  const all = assemble(
    {
      meta: { version: 0, date: "", contentHash: "", counts: {}, changelog: [] },
      entries: accepted.map((a) => a.entry),
      sources: kept,
      tags: [...known],
      checks: [],
      dimensionTags: { version: 1, map: {} },
    },
    today,
  );
  const kb = loadKb(files, "inbox", today);
  const cut = kb.dateCut ?? { removed: [], dropped: [] };
  report.dateRule.removedSources = cut.removed;
  for (const r of cut.removed)
    report.dateRule.removedByType[r.type] = (report.dateRule.removedByType[r.type] ?? 0) + 1;
  report.dateRule.droppedEntries = cut.dropped;
  for (const t of TRUST_LEVELS) report.byTrust[t] = 0;
  for (const e of kb.entries) {
    const c = kb.computed.get(e.id);
    const before = all.computed.get(e.id)?.trust;
    if (c && before && before !== c.trust)
      report.dateRule.trustChanged.push({ id: e.id, from: before, to: c.trust });
    if (c) report.byTrust[c.trust] = (report.byTrust[c.trust] ?? 0) + 1;
    report.byRuleClass[e.ruleClass] = (report.byRuleClass[e.ruleClass] ?? 0) + 1;
    report.byKind[e.kind] = (report.byKind[e.kind] ?? 0) + 1;
    for (const m of e.scope.countries) report.byMarket[m] = (report.byMarket[m] ?? 0) + 1;
  }
  files.putJson("inbox/import-report.json", report);
  return report;
}
