import { z } from "zod";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import {
  type ProjectContext,
  projectKey,
  type Storage,
  workspaceStorage,
} from "../storage/index.ts";
import { countryMarkdown } from "./country-md.ts";
import type { CountryReport } from "./country-report-types.ts";
import { deriveCountry, PROJECTION } from "./derive-country.ts";
import { mainMarketRef } from "./main-market.ts";
import { presetId } from "./migrate.ts";
import { countryName } from "./names.ts";
import { playContextOf } from "./play-context.ts";
import {
  addVersion,
  defKey,
  listDefs,
  readDef,
  readVersionInputs,
  runFolders,
  uniqueName,
  versionFileKey,
  writeVersionInputs,
} from "./store.ts";
import { type ReportDef, ReportDefSchema, type VersionInputs } from "./types.ts";

/**
 * Which One country reports were made from which comparison (plan-cross-country 2.2, 2.4), in
 * one project file, reports/derived.json. Each child is active, suppressed (the user deleted it:
 * never recreated until "Make country reports now") or detached. Per comparison, the versions
 * whose country reports are all made. `reconcileDerived` makes what is missing and never
 * duplicates: every write is write-once or idempotent, so a crash at any step is finished by the
 * next call.
 */
const ChildSchema = z.object({
  gl: z.string(),
  reportId: z.string(),
  state: z.enum(["active", "suppressed", "detached"]),
});
const EntrySchema = z.object({
  reportId: z.string(),
  children: z.array(ChildSchema).default([]),
  /** Comparison versions whose country reports are all made. */
  done: z.array(z.string()).default([]),
  /** Partial versions the user asked to make country reports from anyway. */
  manual: z.array(z.string()).default([]),
});
export const DerivedFileSchema = z.object({
  version: z.literal(1),
  comparisons: z.array(EntrySchema).default([]),
});
export type DerivedFile = z.infer<typeof DerivedFileSchema>;
export type DerivedEntry = z.infer<typeof EntrySchema>;

export const derivedKey = (c: ProjectContext) => projectKey(c, "reports", "derived.json");

export function readDerived(s: Storage, c: ProjectContext): DerivedFile {
  return readDerivedOrNull(s, c) ?? { version: 1, comparisons: [] };
}

