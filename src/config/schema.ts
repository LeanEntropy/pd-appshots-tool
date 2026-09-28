import { z } from "zod";
import { OptionsSchema } from "../settings/schema.ts";

const Tier = z.enum(["direct", "same_audience", "reference"]);

const Competitor = z.object({
  name: z.string().min(1),
  id: z.string().regex(/^[A-Za-z0-9_.]+$/, "must be a Google Play package id"),
  tier: Tier,
});

const Market = z.object({
  gl: z.string().regex(/^[a-z]{2}$/, "two-letter country code"),
  hl: z.string().min(2),
  label: z.string().min(1),
  baseline: z.boolean().default(false),
});

const ModelRef = z
  .string()
  .regex(/^(claude|codex):[a-z0-9.-]+$/, 'model reference like "claude:claude-opus-5-5"');

/** The config object without its cross-field rules (Zod cannot pick from a refined schema). */
export const ConfigBase = z.object({
  schemaVersion: z.literal(1),
  project: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, digits and dashes"),
  workspace: z.string().default("workspace"),
  ourApp: z.object({
    name: z.string().min(1),
    id: z.string().regex(/^[A-Za-z0-9_.]+$/, "must be a Google Play package id"),
  }),
  category: z.string().default("auto"),
  competitors: z.array(Competitor).min(1),
  markets: z.array(Market).min(1),
  charts: z.object({
    /** Absent means on; written only when a project switches charts off. */
    enabled: z.boolean().optional(),
    collection: z.enum(["GROSSING", "TOP_FREE", "TOP_PAID"]),
    depth: z.number().int().min(1).max(50),
    analyse: z.literal("only-if-picked"),
    includeBaselineLocale: z.boolean().default(true),
  }),
  download: z.object({
    namedCompetitorMarkets: z.enum(["all", "baseline"]).default("all"),
    ourMarkets: z.enum(["all", "baseline"]).default("all"),
    requestDelayMs: z.number().int().min(200).default(800),
    imageConcurrency: z.number().int().min(1).max(4).default(2),
    imageDelayMs: z.number().int().min(0).default(250),
    metadataCacheHours: z.number().min(0).default(24),
    estimatedBytesPerImage: z.number().int().positive().default(1_000_000),
  }),
  core: z.object({
    market: z.string().regex(/^[a-z]{2}$/),
    imageCap: z.number().int().positive().default(100),
    imageTarget: z.number().int().positive().default(85),
    minCompetitors: z.number().int().min(1).default(5),
    maxCompetitors: z.number().int().min(1).default(8),
    pilotCompetitors: z.number().int().min(1).default(2),
    slotCountCap: z.number().int().min(1).default(8),
    /** Device classes analysed in the core check; others are kept and shown raw. */
    deviceClasses: z
      .array(z.enum(["phone", "tablet", "unknown"]))
      .min(1)
      .default(["phone"]),
    stability: z.object({
      minDecks: z.number().int().min(1).default(5),
      window: z.number().int().min(1).default(2),
      maxShareShift: z.number().min(0).max(1).default(0.1),
    }),
  }),
  review: z.object({
    enabled: z.boolean().default(true),
    coreCoverage: z.number().min(0).max(1).default(1),
    expansionCoverage: z.number().min(0).max(1).default(1),
    alsoBelowConfidence: z.number().min(0).max(1).default(0.7),
  }),
  budget: z.object({ maxUsdPerIncrement: z.number().positive().default(30) }),
  /** Provisional unit costs for approval screens; replaced by measured pilot costs later. */
  estimates: z
    .object({
      fullAnalysisUsdPerImage: z.tuple([z.number(), z.number()]).default([0.15, 0.25]),
      layerDiffUsdPerImage: z.tuple([z.number(), z.number()]).default([0.03, 0.06]),
      adjudicationUsdPerDispute: z.number().default(0.1),
      expectedDisputeRate: z.number().min(0).max(1).default(0.1),
      retryAllowance: z.number().min(0).max(1).default(0.15),
      reviewTokensPerImage: z.number().int().default(17000),
      imagesPerCall: z.number().int().min(1).max(20).default(1),
      /** Pattern summary + recommendations + review + a possible revision, per batch. */
      synthesisUsd: z.tuple([z.number(), z.number()]).default([0.6, 1.5]),
    })
    .default({
      fullAnalysisUsdPerImage: [0.15, 0.25],
      layerDiffUsdPerImage: [0.03, 0.06],
      adjudicationUsdPerDispute: 0.1,
      expectedDisputeRate: 0.1,
      retryAllowance: 0.15,
      reviewTokensPerImage: 17000,
      imagesPerCall: 1,
      synthesisUsd: [0.6, 1.5],
    }),
  /** A batch stops after this many images in a row fail with the same error. */
  run: z.object({ stopAfterSameErrors: z.number().int().min(1).default(3) }).default({
    stopAfterSameErrors: 3,
  }),
  tierWeights: z.object({
    direct: z.number().positive(),
    same_audience: z.number().positive(),
    reference: z.number().positive(),
    chart: z.number().positive(),
  }),
  models: z.object({
    fullAnalysis: ModelRef,
    layerDiff: ModelRef,
    imageReview: ModelRef,
    imageReviewSpecial: ModelRef.optional(),
    adjudicate: ModelRef,
    translate: ModelRef,
    recommend: ModelRef,
    recommendationReview: ModelRef,
    codeReview: ModelRef,
  }),
  taxonomy: z.string().min(1),
  /** Local screenshots and PSD of our game; optional (only Rogue Legend has them for now). */
  ownAssets: z
    .object({
      dir: z.string().min(1),
      psd: z.string().optional(),
    })
    .optional(),
  /** Settings page values with no older home (src/settings/schema.ts); all have defaults. */
  options: OptionsSchema,
});

