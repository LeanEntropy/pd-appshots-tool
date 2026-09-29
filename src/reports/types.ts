import { z } from "zod";

/**
 * Several reports per project (docs/plan-reports.md, sections 1.3 and 4). A report is a def
 * (name, type, scope, archived, versions) in reports/defs/<id>.json; each version is an
 * immutable folder reports/<version id>/ (the existing run-folder convention).
 */
export const ReportTypeSchema = z.enum(["pilot", "core", "country", "compare", "stores"]);
export type ReportType = z.infer<typeof ReportTypeSchema>;

/** Plain names shown in the page (never the codes). */
export const TYPE_NAMES: Record<ReportType, string> = {
  pilot: "Pilot",
  core: "Full check",
  country: "One country",
  compare: "Compare countries",
  stores: "Google Play vs App Store",
};

/** Pilot and Full check are presets: never deleted, and re-doing one archives the previous version. */
export const isPreset = (t: ReportType): t is "pilot" | "core" => t === "pilot" || t === "core";

/** The store a report reads (plan-app-store 7.1); missing: Google Play. */
export const PlatformSchema = z.enum(["play", "appstore"]);
export type ReportPlatform = z.infer<typeof PlatformSchema>;
export const platformOfScope = (s: { platform?: ReportPlatform | undefined }): ReportPlatform =>
  s.platform === "appstore" ? "appstore" : "play";

/**
 * A preset of the Analysis page: the Pilot or the Google Play Full check. An App Store Full check
 * is a report of the builder (its main country and the core pick), built and run from the Reports tab.
 */
export const isPresetScope = (s: { type: ReportType; platform?: ReportPlatform | undefined }) =>
  isPreset(s.type) && platformOfScope(s) === "play";
/**
 * The store view a report's run and approval read images from: a "Google Play vs App Store"
 * report needs both stores' images, which the App Store view holds (plan-app-store 7.2).
 */
export const runPlatform = (d: { type: ReportType; scope: { platform?: ReportPlatform } }) =>
  d.type === "stores" ? "appstore" : platformOfScope(d.scope);
export const isPresetDef = (d: { type: ReportType; scope: { platform?: ReportPlatform } }) =>
  isPresetScope({ type: d.type, platform: d.scope.platform });

export const MarketRefSchema = z.object({ gl: z.string(), hl: z.string(), label: z.string() });
export type MarketRef = z.infer<typeof MarketRefSchema>;

export const ReportScopeSchema = z.object({
  type: ReportTypeSchema,
  /** The store the report reads; missing: Google Play (every report made before the App Store). */
  platform: PlatformSchema.optional(),
  markets: z.array(MarketRefSchema),
  /** App ids, in priority order. Empty for the presets: they are derived from the pick. */
  competitors: z.array(z.string()).default([]),
  includeCharts: z.array(z.string()).default([]),
  /**
   * Game and country combinations the user chose to leave out to stay within the spending limit
   * (explicit, shown in the report; distinct from "not sold here").
   */
  leftOut: z.array(z.object({ appId: z.string(), gl: z.string() })).optional(),
  /**
   * Compare countries: the groups of countries the "Across countries" section looks at (named by
   * the user, suggested by region and language). Absent: the suggested groups.
   */
  groups: z
    .array(z.object({ name: z.string().min(1).max(60), countries: z.array(z.string()) }))
    .max(4)
    .optional(),
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
  /** A One country report made by code from a Compare countries report (its country's part). */
  derivedFrom: z.object({ reportId: z.string(), gl: z.string() }).optional(),
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
      /** The country of the image (reports of other countries than the main one). */
      gl: z.string().optional(),
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
  /** Reports of the builder: the check they rest on ("pilot" while there is no Full check). */
  base: z.enum(["pilot", "core"]).nullable().optional(),
  /** A version made by code from a comparison's version (no AI call): where it came from. */
  derivedFrom: z
    .object({
      reportId: z.string(),
      versionId: z.string(),
      gl: z.string(),
      projection: z.string(),
    })
    .optional(),
  /** Derived versions: the country the report shows. */
  displayScope: z.object({ gl: z.string(), hl: z.string(), label: z.string() }).optional(),
  /**
   * Derived versions: every input that shaped the content, for "Newer data": this country's
   * analysed images and store dates, and the main country's check the advice rests on.
   */
  dependencyScope: z
    .object({
      records: z.array(
        z.object({
          appId: z.string(),
          position: z.number(),
          imageId: z.string().nullable(),
          updatedAt: z.string().nullable(),
        }),
      ),
      orderDates: z.record(z.string(), z.string().nullable()),
      /** The newest Full check (or Pilot) version when the comparison was made. */
      baseVersionId: z.string().nullable(),
    })
    .optional(),
});
export type VersionInputs = z.infer<typeof VersionInputsSchema>;

/** Generation date of a run folder id such as 2026-09-27T22-29-48-097Z-pilot. */
export function dateFromRunId(id: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(id);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}
