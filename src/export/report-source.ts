import { z } from "zod";
import { labeler } from "../analysis/labels.ts";
import { summaries } from "../analysis/records.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import type { Config } from "../config/schema.ts";
import { listDefs } from "../reports/store.ts";
import { TYPE_NAMES } from "../reports/types.ts";
import { getReportVersion } from "../server/reports-api.ts";
import { settingsOf } from "../settings/access.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import { sha256 } from "../util/hash.ts";
import type { PrintPage } from "../view/report-print.ts";
import { reportPrintHtml } from "../view/report-print.ts";

/**
 * Which report to export: one VERSION of one report of the report list (plan-reports R1).
 * `version` is a saved version id, or "now" for the Pilot or Full check as it stands now (from
 * the saved analyses). Only this file maps a reference onto the saved data.
 */
export const ReportRefSchema = z.strictObject({
  report: z.string().regex(/^r-[a-z0-9-]{1,80}$/),
  version: z.string().regex(/^(now|[A-Za-z0-9-]{1,100})$/),
});
export type ReportRef = z.infer<typeof ReportRefSchema>;

/**
 * The export dialog's choices as the page sends them; a missing one takes the Settings page's
 * PDF default (settingsOf(config).pdf, A4 landscape with pictures unless changed there).
 */
export const ExportOptionsSchema = z.strictObject({
  images: z.boolean().optional(),
  paper: z.enum(["A4", "Letter"]).optional(),
  landscape: z.boolean().optional(),
  /** Sections whose pictures the user hid; only sent when they ticked "also hide those". */
  hiddenSections: z
    .array(z.string().regex(/^[a-z]{1,20}$/))
    .max(12)
    .default([]),
});

export interface ExportOptions {
  images: boolean;
  paper: "A4" | "Letter";
  landscape: boolean;
  hiddenSections: string[];
}

/** The page's choices completed with the Settings page's PDF defaults. */
export function exportOptions(
  config: Config,
  o: z.infer<typeof ExportOptionsSchema>,
): ExportOptions {
  const d = settingsOf(config).pdf;
  return {
    images: o.images ?? d.images,
    paper: o.paper ?? d.paper,
    landscape: o.landscape ?? d.orientation === "landscape",
    hiddenSections: o.hiddenSections,
  };
}

export interface ReportSource {
  page: PrintPage;
  /** Storage folder of this version's derived PDFs. */
  folder: string;
  /** The download name: "<report name> <date>.pdf". */
  fileName: string;
}

interface DataLike {
  market?: string;
  games?: { name: string; ours: boolean; orderDate: string | null }[];
}

function when(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}:${m[3]} UTC` : iso;
}

/** A file name Windows, macOS and Linux all accept. */
export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\p{Cc}]/gu, "-").slice(0, 150);
}

/** The report version behind a reference, ready for the print page; a problem when it does not exist. */
export function reportSource(
  loaded: LoadedConfig,
  ref: ReportRef,
  options: ExportOptions,
): ReportSource | { status: number; problem: string } {
  const paths = projectPaths(loaded);
  const def = listDefs(workspaceStorage(paths.workspace), paths).find((d) => d.id === ref.report);
  const r = getReportVersion(loaded, ref.report, ref.version);
  const body = r.body as {
    data?: DataLike;
    html?: string;
    problems?: string[];
    generatedAt?: string;
    archived?: boolean;
  };
  if (!def || r.status !== 200 || (!body.data && !body.html))
    return {
      status: r.status === 200 ? 404 : r.status,
      problem: (body.problems ?? ["No such report."]).join(" "),
    };
  const now = ref.version === "now";
  const d = body.data ?? null;
  const kind = TYPE_NAMES[def.type];
  const title = def.name;
  const today = new Date().toISOString().slice(0, 10);
  const generated = body.generatedAt ?? "";
  const built = now ? `${today}, from the saved analyses` : when(generated);
  const countries = d?.market ?? def.scope.markets.map((m) => m.label).join(", ");
  const storeDates = (d?.games ?? []).map((g) => g.orderDate).filter((x): x is string => !!x);
  const facts: [string, string][] = [
    ["Report type", kind],
    ...(countries ? [["Country", countries] as [string, string]] : []),
    ...(d?.games
      ? [
          [
            "Competitors",
            d.games
              .filter((g) => !g.ours)
              .map((g) => g.name)
              .join(", ") || "none",
          ] as [string, string],
        ]
      : []),
    ["Generated", built],
    ...(storeDates.length
      ? [["Store data read", storeDates.sort().at(-1) ?? ""] as [string, string]]
      : []),
    [
      "Version",
      now
        ? "Now (from the saved analyses)"
        : `${when(generated)}${body.archived ? " (earlier version, archived)" : ""}`,
    ],
    ["Pictures", options.images ? "Included" : "Left out"],
  ];
  const label = labeler(loadTaxonomy(loaded).taxonomy);
  const captions: Record<string, string> = {};
  if (d && options.images)
    for (const [id, v] of summaries(paths, label))
      captions[id] = v.headline ? `${v.screen}: "${v.headline}"` : v.screen;
  const page: PrintPage = {
    title,
    kind,
    facts,
    data: d,
    html: d ? null : (body.html ?? null),
    captions,
    images: options.images,
    hiddenSections: options.hiddenSections,
    reportId: def.id,
    stage: def.type === "core" ? "core" : "pilot",
  };
  // A saved version's PDFs live in its own folder (deleted with the report); "now" has its own.
  const folder = projectKey(paths, "reports", now ? `now-${def.id}` : ref.version, "exports");
  const date = now ? today : generated.slice(0, 10) || today;
  return { page, folder, fileName: `${safeFileName(`${title} ${date}`)}.pdf` };
}

/** The export's key: the whole print page (data, options, renderer and stylesheet) plus paper. */
export function exportHash(src: ReportSource, options: ExportOptions): string {
  const html = reportPrintHtml(src.page);
  return sha256(`${html}\n${options.paper}\n${options.landscape}`).slice(0, 20);
}

/** The print page's query string for a reference and options (parsed back by `parsePrintQuery`). */
export function printQuery(ref: ReportRef, options: ExportOptions): string {
  const q = new URLSearchParams({
    report: ref.report,
    version: ref.version,
    images: options.images ? "1" : "0",
    hidden: options.hiddenSections.join(","),
  });
  return q.toString();
}

export function parsePrintQuery(
  config: Config,
  q: URLSearchParams,
): { ref: ReportRef; options: ExportOptions } | null {
  const ref = ReportRefSchema.safeParse({ report: q.get("report"), version: q.get("version") });
  const hidden = (q.get("hidden") ?? "").split(",").filter(Boolean);
  const images = q.get("images");
  const options = ExportOptionsSchema.safeParse({
    images: images === null ? undefined : images !== "0",
    hiddenSections: hidden,
  });
  return ref.success && options.success
    ? { ref: ref.data, options: exportOptions(config, options.data) }
    : null;
}
