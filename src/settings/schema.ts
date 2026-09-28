import { z } from "zod";

/**
 * The Settings page's own values (plan-reports 5B) that have no older home in the config:
 * second-opinion switches of the text steps, the models of the report steps, the spending limit
 * per report build, the suggestion thresholds, the visitors per country and the PDF defaults.
 * Stored in project.json under overrides.options; every field has a default, so a project
 * without overrides reads exactly the defaults below.
 */

/** The AI steps, in the order the Settings page lists them. */
export const AI_STEPS = [
  "screenshotAnalysis",
  "textLayer",
  "patterns",
  "recommendations",
  "countryAdvice",
  "conceptMap",
  "abTests",
] as const;
export type AiStep = (typeof AI_STEPS)[number];

export const STEP_LABELS: Record<AiStep, string> = {
  screenshotAnalysis: "Screenshot analysis",
  textLayer: "Text-layer comparison",
  patterns: "Pattern wording",
  recommendations: "Recommendations",
  countryAdvice: "Country advice",
  conceptMap: "Words used per country",
  abTests: "A/B tests",
};

const ModelRef = z
  .string()
  .regex(/^(claude|codex):[a-z0-9.-]+$/, 'model reference like "claude:claude-opus-5-5"');

export const TRAFFIC_LEVELS = ["low", "medium", "high", "unknown"] as const;
export type TrafficLevel = (typeof TRAFFIC_LEVELS)[number];

export const OptionsSchema = z
  .object({
    /** Second opinions of the steps that have no older switch (screenshots use review coverage). */
    secondOpinion: z
      .object({
        textLayer: z.boolean().default(false),
        patterns: z.boolean().default(false),
        recommendations: z.boolean().default(true),
        countryAdvice: z.boolean().default(true),
        conceptMap: z.boolean().default(false),
        abTests: z.boolean().default(false),
      })
      .prefault({}),
    /** Models of the report steps that arrive with the reports update. */
    models: z
      .object({
        countryAdvice: ModelRef.default("claude:claude-opus-5-5"),
        conceptMap: ModelRef.default("claude:claude-opus-5-5"),
        abTests: ModelRef.default("claude:claude-opus-5-5"),
      })
      .prefault({}),
    spending: z
      .object({ maxUsdPerReport: z.number().positive().max(1000).default(30) })
      .prefault({}),
    suggestions: z
      .object({
        /** "Nothing changes here": at least this share of images reused from the main country. */
        reuseShare: z.number().min(0.5).max(1).default(0.9),
        /** A split vote: the top share lies between these two. */
        splitLow: z.number().min(0).max(1).default(0.4),
        splitHigh: z.number().min(0).max(1).default(0.6),
        /** A weak pattern: fewer games than this at a position. */
        weakN: z.number().int().min(2).max(20).default(4),
        /** Store data older than this many days is stale. */
        staleDays: z.number().int().min(1).max(365).default(30),
      })
      .prefault({})
      .refine((s) => s.splitLow < s.splitHigh, {
        message: "the lower end of a split vote must be below the upper end",
        path: ["splitLow"],
      }),
    /** Store visitors per month, per country code; a missing country is "unknown". */
    traffic: z.record(z.string().regex(/^[a-z]{2}$/), z.enum(TRAFFIC_LEVELS)).default({}),
    /** Faster, leaner per-image analysis (docs/plan-analysis-speed.md). */
    speed: z
      .object({
        /** AI calls at the same time inside one batch; 1 = one after another (as before). */
        parallelCalls: z.number().int().min(1).max(5).default(3),
        /** The image travels inside the request (one model turn) instead of a Read-tool turn. */
        inlineImages: z.boolean().default(false),
        /** The shorter answer (fields nothing reads are no longer asked for). */
        leanAnswer: z.boolean().default(false),
        /** Colour statistics use colours measured by code per layer instead of the model's. */
        measuredColours: z.boolean().default(false),
      })
      .prefault({}),
    /** Pixel check of near-identical pictures across countries (plan-analysis-speed item 8). */
    pixelCheck: z
      .object({
        /** off: fingerprint only; suggest: grouped for one-click confirmation; automatic. */
        mode: z.enum(["off", "suggest", "automatic"]).default("suggest"),
        /** At most this share of pixels changed outside the text/band boxes: same picture. */
        sameMaxOutside: z.number().min(0).max(0.05).default(0.005),
        /** More than this share changed outside: a different picture. */
        differentMinOutside: z.number().min(0.01).max(0.5).default(0.05),
      })
      .prefault({})
      .refine((p) => p.sameMaxOutside < p.differentMinOutside, {
        message: "the 'same picture' limit must be below the 'different picture' limit",
        path: ["sameMaxOutside"],
      }),
    pdf: z
      .object({
        paper: z.enum(["A4", "Letter"]).default("A4"),
        orientation: z.enum(["landscape", "portrait"]).default("landscape"),
        images: z.boolean().default(true),
      })
      .prefault({}),
  })
  .prefault({});
export type Options = z.infer<typeof OptionsSchema>;

/** Models offered on the Settings page, per kind of role (Haiku and GPT-6 Astra never). */
export const MODEL_CHOICES = {
  /** Reads screenshots: no Sonnet (the user's rule). */
  imageProducer: ["claude:claude-fable-5-1", "claude:claude-opus-5-5"],
  /** Screenshot second opinion: GPT-5.6 Sol (Terra mislabels banded screens). */
  imageReviewer: ["codex:gpt-5.6-sol", "codex:gpt-5.5"],
  textProducer: ["claude:claude-opus-5-5", "claude:claude-fable-5-1", "claude:claude-sonnet-5"],
  textReviewer: ["codex:gpt-5.6-sol", "codex:gpt-5.6-terra", "codex:gpt-5.5"],
} as const;

export const modelName = (ref: string) => ref.split(":")[1] ?? ref;
export const modelFamily = (ref: string) => ref.split(":")[0] ?? "";

/** The groups of the Settings page, in order. */
export type GroupId =
  | "main"
  | "steps"
  | "earlyStop"
  | "spending"
  | "coreSize"
  | "suggestions"
  | "abTests"
  | "speed"
  | "pdf";

export const GROUPS: { id: GroupId; title: string; help: string }[] = [
  {
    id: "main",
    title: "Main country",
    help: "The Pilot and the Full check run in this country, and other countries are compared with it.",
  },
  {
    id: "steps",
    title: "AI steps",
    help: "The model of each AI step, and whether a model of the other family checks its work (a second opinion). The steps themselves always run as part of a report.",
  },
  {
    id: "earlyStop",
    title: "Early stop",
    help: "The Full check may stop early once the patterns stop changing.",
  },
  { id: "spending", title: "Spending limits", help: "A batch never spends more than this." },
  {
    id: "coreSize",
    title: "Core size",
    help: "How many images the Full check aims for, and its hard stop.",
  },
  {
    id: "suggestions",
    title: "Suggestions",
    help: "When the tool suggests (or advises against) the next research.",
  },
  {
    id: "abTests",
    title: "A/B tests",
    help: "Store visitors per month per country. Fewer, bigger tests are suggested where traffic is low; “don't know” counts as low.",
  },
  {
    id: "speed",
    title: "Analysis speed",
    help: "How screenshots are sent to the AI and how near-identical pictures across countries are handled.",
  },
  {
    id: "pdf",
    title: "PDF",
    help: "The defaults of Export PDF (you can still change them there).",
  },
];