/** The file, or null when it exists but cannot be read (then nothing is made by itself). */
function readDerivedOrNull(s: Storage, c: ProjectContext): DerivedFile | null {
  try {
    const raw = s.getJson(derivedKey(c));
    if (raw === undefined) return { version: 1, comparisons: [] };
    const p = DerivedFileSchema.safeParse(raw);
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

const childIdOf = (parentId: string, gl: string) => `${parentId}-${gl}`;
/** The child version folder: the comparison version's time stamp, the child's id. */
export const childVersionId = (parentVersionId: string, parentId: string, childId: string) =>
  `${parentVersionId.slice(0, parentVersionId.length - parentId.length)}${childId}`;

function readReport(s: Storage, c: ProjectContext, versionId: string): CountryReport | null {
  try {
    const r = s.getJson(versionFileKey(c, versionId, "country-report.json")) as CountryReport;
    return r?.kind === "countries" && Array.isArray(r.countries) ? r : null;
  } catch {
    return null;
  }
}

/** Ready: every written part is there (a partial or stopped version makes none by itself). */
const isReady = (r: CountryReport) => r.missing.length === 0;

/** The newest version of the check the comparison rests on, made at or before `at`. */
function baseVersionAt(defs: readonly ReportDef[], id: string, at: string): string | null {
  const d = defs.find((x) => x.id === id);
  const before = (d?.versions ?? []).filter((v) => v.generatedAt <= at);
  return before.at(-1)?.id ?? null;
}

export interface ReconcileResult {
  made: { reportId: string; versionId: string; gl: string }[];
}

/**
 * Makes the missing country reports of every comparison (or of one), code only, no AI call.
 * `force`: also from this partial version (the "Make country reports now" button).
 */
export function reconcileDerived(
  loaded: LoadedConfig,
  o: { reportId?: string; force?: string } = {},
): ReconcileResult {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  // Unreadable: nothing is made by itself (a deleted report must never come back).
  const file = o.force ? readDerived(s, paths) : readDerivedOrNull(s, paths);
  const made: ReconcileResult["made"] = [];
  if (!file) return { made };
  let defs = listDefs(s, paths);
  const compares = defs.filter((d) => d.type === "compare" && (!o.reportId || d.id === o.reportId));
  if (!compares.length) return { made };
  const folders = runFolders(s, paths);
  const main = mainMarketRef(loaded);
  let changed = false;
  for (const def of compares) {
    let entry = file.comparisons.find((e) => e.reportId === def.id);
    if (!entry) {
      entry = { reportId: def.id, children: [], done: [], manual: [] };
      file.comparisons.push(entry);
      changed = true;
    }
    if (o.force && !entry.manual.includes(o.force)) {
      entry.manual.push(o.force);
      changed = true;
    }
    for (const v of def.versions) {
      if (entry.done.includes(v.id) || !folders.get(v.id)?.has("country-report.json")) continue;
      const report = readReport(s, paths, v.id);
      if (!report) continue;
      if (!isReady(report) && !entry.manual.includes(v.id)) continue;
      const parentInputs = readVersionInputs(s, paths, v.id);
      const play = playContextOf(loaded.config, [], def.scope.platform === "appstore");
      for (const c of report.countries) {
        if (c.isMain) continue;
        let child = entry.children.find((x) => x.gl === c.gl);
        if (child?.state === "suppressed" || child?.state === "detached") continue;
        const childId = childIdOf(def.id, c.gl);
        if (!child) {
          child = { gl: c.gl, reportId: childId, state: "active" };
          entry.children.push(child);
          changed = true;
        }
        const d = ensureChildDef(s, paths, defs, def, c, childId);
        if (!d) continue;
        defs = d.defs;
        const vid = childVersionId(v.id, def.id, childId);
        if (!folders.get(vid)?.has("version.json")) {
          const meta = {
            reportId: def.id,
            versionId: v.id,
            name: def.name,
            generatedAt: v.generatedAt,
          };
          const r = deriveCountry(report, c.gl, meta, { ...play, reportMarkets: [c] });
          if (!r) continue;
          s.putJsonOnce(versionFileKey(paths, vid, "country-report.json"), r);
          s.putText(versionFileKey(paths, vid, "report.md"), countryMarkdown(r));
          const stage = parentInputs?.base ?? report.base.stage;
          const baseId = stage ? presetId(defs, stage, main) : null;
          writeVersionInputs(
            s,
            paths,
            vid,
            childInputs(parentInputs, d.def, c, v, {
              baseVersionId: baseId ? baseVersionAt(defs, baseId, v.generatedAt) : null,
              main,
            }),
          );
          made.push({ reportId: childId, versionId: vid, gl: c.gl });
        }
        addVersion(s, paths, childId, { id: vid, generatedAt: v.generatedAt });
      }
      entry.done.push(v.id);
      changed = true;
    }
  }
  if (changed) s.putJson(derivedKey(paths), DerivedFileSchema.parse(file));
  return { made };
}

/** The child's def: made once (a def left by a crash is reused). */
function ensureChildDef(
  s: Storage,
  c: ProjectContext,
  defs: ReportDef[],
  parent: ReportDef,
  country: CountryReport["countries"][number],
  childId: string,
): { def: ReportDef; defs: ReportDef[] } | null {
  const existing = readDef(s, c, childId);
  if (existing) return { def: existing, defs };
  const n = parent.scope.competitors.length + parent.scope.includeCharts.length;
  const def: ReportDef = {
    id: childId,
    name: uniqueName(
      defs,
      `${countryName(country.label)} vs ${n} ${n === 1 ? "competitor" : "competitors"} (from the comparison)`,
    ),
    type: "country",
    scope: {
      type: "country",
      markets: [{ gl: country.gl, hl: country.hl, label: country.label }],
      competitors: parent.scope.competitors,
      includeCharts: parent.scope.includeCharts,
      ...(parent.scope.platform ? { platform: parent.scope.platform } : {}),
      ...(parent.scope.leftOut
        ? { leftOut: parent.scope.leftOut.filter((x) => x.gl === country.gl) }
        : {}),
    },
    createdAt: new Date().toISOString(),
    archived: false,
    versions: [],
    derivedFrom: { reportId: parent.id, gl: country.gl },
  };
  if (!s.putJsonOnce(defKey(c, def.id), ReportDefSchema.parse(def))) {
    const again = readDef(s, c, childId);
    return again ? { def: again, defs } : null;
  }
  return { def, defs: [...defs, def] };
}

function childInputs(
  p: VersionInputs | null,
  def: ReportDef,
  c: CountryReport["countries"][number],
  v: { id: string; generatedAt: string },
  o: { baseVersionId: string | null; main: VersionInputs["mainMarket"] },
): VersionInputs {
  const records = (p?.records ?? []).filter((r) => r.gl === c.gl);
  const orderDates = Object.fromEntries(
    Object.entries(p?.orderDates ?? {}).filter(([k]) => k.endsWith(`@${c.gl}`)),
  );
  return {
    reportId: def.id,
    type: "country",
    generatedAt: v.generatedAt,
    createdAt: new Date().toISOString(),
    mainMarket: p?.mainMarket ?? o.main,
    scope: def.scope,
    pick: p?.pick ?? [],
    orderDates,
    records,
    versions: p?.versions ?? { prompts: {}, schema: "", taxonomy: "", fit: "" },
    planHash: null,
    dataHash: null,
    aiRunId: p?.aiRunId ?? null,
    base: p?.base ?? null,
    derivedFrom: { reportId: p?.reportId ?? "", versionId: v.id, gl: c.gl, projection: PROJECTION },
    displayScope: { gl: c.gl, hl: c.hl, label: c.label },
    dependencyScope: {
      records: records.map(({ appId, position, imageId, updatedAt }) => ({
        appId,
        position,
        imageId,
        updatedAt,
      })),
      orderDates,
      baseVersionId: o.baseVersionId,
    },
  };
}

/** Deleting a country report made from a comparison: not recreated by later versions. */
export function suppressChild(s: Storage, c: ProjectContext, def: ReportDef): void {
  if (!def.derivedFrom) return;
  const file = readDerived(s, c);
  const entry = file.comparisons.find((e) => e.reportId === def.derivedFrom?.reportId);
  const child = entry?.children.find((x) => x.reportId === def.id);
  if (!child) return;
  child.state = "suppressed";
  s.putJson(derivedKey(c), DerivedFileSchema.parse(file));
}

/** "Make country reports now": every child active again, and this version derived. */
export function makeCountryReportsNow(loaded: LoadedConfig, reportId: string): ReconcileResult {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const def = readDef(s, paths, reportId);
  if (def?.type !== "compare") return { made: [] };
  const file = readDerived(s, paths);
  const entry = file.comparisons.find((e) => e.reportId === reportId);
  if (entry) {
    for (const ch of entry.children) ch.state = "active";
    // Re-derive the versions of children that were deleted (their version folders are gone).
    entry.done = [];
    s.putJson(derivedKey(paths), DerivedFileSchema.parse(file));
  }
  return reconcileDerived(loaded, { reportId, force: def.versions.at(-1)?.id });
}
