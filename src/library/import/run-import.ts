import { resolve } from "node:path";
import { reviewPolicy } from "../../analysis/pipeline.ts";
import { type LoadedConfig, loadConfig, projectPaths } from "../../config/load.ts";
import {
  configFromSettings,
  loadDefaults,
  readSettings,
  settingsFromConfig,
  workspaceDir,
} from "../../config/project.ts";
import type { ProjectSettings } from "../../config/project-schema.ts";
import { type ProjectContext, workspaceStorage } from "../../storage/index.ts";
import { acquireAll, LOCKS } from "../../storage/leases.ts";
import { stableStringify } from "../../util/hash.ts";
import { refsKey } from "../layout.ts";
import { readJournal, rollback, saveJournal, stagedRefsKey, startJournal } from "./journal.ts";
import { compareSnapshots, type Snapshot, takeSnapshot } from "./snapshot.ts";
import {
  type LinkCounts,
  type Log,
  linkFiles,
  type Progress,
  refreshIdentities,
  stageRefs,
  writeFacts,
  writeRecords,
} from "./steps.ts";
import { hasLegacyData, inventory, pause, runningAnalysis, verifyOriginals } from "./survey.ts";
import { finishSwitch, sameSettings } from "./switch.ts";

export interface ImportOptions {
  root: string;
  configPath: string;
  /** false = dry run: reads only, writes nothing. */
  apply: boolean;
  /** Dry run: hash every original too (about a minute for 2.6 GB). */
  verifyHashes?: boolean;
  log?: Log;
  /** Live progress for the page (step name, counts). */
  progress?: Progress;
  /** Tests only: fail after this step, to prove the rollback. */
  failAfter?: "link" | "facts" | "records" | "identity" | "gate";
}

export interface ImportReport {
  projectId: string;
  name: string;
  status: "dry-run" | "imported" | "already-imported" | "blocked";
  blocked: string | null;
  settings: { equal: boolean; overrides: string[] };
  images: number;
  bytes: number;
  files: Record<string, number>;
  pixelFacts: number;
  googleIds: number;
  alreadyInLibrary: number;
  hashes: { checked: number; bad: string[] } | null;
  records: { total: number; proven: number; unproven: number; reasons: Record<string, number> };
  before: Snapshot;
  after: Snapshot | null;
  gate: string[];
  linkCounts: LinkCounts | null;
}

/**
 * Imports a project made before the shared library: settings become project.json, and images,
 * pixel facts, analysis records and per-image model answers move into the library by hardlink
 * with hash checks. Nothing is downloaded or analysed. A dry run reads only. The real import
 * holds the library and both lane locks, and switches the project over only after the gate
 * proves the image list, approval fingerprints, report freshness and views are unchanged;
 * otherwise it removes exactly what it created.
 */
