import { z } from "zod";
import { labeler } from "../analysis/labels.ts";
import { summaries } from "../analysis/records.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { getReportCurrent, getReportRun } from "../server/report-api.ts";
import { projectKey } from "../storage/index.ts";
import { sha256 } from "../util/hash.ts";
import type { PrintPage } from "../view/report-print.ts";
import { reportPrintHtml } from "../view/report-print.ts";

/**
 * Which report to export. Today: a batch ("pilot" or "core") and its run ("current" for the
 * report as it stands now, or a saved run id). The report list (milestone R1) passes its own
 * report and version here; only this file maps a reference onto the saved data.
 */
export const ReportRefSchema = z.strictObject({
  stage: z.enum(["pilot", "core"]),
  run: z.string().min(1).max(100),
});
export type ReportRef = z.infer<typeof ReportRefSchema>;

/** The export dialog's choices (A4 landscape by default, plan decision D4). */
export const ExportOptionsSchema = z.strictObject({
  images: z.boolean().default(true),
  paper: z.enum(["A4", "Letter"]).default("A4"),
  landscape: z.boolean().default(true),
  /** Sections whose pictures the user hid; only sent when they ticked "also hide those". */
  hiddenSections: z
    .array(z.string().regex(/^[a-z]{1,20}$/))
    .max(12)
    .default([]),
});
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;

export interface ReportSource {
  page: PrintPage;
  /** Storage folder of this version's derived PDFs. */
  folder: string;
  /** The download name: "<report name> <date>.pdf". */
  fileName: string;
}

const KIND = { pilot: "Pilot", core: "Full check" } as const;

interface DataLike {
  market?: string;
  games?: { name: string; ours: boolean; orderDate: string | null }[];
}

function when(runId: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/.exec(runId);
  return m ? `${m[1]} ${m[2]}:${m[3]} UTC` : runId;
}

/** A file name Windows, macOS and Linux all accept. */
export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\p{Cc}]/gu, "-").slice(0, 150);
}

/** The report behind a reference, ready for the print page; a problem when it does not exist. */
export function reportSource(
  loaded: LoadedConfig,
  ref: ReportRef,
  options: ExportOptions,
): ReportSource | { status: number; problem: string } {
  const paths = projectPaths(loaded);
  const current = ref.run === "current";
  const r = current
    ? getReportCurrent(loaded, ref.stage)
    : getReportRun(loaded, ref.stage, ref.run);
  const body = r.body as { data?: DataLike; html?: string; problems?: string[] };
  if (r.status !== 200 || (!body.data && !body.html))
    return {
      status: r.status === 200 ? 404 : r.status,
      problem: (body.problems ?? ["No such report."]).join(" "),
    };
  const d = body.data ?? null;
  const kind = KIND[ref.stage];
  // "United States (English)" reads as "Pilot (United States, English)".
  const title = d?.market ? `${kind} (${d.market.replace(/ \(([^()]+)\)$/, ", $1")})` : kind;
  const today = new Date().toISOString().slice(0, 10);
  const built = current ? `${today}, from the saved analyses` : when(ref.run);
  const storeDates = (d?.games ?? []).map((g) => g.orderDate).filter((x): x is string => !!x);
  const facts: [string, string][] = [
    ["Report type", kind],
    ...(d?.market ? [["Country", d.market] as [string, string]] : []),
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
    ["Version", current ? "Now (from the saved analyses)" : `Run ${ref.run}`],
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
  };
  const folder = projectKey(
    paths,
    "reports",
    current ? `current-${ref.stage}` : ref.run,
    "exports",
  );
  const date = current ? today : ref.run.slice(0, 10);
  return { page, folder, fileName: `${safeFileName(`${title} ${date}`)}.pdf` };
}

/** The export's key: the whole print page (data, options, renderer and stylesheet) plus paper. */
export function exportHash(src: ReportSource, options: ExportOptions): string {
  const html = reportPrintHtml(src.page);
  return sha256(`${html}\n${options.paper}\n${options.landscape}`).slice(0, 20);
}

/** The print page's query string for a reference and options (parsed back by `printQuery`). */
export function printQuery(ref: ReportRef, options: ExportOptions): string {
  const q = new URLSearchParams({
    stage: ref.stage,
    run: ref.run,
    images: options.images ? "1" : "0",
    hidden: options.hiddenSections.join(","),
  });
  return q.toString();
}

export function parsePrintQuery(
  q: URLSearchParams,
): { ref: ReportRef; options: ExportOptions } | null {
  const ref = ReportRefSchema.safeParse({ stage: q.get("stage"), run: q.get("run") });
  const hidden = (q.get("hidden") ?? "").split(",").filter(Boolean);
  const options = ExportOptionsSchema.safeParse({
    images: q.get("images") !== "0",
    hiddenSections: hidden,
  });
  return ref.success && options.success ? { ref: ref.data, options: options.data } : null;
}