export const ConfigSchema = ConfigBase.superRefine((c, ctx) => {
  const marketPairs = c.markets.map((m) => `${m.gl}|${m.hl}`);
  if (new Set(marketPairs).size !== marketPairs.length) {
    ctx.addIssue({
      code: "custom",
      path: ["markets"],
      message: "a country and language pair is listed twice",
    });
  }
  if (c.core.pilotCompetitors > c.core.maxCompetitors) {
    ctx.addIssue({ code: "custom", path: ["core", "pilotCompetitors"], message: "above max" });
  }
  const baselines = c.markets.filter((m) => m.baseline);
  if (baselines.length !== 1) {
    ctx.addIssue({ code: "custom", path: ["markets"], message: "exactly one baseline market" });
  }
  if (c.markets.filter((m) => m.gl === c.core.market).length !== 1) {
    ctx.addIssue({
      code: "custom",
      path: ["core", "market"],
      message: "must match exactly one market (one language for that country)",
    });
  }
  if (c.core.imageTarget > c.core.imageCap) {
    ctx.addIssue({ code: "custom", path: ["core", "imageTarget"], message: "above the cap" });
  }
  if (c.core.minCompetitors > c.core.maxCompetitors) {
    ctx.addIssue({ code: "custom", path: ["core", "minCompetitors"], message: "above max" });
  }
  const ids = c.competitors.map((x) => x.id);
  if (new Set(ids).size !== ids.length || ids.includes(c.ourApp.id)) {
    ctx.addIssue({ code: "custom", path: ["competitors"], message: "duplicate package id" });
  }
  const family = (ref: string) => ref.split(":")[0];
  const pairs: [string, string][] = [
    ["fullAnalysis", "imageReview"],
    ["recommend", "recommendationReview"],
  ];
  for (const [producer, reviewer] of pairs) {
    const p = c.models[producer as keyof typeof c.models];
    const r = c.models[reviewer as keyof typeof c.models];
    if (p && r && family(p) === family(r)) {
      ctx.addIssue({
        code: "custom",
        path: ["models", reviewer],
        message: "the reviewer must be from a different model family than the producer",
      });
    }
  }
  for (const [role, ref] of Object.entries(c.models)) {
    if (role !== "imageReviewSpecial" && ref?.includes("gpt-6-astra")) {
      ctx.addIssue({
        code: "custom",
        path: ["models", role],
        message: "GPT-6 Astra is reserved for special image-review cases only",
      });
    }
  }
  settingsRules(c, ctx);
});

/** Rules of the Settings page (plan-reports 5B): main country, model choices, review families. */
function settingsRules(c: z.infer<typeof ConfigBase>, ctx: z.RefinementCtx): void {
  const base = c.markets.find((m) => m.baseline);
  if (base && base.gl !== c.core.market)
    ctx.addIssue({
      code: "custom",
      path: ["core", "market"],
      message: "the main country must be the baseline country",
    });
  const models: [string[], string | undefined][] = [
    ...Object.entries(c.models).map(([k, v]): [string[], string | undefined] => [["models", k], v]),
    ...Object.entries(c.options.models).map(([k, v]): [string[], string] => [
      ["options", "models", k],
      v,
    ]),
  ];
  const readsImages = ["fullAnalysis", "imageReview", "adjudicate", "layerDiff"];
  for (const [path, ref] of models) {
    if (!ref) continue;
    if (/haiku/.test(ref))
      ctx.addIssue({ code: "custom", path, message: "Haiku is not used for the tool's AI steps" });
    if (path[0] === "models" && readsImages.includes(path[1] ?? "") && /sonnet/.test(ref))
      ctx.addIssue({ code: "custom", path, message: "Sonnet is not used to read screenshots" });
    if (path[0] === "options" && ref.includes("gpt-6-astra"))
      ctx.addIssue({
        code: "custom",
        path,
        message: "GPT-6 Astra is reserved for special image-review cases only",
      });
  }
  const family = (ref: string) => ref.split(":")[0];
  const reviewer = c.models.recommendationReview;
  const on = c.options.secondOpinion;
  const text: [keyof typeof on, string][] = [
    ["countryAdvice", c.options.models.countryAdvice],
    ["conceptMap", c.options.models.conceptMap],
    ["abTests", c.options.models.abTests],
  ];
  for (const [step, ref] of text) {
    if (on[step] && family(ref) === family(reviewer))
      ctx.addIssue({
        code: "custom",
        path: ["options", "models", step],
        message: "the reviewer must be from a different model family than the producer",
      });
  }
  if (on.textLayer && family(c.models.layerDiff) === family(c.models.imageReview))
    ctx.addIssue({
      code: "custom",
      path: ["models", "layerDiff"],
      message: "the reviewer must be from a different model family than the producer",
    });
}

export type Config = z.infer<typeof ConfigSchema>;
export type Competitor = z.infer<typeof Competitor>;
export type Market = z.infer<typeof Market>;
export type Tier = z.infer<typeof Tier>;

/** Selection of core competitors written back by the raw deck view / select step. */
export const RunConfigSchema = z.object({
  coreCompetitors: z.array(z.string()),
  source: z.enum(["page", "cli", "file"]),
  updatedAt: z.string(),
  /** Set only after the user confirms the whole-deck fit; cleared by any new pick. */
  confirmed: z
    .object({
      competitors: z.array(z.string()),
      images: z.number().int(),
      slots: z.number().int(),
      at: z.string(),
    })
    .optional(),
});
export type RunConfig = z.infer<typeof RunConfigSchema>;