export async function runImport(o: ImportOptions): Promise<ImportReport> {
  const log = o.log ?? (() => {});
  // Each step is announced, then other work (the page's progress requests) gets a turn.
  const step = async (name: string) => {
    o.progress?.(name);
    await pause();
  };
  const legacy: LoadedConfig = { ...loadConfig(o.configPath), layout: { mode: "legacy" } };
  const paths = projectPaths(legacy);
  const ctx: ProjectContext = { projectId: legacy.config.project };
  const defaults = loadDefaults(o.root);
  if (resolve(workspaceDir(o.root, defaults)) !== resolve(paths.workspace))
    throw new Error("The project's workspace folder differs from the tool's workspace folder.");
  const storage = workspaceStorage(paths.workspace);
  const now = new Date().toISOString();
  const settings = settingsFromConfig(legacy.config, defaults, now);
  const journal = readJournal(storage, ctx);

  if (storage.exists(refsKey(ctx)) && journal?.phase !== "switching") {
    if (o.apply) log("This project already uses the shared library. Nothing to do.");
    return alreadyImported(legacy, settings);
  }
  if (!hasLegacyData(storage, ctx) && journal?.phase !== "switching")
    throw new Error(`Project "${ctx.projectId}" has no downloaded images to import.`);

  // Settings gate: the merged settings must give exactly today's config.
  const merged = configFromSettings(settings, defaults);
  const equal = stableStringify(merged) === stableStringify(legacy.config);
  const existing = readSettings(storage, ctx);
  const settingsProblem = !equal
    ? "the imported settings do not reproduce the current config"
    : existing && !sameSettings(existing, settings)
      ? "a different project.json exists already"
      : null;

  if (journal?.phase === "switching") {
    if (!o.apply)
      throw new Error("An import was interrupted while switching; run it again to finish.");
    const held = acquireAll(storage, [LOCKS.library, LOCKS.ai, LOCKS.store], {
      projectId: ctx.projectId,
      kind: "import",
    });
    if ("heldBy" in held)
      throw new Error("Another job is running. Finish the interrupted import when it has ended.");
    try {
      finishSwitch(storage, ctx, existing ?? settings, journal);
    } finally {
      held.release();
    }
    log("Finished an interrupted import.");
    return alreadyImported(legacy, settings);
  }

  log("Reading the project's images, analyses and model answers…");
  await step("Reading the project's images, analyses and saved answers");
  const inv = inventory(storage, ctx, reviewPolicy(legacy.config));
  await step("Recording the approval numbers and views before the import");
  const before = takeSnapshot(legacy);
  const blocked = runningAnalysis(storage, ctx);
  const files: Record<string, number> = {};
  for (const l of inv.links) files[l.kind] = (files[l.kind] ?? 0) + 1;
  const reasons: Record<string, number> = {};
  for (const r of inv.records)
    if (r.proof.reason) reasons[r.proof.reason] = (reasons[r.proof.reason] ?? 0) + 1;
  const report: ImportReport = {
    projectId: ctx.projectId,
    name: settings.name,
    status: "dry-run",
    blocked: blocked
      ? `An analysis is running in this project (${blocked}). Import when it has finished.`
      : null,
    settings: { equal, overrides: Object.keys(settings.overrides ?? {}) },
    images: Object.keys(inv.db.images).length,
    bytes: inv.bytes,
    files,
    pixelFacts: inv.pixels.length,
    googleIds: Object.keys(inv.db.googleIndex).length,
    alreadyInLibrary: inv.links.filter((l) => l.kind === "original" && storage.exists(l.to)).length,
    hashes: null,
    records: {
      total: inv.records.length,
      proven: inv.records.filter((r) => r.proof.provenance === "proven").length,
      unproven: inv.records.filter((r) => r.proof.provenance === "unproven").length,
      reasons,
    },
    before,
    after: null,
    gate: settingsProblem ? [settingsProblem] : [],
    linkCounts: null,
  };
  if (!o.apply) {
    if (o.verifyHashes) {
      log("Checking every original against its content hash (reads only)…");
      const bad = await verifyOriginals(storage, inv.links, "from", (d, t) => {
        if (d % 400 === 0) log(`  ${d} of ${t} checked`);
        o.progress?.("Checking every image against its content hash", d, t);
      });
      report.hashes = { checked: report.images, bad };
    }
    return report;
  }
  if (report.blocked) return { ...report, status: "blocked" };
  if (settingsProblem)
    throw new Error(`Import stopped before changing anything: ${settingsProblem}.`);

  const locks = acquireAll(storage, [LOCKS.library, LOCKS.ai, LOCKS.store], {
    projectId: ctx.projectId,
    kind: "import",
  });
  if ("heldBy" in locks)
    return {
      ...report,
      status: "blocked",
      blocked: `Another job is running (${locks.heldBy?.kind ?? "unknown"} in ${locks.heldBy?.projectId ?? "the tool"}). Try again when it has finished.`,
    };
  const j = startJournal(storage, ctx, now);
  const save = () => saveJournal(storage, ctx, j);
  const fail = (step: NonNullable<ImportOptions["failAfter"]>) => {
    if (o.failAfter === step) throw new Error(`test failure after ${step}`);
  };
  try {
    // Taken again under the locks, so nothing can change between this and the check.
    const blockedNow = runningAnalysis(storage, ctx);
    if (blockedNow) throw new Error(`An analysis started meanwhile (${blockedNow}).`);
    await step("Recording the approval numbers and views before the import");
    report.before = takeSnapshot(legacy);
    save();
    log(`Linking ${inv.links.length} files into the shared library…`);
    report.linkCounts = await linkFiles(storage, inv, j, save, log, o.progress);
    report.hashes = { checked: report.images, bad: [] };
    fail("link");
    locks.check();
    await step("Saving image facts in the shared library");
    writeFacts(storage, inv, j, save, now);
    const staged = stagedRefsKey(ctx);
    j.created.push(staged);
    save();
    stageRefs(storage, ctx, inv, staged);
    fail("facts");
    locks.check();
    await step("Saving the analyses in the shared library");
    writeRecords(storage, ctx, inv, j, save);
    j.phase = "staged";
    save();
    fail("records");
    const stagedLoaded: LoadedConfig = { ...legacy, layout: { mode: "library", refsKey: staged } };
    await refreshIdentities(storage, stagedLoaded, j, save, o.progress);
    fail("identity");
    locks.check();
    log("Comparing the project before and after (images, approval numbers, reports, views)…");
    await step("Checking that nothing changed (images, approval numbers, reports, views)");
    report.after = takeSnapshot(stagedLoaded);
    report.gate = compareSnapshots(report.before, report.after);
    fail("gate");
    if (report.gate.length)
      throw new Error(`the check found differences: ${report.gate.join("; ")}`);
    // The old tool's analysis holds no lock, and the import yields while it works: check again.
    const lateRun = runningAnalysis(storage, ctx);
    if (lateRun) throw new Error(`An analysis started meanwhile (${lateRun}).`);
    locks.check();
    j.created = j.created.filter((k) => k !== staged); // becomes refs.json
    o.progress?.("Switching the project over");
    finishSwitch(storage, ctx, settings, j);
    log("Imported. The project now uses the shared library.");
    return { ...report, status: "imported" };
  } catch (e) {
    if (j.phase === "linking" || j.phase === "staged") {
      const left = rollback(storage, ctx, j);
      log(
        left.length
          ? `The project was not changed. ${left.length} library files could not be removed yet; the next import attempt removes them.`
          : "Nothing was changed: every library entry this import created was removed.",
      );
    }
    throw e;
  } finally {
    locks.release();
  }
}

function alreadyImported(legacy: LoadedConfig, settings: ProjectSettings): ImportReport {
  const loaded: LoadedConfig = { ...legacy, layout: undefined };
  const snap = takeSnapshot(loaded);
  return {
    projectId: legacy.config.project,
    name: settings.name,
    status: "already-imported",
    blocked: null,
    settings: { equal: true, overrides: [] },
    images: snap.imageCount,
    bytes: 0,
    files: {},
    pixelFacts: 0,
    googleIds: 0,
    alreadyInLibrary: snap.imageCount,
    hashes: null,
    records: { total: 0, proven: 0, unproven: 0, reasons: {} },
    before: snap,
    after: snap,
    gate: [],
    linkCounts: null,
  };
}
