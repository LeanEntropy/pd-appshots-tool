import { z } from "zod";
import type { Config } from "../config/schema.ts";
import { secondOpinionOn } from "./access.ts";
import { speedFields } from "./fields-speed.ts";
import {
  type AiStep,
  type GroupId,
  MODEL_CHOICES,
  modelName,
  STEP_LABELS,
  TRAFFIC_LEVELS,
} from "./schema.ts";

/**
 * Every value on the Settings page: where it lives in the merged config (and so in
 * project.json overrides), how it is shown and what it accepts. The page is drawn from this
 * list and the server accepts only these fields.
 */
export type FieldKind = "select" | "number" | "percent" | "usd" | "switch";

export interface Choice {
  value: string;
  label: string;
}

export interface FieldDef {
  id: string;
  group: GroupId;
  label: string;
  help?: string;
  kind: FieldKind;
  /** The AI step a field belongs to (model or second opinion). */
  step?: AiStep;
  /** Accepted values, in stored units (shares as 0..1). */
  value: z.ZodType;
  choices?: Choice[];
  min?: number;
  max?: number;
  /** Override paths the field writes; the first one is read unless `get` is given. */
  paths: string[][];
  get?: (c: Config) => unknown;
  /** The override values to write; default: the value at the first path. */
  write?: (v: unknown) => unknown[];
}

const choices = (refs: readonly string[]): Choice[] =>
  refs.map((r) => ({ value: r, label: modelName(r) }));
const model = z.string().regex(/^(claude|codex):[a-z0-9.-]+$/);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const share = (min: number, max: number) => z.number().min(min).max(max);

function modelField(step: AiStep, path: string[], refs: readonly string[], help?: string) {
  return {
    id: `model.${step}`,
    group: "steps" as const,
    step,
    label: `${STEP_LABELS[step]}: model`,
    ...(help ? { help } : {}),
    kind: "select" as const,
    value: model,
    choices: choices(refs),
    paths: [path],
  };
}

function reviewSwitch(step: Exclude<AiStep, "screenshotAnalysis">): FieldDef {
  return {
    id: `review.${step}`,
    group: "steps",
    step,
    label: `${STEP_LABELS[step]}: second opinion`,
    kind: "switch",
    value: z.boolean(),
    paths: [["options", "secondOpinion", step]],
    get: (c) => secondOpinionOn(c, step),
  };
}

