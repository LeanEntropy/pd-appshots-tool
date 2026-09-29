import { z } from "zod";
import { artWording, artWordingDeep } from "../analysis/art-wording.ts";
import { buildReportData } from "../analysis/report-data.ts";
import { reportInputs } from "../analysis/report-inputs.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { readJournal } from "../jobs/journal.ts";
import { draftsFromExpansion } from "../reports/drafts.ts";
import { listReports } from "../reports/list.ts";
import { mainMarketRef } from "../reports/main-market.ts";
import {
  deleteReport,
  listDefs,
  renameReport,
  runFolders,
  setArchived,
  versionFileKey,
} from "../reports/store.ts";
import { isPreset } from "../reports/types.ts";
import { settingsOf } from "../settings/access.ts";
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
  // Saved expansion choices become draft reports, once (plan-reports 7).
  const drafts = draftsFromExpansion(loaded);
  return {
    status: 200,
    body: {
      reports: listReports(loaded),
      notice: drafts.length
        ? `Your saved expansion choice is now a draft report: ${drafts.map((d) => `“${d.name}”`).join(", ")}.`
        : null,
      mainCountry: mainMarketRef(loaded).label,
      // The Settings page's Export PDF defaults (the page's export dialog starts from them).
      pdf: settingsOf(loaded.config).pdf,
    },
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
  let research: unknown = null;
  try {
    if (files.has("suggestions.json"))
      research = s.getJson(versionFileKey(paths, entry.id, "suggestions.json")) ?? null;
  } catch {
    // An unreadable list is simply not shown.
  }
  const meta = {
    versionId: entry.id,
    generatedAt: entry.generatedAt,
    archived: entry.archived,
    research,
  };
  let note = "";
  if (files.has("country-report.json")) {
    try {
      const raw = s.getJson(versionFileKey(paths, entry.id, "country-report.json")) as {
        kind?: unknown;
        countries?: unknown;
      };
      if (raw?.kind === "countries" && Array.isArray(raw.countries))
        return {
          status: 200,
          body: {
            ...meta,
            country: artWordingDeep(raw),
            // The written report too: the basic PDF export prints it.
            html: markdownToHtml(
              artWording(s.getText(versionFileKey(paths, entry.id, "report.md")) ?? ""),
            ),
          },
        };
    } catch {
      // Unreadable: shown as its markdown below.
    }
    note = "The saved data of this version is incomplete, so it is shown as its written report.";
  }
  if (files.has("countries.json")) {
    try {
      const raw = s.getJson(versionFileKey(paths, entry.id, "countries.json")) as {
        countries?: { gl?: unknown; label?: unknown; data?: unknown }[];
      };
      const countries = (raw?.countries ?? []).filter(
        (c) => typeof c.label === "string" && SavedDataSchema.safeParse(c.data).success,
      );
      if (countries.length)
        return {
          status: 200,
          body: {
            ...meta,
            countries: countries.map((c) => ({ ...c, data: artWordingDeep(c.data) })),
            // The written report too: the PDF export prints it (one renderer per country page).
            html: files.has("report.md")
              ? markdownToHtml(
                  artWording(s.getText(versionFileKey(paths, entry.id, "report.md")) ?? ""),
                ).replaceAll('"../../images/', '"../images/')
              : "",
          },
        };
    } catch {
      // Unreadable: shown as its markdown below.
    }
    note = "The saved data of this version is incomplete, so it is shown as its written report.";
  }
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
  const s = workspaceStorage(paths.workspace);
  const job = readJournal(s, paths).jobs.ai;
  if (job?.state === "running" && job.reportId === def.id)
    return {
      status: 409,
      body: { problems: ["This report is running. Stop the run first, then delete it."] },
    };
  const r = deleteReport(s, paths, def.id);
  if (!r.ok) return { status: r.status, body: { problems: [r.problem] } };
  return { status: 200, body: { id: def.id, deleted: true } };
}
