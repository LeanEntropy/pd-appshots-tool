import { z } from "zod";

/**
 * Several reports per project (docs/plan-reports.md, sections 1.3 and 4). A report is a def
 * (name, type, scope, archived, versions) in reports/defs/<id>.json; each version is an
 * immutable folder reports/<version id>/ (the existing run-folder convention).
 */
export const ReportTypeSchema = z.enum(["pilot", "core", "country", "compare"]);
export type ReportType = z.infer<typeof ReportTypeSchema>;

/** Plain names shown in the page (never the codes). */
export const TYPE_NAMES: Record<ReportType, string> = {
  pilot: "Pilot",
  core: "Full check",
  country: "One country",
  compare: "Compare countries",
};

/** Pilot and Full check are presets: never deleted, and re-doing one archives the previous version. */
export const isPreset = (t: ReportType): t is "pilot" | "core" => t === "pilot" || t === "core";

export const MarketRefSchema = z.object({ gl: z.string(), hl: z.string(), label: z.string() });
export type MarketRef = z.infer<typeof MarketRefSchema>;

export const ReportScopeSchema = z.object({
  type: ReportTypeSchema,
  markets: z.array(MarketRefSchema),
  /** App ids, in priority order. Empty for the presets: they are derived from the pick. */
  competitors: z.array(z.string()).default([]),
  includeCharts: z.array(z.string()).default([]),
});
export type ReportScope = z.infer<typeof ReportScopeSchema>;

export const VersionEntrySchema = z.object({
  id: z.string(),
  /** When this version was generated (ISO). */
  generatedAt: z.string(),
  /** Earlier Pilot and Full check versions are archived automatically; never deleted. */
  archived: z.boolean().default(false),
});
export type VersionEntry = z.infer<typeof VersionEntrySchema>;

export const ReportDefSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: ReportTypeSchema,
  scope: ReportScopeSchema,
  createdAt: z.string(),
  archived: z.boolean().default(false),
  /** Oldest first. */
  versions: z.array(VersionEntrySchema).default([]),
});
export type ReportDef = z.infer<typeof ReportDefSchema>;

/** version.json: what a version was built from (write-once). Older run folders have none. */
export const VersionInputsSchema = z.object({
  reportId: z.string(),
  type: ReportTypeSchema,
  generatedAt: z.string(),
  createdAt: z.string(),
  mainMarket: MarketRefSchema,
  scope: ReportScopeSchema,
  /** The games and positions used (for the presets: the pick at build time). */
  pick: z.array(z.object({ appId: z.string(), name: z.string(), positions: z.array(z.number()) })),
  /** Store-order snapshot date per game, null when none was saved. */
  orderDates: z.record(z.string(), z.string().nullable()),
  /** Record key (image id) and record time per game and position; null when not analysed. */
  records: z.array(
    z.object({
      appId: z.string(),
      position: z.number(),
      imageId: z.string().nullable(),
      updatedAt: z.string().nullable(),
    }),
  ),
  versions: z.object({
    prompts: z.record(z.string(), z.string()),
    schema: z.string(),
    taxonomy: z.string(),
    fit: z.string(),
  }),
  planHash: z.string().nullable(),
  /** Fingerprint of the data the version was built from (the "Newer data" comparison). */
  dataHash: z.string().nullable(),
  /** The analysis run that wrote the AI parts, if any. */
  aiRunId: z.string().nullable(),
});
export type VersionInputs = z.infer<typeof VersionInputsSchema>;

/** Generation date of a run folder id such as 2026-09-27T22-29-48-097Z-pilot. */
export function dateFromRunId(id: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(id);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}
