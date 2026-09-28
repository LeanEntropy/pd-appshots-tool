import { z } from "zod";
import { artWording, artWordingDeep } from "../analysis/art-wording.ts";
import { buildReportData } from "../analysis/report-data.ts";
import { reportInputs } from "../analysis/report-inputs.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { listReports } from "../reports/list.ts";
import { mainMarket } from "../reports/main-market.ts";
import {
  deleteReport,
  listDefs,
  renameReport,
  runFolders,
  setArchived,
  versionFileKey,
} from "../reports/store.ts";
import { isPreset } from "../reports/types.ts";
import { workspaceStorage } from "../storage/index.ts";
import { markdownToHtml } from "../view/md-html.ts";
import type { ApiResponse } from "./api.ts";

/** Several reports per project (plan-reports R1): list, read a version, rename, archive, delete. */

const REPORT_ID = /^r-[a-z0-9-]{1,80}$/;
const gone = (): ApiResponse => ({
  status: 404,
  body: { problems: ["This report no longer exists. Reload the page."] },
});

function findDef(loaded: LoadedConfig, id: string) {
  if (!REPORT_ID.test(id)) return undefined;
  const paths = projectPaths(loaded);
  return listDefs(workspaceStorage(paths.workspace), paths).find((d) => d.id === id);
}

export function getReports(loaded: LoadedConfig): ApiResponse {
  return {
    status: 200,
    body: { reports: listReports(loaded), mainCountry: mainMarket(loaded).label },
  };
}

/** The minimum a saved report-data.json needs before the page renders it (else its markdown). */
const SavedDataSchema = z
  .object({
    games: z.array(z.object({ rows: z.array(z.unknown()) }).loose()),
    synthesis: z.object({ state: z.string() }).loose(),
    coverage: z.object({ used: z.number(), total: z.number() }).loose(),
    examples: z.record(z.string(), z.unknown()),
  })
  .loose();

/**
 * One version of a report, or "now" (the Pilot or Full check from the saved analyses, no AI).
 * Both ids must be listed ones, so no path is ever taken from the request.
 */
export function getReportVersion(loaded: LoadedConfig, id: string, vid: string): ApiResponse {
  const def = findDef(loaded, id);
  if (!def) return gone();
  if (vid === "now") {
    if (!isPreset(def.type))
      return { status: 404, body: { problems: ["This report has no live view."] } };
    return {
      status: 200,
      body: { now: true, data: buildReportData(reportInputs(loaded, def.type)) },
    };
  }
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const entry = def.versions.find((v) => v.id === vid);
  const files = entry ? runFolders(s, paths).get(entry.id) : undefined;
  if (!entry || !files)
    return {
      status: 404,
      body: { problems: ["This version could not be found. Reload the page."] },
    };
  const meta = { versionId: entry.id, generatedAt: entry.generatedAt, archived: entry.archived };
  let note = "";
  if (files.has("report-data.json")) {
    try {
      const raw = s.getJson(versionFileKey(paths, entry.id, "report-data.json"));
      // Saved before the art-screen wording rule: reworded for display (no AI, nothing re-analysed).
      if (SavedDataSchema.safeParse(raw).success)
        return { status: 200, body: { ...meta, data: artWordingDeep(raw) } };
    } catch {
      // Unreadable: shown as its markdown below.
    }
    note = "The saved data of this version is incomplete, so it is shown as its written report.";
  }
  const name = files.has("report.md") ? "report.md" : "pilot.md";
  const mdKey = versionFileKey(paths, entry.id, name);
  const md = files.has(name) ? (s.getText(mdKey) ?? "") : "";
  // Old runs link images as ../../images/ (from reports/<run>/); the page sits in views/.
  const html = markdownToHtml(artWording(md)).replaceAll('"../../images/', '"../images/');
  return {
    status: 200,
    body: { ...meta, html, note, file: files.has(name) ? s.localPath(mdKey) : "" },
  };
}

const PatchBody = z
  .object({ name: z.string().max(120).optional(), archived: z.boolean().optional() })
  .strict()
  .refine((b) => b.name !== undefined || b.archived !== undefined);

export function patchReport(loaded: LoadedConfig, id: string, body: unknown): ApiResponse {
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success)
    return { status: 400, body: { problems: ["The page sent a change the tool cannot read."] } };
  const def = findDef(loaded, id);
  if (!def) return gone();
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const { name, archived } = parsed.data;
  const changes = [
    name === undefined ? null : () => renameReport(s, paths, def.id, name),
    archived === undefined ? null : () => setArchived(s, paths, def.id, archived),
  ];
  let last = def;
  for (const change of changes) {
    if (!change) continue;
    const r = change();
    if (!r.ok) return { status: r.status, body: { problems: [r.problem] } };
    last = r.def;
  }
  return { status: 200, body: { id: last.id, name: last.name, archived: last.archived } };
}

export function removeReport(loaded: LoadedConfig, id: string): ApiResponse {
  const def = findDef(loaded, id);
  if (!def) return gone();
  const paths = projectPaths(loaded);
  const r = deleteReport(workspaceStorage(paths.workspace), paths, def.id);
  if (!r.ok) return { status: r.status, body: { problems: [r.problem] } };
  return { status: 200, body: { id: def.id, deleted: true } };
}
