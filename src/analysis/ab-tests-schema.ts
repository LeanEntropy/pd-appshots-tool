import { z } from "zod";
import type { Evidence } from "../reports/ab-candidates.ts";
import {
  PLAY_METRICS,
  type PlayMetric,
  TEST_VARIABLES,
  VARIABLE_NAMES,
} from "./play-experiments.ts";

export const SLOT_CHANGES = ["screen", "text", "composition"] as const;

const slotSchema = z.strictObject({
  position: z.number().int(),
  fromOurPosition: z
    .number()
    .int()
    .describe("our current position this image is based on; 0 for an image we do not have yet"),
  changes: z
    .array(z.enum(SLOT_CHANGES))
    .describe(
      "what differs from our image at fromOurPosition: the in-game screen, the text on the image, or the composition (layout, orientation, band, colours, extras); empty when nothing",
    ),
  orientation: z.enum(["portrait", "landscape"]),
  composition: z
    .string()
    .describe('e.g. "landscape composite: the portrait title screen at left, headline at right"'),
  screen: z.string().describe("which in-game screen is shown and where it sits"),
  band: z.string().describe('the marketing band: shape, colour with hex, location; or "none"'),
  headline: z.string().describe("the exact headline in the store page's language, or empty"),
  extras: z.string().describe('extra elements (character, item, badge) and where; or "none"'),
});
const variantSchema = z.strictObject({
  summary: z.string().describe("one sentence: what this variant changes"),
  slots: z.array(slotSchema).describe("the whole variant deck in store order, 1..N"),
});
export type VariantSlot = z.infer<typeof slotSchema>;
export type Variant = z.infer<typeof variantSchema>;

/** A/B tests written by the AI (Opus, text only, CMO voice); every claim is checked by code. */
export const abTestsSchema = z.strictObject({
  tests: z.array(
    z.strictObject({
      title: z.string().describe("short name of the test"),
      hypothesis: z.string().describe("one or two sentences tied to one specific gap"),
      evidence: z
        .array(z.strictObject({ id: z.string(), n: z.number().int(), of: z.number().int() }))
        .describe("the gap ids this test rests on, with the n and of exactly as given"),
      variable: z.enum(TEST_VARIABLES),
      countries: z.array(z.string()).describe("country codes the test runs in"),
      metric: z.enum(Object.keys(PLAY_METRICS) as [PlayMetric, ...PlayMetric[]]),
      variant: variantSchema,
      secondVariant: variantSchema
        .nullable()
        .describe("a second variant of the same one variable, or null (never for low traffic)"),
      impact: z.strictObject({
        size: z.enum(["small", "medium", "large"]),
        reason: z.string().describe("why, in words; no invented percentages"),
      }),
      orderReason: z
        .string()
        .describe("empty, unless this test is placed before one with more leverage: then why"),
    }),
  ),
});
export type AbTestsOutput = z.infer<typeof abTestsSchema>;
export type AiTest = AbTestsOutput["tests"][number];

export interface TestRules {
  evidence: ReadonlyMap<string, Evidence>;
  /** The report's countries (codes). */
  countries: readonly string[];
  ourDeckLength: number;
  /** Allowed variant length (the competitors' range, widened to include ours). */
  length: { min: number; max: number };
  metrics: readonly PlayMetric[];
  lowTraffic: (gl: string) => boolean;
  /** Our current image's orientation per position (from the pixels). */
  ourOrientation: ReadonlyMap<number, string>;
}

/** A slot differs from the control: moved, or something in it changed. */
export const slotChanged = (s: VariantSlot) =>
  s.changes.length > 0 || s.fromOurPosition !== s.position;
const changedSlots = (v: Variant) => v.slots.filter(slotChanged);

/** The positions a variant changes (by code, from its slots). */
export const variantTargets = (v: Variant) => changedSlots(v).map((s) => s.position);