/** The fields of one project (the country lists depend on its countries). */
export function fieldsFor(config: Config): FieldDef[] {
  const markets = config.markets.map((m) => ({ value: m.gl, label: m.label }));
  const traffic: FieldDef[] = config.markets.map((m) => ({
    id: `traffic.${m.gl}`,
    group: "abTests",
    label: m.label,
    kind: "select",
    value: z.enum(TRAFFIC_LEVELS),
    choices: [
      { value: "unknown", label: "Don't know" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
    paths: [["options", "traffic", m.gl]],
    get: (c) => c.options.traffic[m.gl] ?? "unknown",
  }));
  return [
    {
      id: "mainCountry",
      group: "main",
      label: "Main country and its language",
      kind: "select",
      value: z.string().regex(/^[a-z]{2}$/),
      choices: markets,
      paths: [["core", "market"]],
    },
    modelField("screenshotAnalysis", ["models", "fullAnalysis"], MODEL_CHOICES.imageProducer),
    {
      id: "review.screenshotAnalysis",
      group: "steps",
      step: "screenshotAnalysis",
      label: "Screenshot analysis: second opinion",
      help: "A model of the other family reads every analysed screenshot too; disagreements are settled.",
      kind: "switch",
      value: z.boolean(),
      paths: [
        ["review", "coreCoverage"],
        ["review", "expansionCoverage"],
        ["review", "enabled"],
      ],
      get: (c) => secondOpinionOn(c, "screenshotAnalysis"),
      // Switching it on also turns the older master switch back on, so "on" really means on.
      write: (v) => (v ? [1, 1, true] : [0, 0, true]),
    },
    {
      ...modelField("screenshotAnalysis", ["models", "imageReview"], MODEL_CHOICES.imageReviewer),
      id: "reviewer.screenshots",
      label: "Screenshot second opinion: model",
    },
    modelField("textLayer", ["models", "layerDiff"], MODEL_CHOICES.imageProducer),
    reviewSwitch("textLayer"),
    reviewSwitch("patterns"),
    modelField(
      "recommendations",
      ["models", "recommend"],
      MODEL_CHOICES.textProducer,
      "Writes the pattern wording and the recommendations.",
    ),
    reviewSwitch("recommendations"),
    {
      ...modelField(
        "recommendations",
        ["models", "recommendationReview"],
        MODEL_CHOICES.textReviewer,
      ),
      id: "reviewer.text",
      label: "Text second opinion: model",
      help: "Checks every text step whose second opinion is on.",
    },
    modelField("countryAdvice", ["options", "models", "countryAdvice"], MODEL_CHOICES.textProducer),
    reviewSwitch("countryAdvice"),
    modelField("conceptMap", ["options", "models", "conceptMap"], MODEL_CHOICES.textProducer),
    reviewSwitch("conceptMap"),
    modelField("abTests", ["options", "models", "abTests"], MODEL_CHOICES.textProducer),
    reviewSwitch("abTests"),
    num("earlyStop", "core.stability.minDecks", "Minimum decks before stopping", int(1, 30)),
    num("earlyStop", "core.stability.window", "Decks in a row with no change", int(1, 10)),
    {
      ...num(
        "earlyStop",
        "core.stability.maxShareShift",
        "Largest share movement allowed",
        share(0, 0.5),
      ),
      kind: "percent",
      help: "In percentage points: a pattern's share may move at most this much.",
    },
    {
      ...num(
        "spending",
        "budget.maxUsdPerIncrement",
        "Per Pilot or Full check batch",
        share(1, 1000),
      ),
      kind: "usd",
    },
    {
      ...num(
        "spending",
        "options.spending.maxUsdPerReport",
        "Per report build (other countries, more competitors)",
        share(1, 1000),
      ),
      kind: "usd",
    },
    num("coreSize", "core.imageTarget", "Aim (images)", int(10, 300)),
    num("coreSize", "core.imageCap", "Hard stop (images)", int(10, 300)),
    {
      ...num(
        "suggestions",
        "options.suggestions.reuseShare",
        "“Nothing changes here” when at least this share of images is reused from the main country",
        share(0.5, 1),
      ),
      kind: "percent",
    },
    {
      ...num(
        "suggestions",
        "options.suggestions.splitLow",
        "Split vote: top share from",
        share(0, 1),
      ),
      kind: "percent",
    },
    {
      ...num(
        "suggestions",
        "options.suggestions.splitHigh",
        "Split vote: top share up to",
        share(0, 1),
      ),
      kind: "percent",
    },
    num("suggestions", "options.suggestions.weakN", "Weak pattern: fewer games than", int(2, 20)),
    num(
      "suggestions",
      "options.suggestions.staleDays",
      "Store data is old after (days)",
      int(1, 365),
    ),
    ...traffic,
    ...speedFields(),
    {
      id: "options.pdf.paper",
      group: "pdf",
      label: "Paper",
      kind: "select",
      value: z.enum(["A4", "Letter"]),
      choices: [
        { value: "A4", label: "A4" },
        { value: "Letter", label: "Letter" },
      ],
      paths: [["options", "pdf", "paper"]],
    },
    {
      id: "options.pdf.orientation",
      group: "pdf",
      label: "Orientation",
      kind: "select",
      value: z.enum(["landscape", "portrait"]),
      choices: [
        { value: "landscape", label: "Landscape" },
        { value: "portrait", label: "Portrait" },
      ],
      paths: [["options", "pdf", "orientation"]],
    },
    {
      id: "options.pdf.images",
      group: "pdf",
      label: "With pictures",
      kind: "switch",
      value: z.boolean(),
      paths: [["options", "pdf", "images"]],
    },
  ];
}

function num(group: GroupId, id: string, label: string, value: z.ZodType): FieldDef {
  return { id, group, label, kind: "number", value, paths: [id.split(".")] };
}

/** A field's current value in a config. */
export function fieldValue(f: FieldDef, c: Config): unknown {
  if (f.get) return f.get(c);
  let v: unknown = c;
  for (const k of f.paths[0] ?? []) v = (v as Record<string, unknown> | undefined)?.[k];
  return v;
}
