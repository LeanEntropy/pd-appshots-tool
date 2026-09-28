import { z } from "zod";
import { PROJECT_ID } from "../storage/types.ts";
import { ConfigBase } from "./schema.ts";

const PackageId = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/, "package id");

/** Tool defaults (configs/defaults.json): everything in Config that is not project-specific. */
export const ToolDefaultsSchema = ConfigBase.pick({
  workspace: true,
  download: true,
  core: true,
  review: true,
  budget: true,
  estimates: true,
  run: true,
  tierWeights: true,
  models: true,
  taxonomy: true,
}).extend({
  schemaVersion: z.literal(1),
  charts: z.object({
    analyse: z.literal("only-if-picked"),
    includeBaselineLocale: z.boolean(),
  }),
});
export type ToolDefaults = z.infer<typeof ToolDefaultsSchema>;

const Tier = z.enum(["direct", "same_audience", "reference"]);
const Section = z.record(z.string(), z.unknown());

/** One project's settings (workspace/<id>/project.json), written only by the tool. */
export const ProjectSettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(PROJECT_ID, "lowercase letters, digits and dashes"),
    name: z.string().min(1).max(100),
    createdAt: z.string(),
    updatedAt: z.string(),
    ourApp: z.object({
      id: PackageId,
      name: z.string().min(1),
      developer: z.string().optional(),
      genreId: z.string().optional(),
      iconFile: z.string().optional(),
    }),
    competitors: z
      .array(
        z.object({
          id: PackageId,
          name: z.string().min(1),
          developer: z.string().optional(),
          genreId: z.string().optional(),
          tier: Tier,
          iconFile: z.string().optional(),
          addedAt: z.string(),
          /**
           * Set when the game is not on Google Play in the United States: the first of the
           * project's countries where it was found. It is then not in the US core check.
           */
          reference: z
            .object({
              gl: z.string().regex(/^[a-z]{2}$/),
              hl: z.string().min(2),
              label: z.string(),
            })
            .optional(),
        }),
      )
      .max(60),
    markets: z
      .array(
        z.object({
          gl: z.string().regex(/^[a-z]{2}$/),
          hl: z.string().min(2),
          label: z.string().min(1),
        }),
      )
      .min(1)
      .max(40),
    charts: z.object({
      enabled: z.boolean(),
      collection: z.enum(["GROSSING", "TOP_FREE", "TOP_PAID"]),
      depth: z.number().int().min(1).max(50),
    }),
    category: z.string().min(1),
    ownAssets: z.object({ dir: z.string().min(1), psd: z.string().optional() }).optional(),
    /**
     * Advanced values that differ from the tool defaults (not in the UI yet). Only tool-default
     * sections are allowed, so an override can never change the project, its game or folder.
     */
    overrides: z
      .strictObject({
        download: Section,
        core: Section,
        review: Section,
        budget: Section,
        estimates: Section,
        run: Section,
        tierWeights: Section,
        models: Section,
        taxonomy: z.string().min(1),
      })
      .partial()
      .optional(),
    archived: z.boolean().optional(),
    /** Present while the new-project steps are not finished: the step to reopen on (1 to 5). */
    setupStep: z.number().int().min(1).max(5).optional(),
  })
  .superRefine((s, ctx) => {
    const ids = s.competitors.map((c) => c.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        path: ["competitors"],
        message: "a competitor is listed twice",
      });
    if (ids.includes(s.ourApp.id))
      ctx.addIssue({
        code: "custom",
        path: ["competitors"],
        message: "your own game cannot be a competitor",
      });
    const first = s.markets[0];
    if (first?.gl !== "us" || first.hl !== "en")
      ctx.addIssue({
        code: "custom",
        path: ["markets"],
        message: "United States (English) must be the first country",
      });
    const gls = s.markets.map((m) => m.gl);
    if (new Set(gls).size !== gls.length)
      ctx.addIssue({ code: "custom", path: ["markets"], message: "one language per country" });
  });
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/**
 * A draft cannot run anything yet: it needs our game, a competitor and US English, and the
 * new-project steps must be finished.
 */
export function isDraft(s: ProjectSettings): boolean {
  return s.competitors.length === 0 || s.setupStep !== undefined;
}