/** Problems of one variant: a full deck, and exactly the one variable changed. */
export function variantProblems(v: Variant, variable: AiTest["variable"], r: TestRules): string[] {
  const out: string[] = [];
  const n = v.slots.length;
  const pos = v.slots.map((s) => s.position).sort((a, b) => a - b);
  if (pos.join(",") !== Array.from({ length: n }, (_, i) => i + 1).join(","))
    out.push("the variant's positions must be 1, 2, 3 ... with no gaps or repeats");
  if (n < r.length.min || n > r.length.max)
    out.push(`the variant must have ${r.length.min} to ${r.length.max} screenshots (it has ${n})`);
  const ours = r.ourDeckLength;
  const changed = changedSlots(v);
  const same = (s: VariantSlot) => s.fromOurPosition === s.position;
  if (variable === "screenshot") {
    if (changed.length !== 1) out.push("a one-screenshot test changes exactly one image");
    const added = n === ours + 1;
    if (n !== ours && !added) out.push(`keep our ${ours} screenshots, or add one at the end`);
    if (v.slots.some((s) => !same(s) && !(added && s.position === n && s.fromOurPosition === 0)))
      out.push("a one-screenshot test keeps every other image where it is");
  } else if (variable === "order") {
    const from = v.slots.map((s) => s.fromOurPosition);
    if (from.some((f) => f < 1 || f > ours) || new Set(from).size !== from.length)
      out.push("an order test only moves (or leaves out) our current screenshots, each once");
    if (v.slots.some((s) => s.changes.length))
      out.push("an order test does not change the images themselves");
    if (n > ours || (changed.length < 2 && n === ours))
      out.push("an order test moves at least two screenshots, or leaves some out");
  } else {
    if (n !== ours) out.push(`keep our ${ours} screenshots in their places`);
    if (v.slots.some((s) => !same(s)))
      out.push(`a test of ${VARIABLE_NAMES[variable]} keeps every image in its place`);
    if (!changed.length) out.push("the variant changes nothing");
    const kind = variable === "text" ? "text" : "composition";
    if (v.slots.some((s) => s.changes.some((c) => c !== kind)))
      out.push(`a test of ${VARIABLE_NAMES[variable]} changes only that, nothing else`);
  }
  if (variable === "screenshot" && v.slots.some((s) => !slotChanged(s) && s.changes.length))
    out.push("a one-screenshot test changes nothing in the other images");
  // Orientation is measured by code: an image that keeps its composition keeps our orientation.
  for (const s of v.slots) {
    const was = r.ourOrientation.get(s.fromOurPosition);
    const free = s.changes.includes("composition") || (variable === "screenshot" && slotChanged(s));
    if (!free && (was === "portrait" || was === "landscape") && s.orientation !== was)
      out.push(
        `position ${s.position}: our image there is ${was}; changing it is a composition change`,
      );
  }
  return out;
}

/** Why one test cannot be shown as written (empty when it passes every check). */
export function testProblems(t: AiTest, r: TestRules): string[] {
  const out: string[] = [];
  const cited = t.evidence.map((c) => ({ c, e: r.evidence.get(c.id) }));
  if (!cited.length) out.push("cite at least one gap id");
  for (const { c, e } of cited) {
    if (!e) out.push(`gap ${c.id} does not exist`);
    else if (c.n !== e.n || c.of !== e.of)
      out.push(`gap ${c.id} is ${e.n} of ${e.of} ${e.unit}, not ${c.n} of ${c.of}`);
  }
  const known = cited.flatMap(({ e }) => (e ? [e] : []));
  if (!t.countries.length) out.push("name the countries the test runs in");
  for (const gl of t.countries)
    if (!r.countries.includes(gl)) out.push(`country ${gl} is not in this report`);
  if (!r.metrics.includes(t.metric))
    out.push(
      `the target metric must be ${r.metrics.map((m) => PLAY_METRICS[m].name).join(" or ")}`,
    );
  out.push(...variantProblems(t.variant, t.variable, r));
  if (t.secondVariant)
    out.push(...variantProblems(t.secondVariant, t.variable, r).map((p) => `second variant: ${p}`));
  const targets = [
    ...new Set([
      ...variantTargets(t.variant),
      ...(t.secondVariant ? variantTargets(t.secondVariant) : []),
    ]),
  ];
  // Each country and position the test changes is covered by one cited gap.
  const covers = (e: Evidence, gl: string, p: number) =>
    e.countries.includes(gl) &&
    (e.positions.length === 0 || e.positions.includes(p) || e.ours.includes(p));
  for (const gl of t.countries.filter((c) => r.countries.includes(c)))
    for (const p of targets)
      if (known.length && !known.some((e) => covers(e, gl, p)))
        out.push(`no cited gap covers position ${p} in country ${gl}`);
  const low = t.countries.some(r.lowTraffic);
  if (low && t.variable !== "order" && targets.some((p) => p > 3))
    out.push("in a low-traffic country, test only positions 1 to 3 or the order of the set");
  if (low && t.secondVariant) out.push("in a low-traffic country, use one variant only");
  return out;
}

/** Leverage of a test: its strongest cited gap. */
export const testLeverage = (t: AiTest, r: TestRules) =>
  Math.max(0, ...t.evidence.map((c) => r.evidence.get(c.id)?.leverage ?? 0));

/** Tests out of leverage order without a stated reason (repaired, else re-sorted by code). */
export function orderProblems(tests: readonly AiTest[], r: TestRules): string[] {
  const out: string[] = [];
  tests.forEach((t, i) => {
    const next = tests[i + 1];
    if (next && testLeverage(t, r) < testLeverage(next, r) && !t.orderReason.trim())
      out.push(
        `test ${i + 1} is placed before test ${i + 2}, which has more leverage: swap them or give orderReason`,
      );
  });
  return out;
}
