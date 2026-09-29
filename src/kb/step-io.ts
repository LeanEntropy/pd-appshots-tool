import type { AbTestsOutput } from "../analysis/ab-tests-schema.ts";
import type { CountryAdvice } from "../analysis/country-advice-schema.ts";
import type { FitSummary } from "../analysis/pattern-fit.ts";
import type { Interpretation, Recommendations, Review } from "../analysis/synthesis-schema.ts";
import type { Evidence } from "../reports/ab-candidates.ts";
import type { PlacedText } from "./enforce.ts";
import type { KbRun } from "./run.ts";
import type { KbRecord } from "./step.ts";
import { type KbOpts, marksOf, withMarks } from "./synthesis-kb.ts";

/**
 * Per step: the computed facts that pick the knowledge (their keys go through
 * kb/dimension-tags.json), the items an answer may cite on, and the texts and deck lengths the
 * enforced store rules are checked against.
 */
export function fitFacts(fit: FitSummary): string[] {
  return fit.patterns.flatMap((p) => [
    p.id,
    `group:${p.group}`,
    ...(p.categories ?? []).map((c) => `category:${c}`),
    ...(p.fits === false ? [`gap:${p.id}`] : []),
  ]);
}

export const patternsKb = (fit: FitSummary): KbOpts<Interpretation> => ({
  step: "patterns",
  facts: fitFacts(fit),
  items: (v) => v.keyPoints.map((_, i) => `keyPoint:${i + 1}`),
});

export const recommendKb = (fit: FitSummary, cite = true): KbOpts<Recommendations> => ({
  step: "recommend",
  facts: fitFacts(fit),
  cite,
  items: (v) => ["rationale", ...v.positions.map((p) => `position:${p.position}`)],
  placed: (v) => ({
    texts: v.positions.flatMap((p) =>
      p.marketingLayer.texts.map(
        (t): PlacedText => ({ where: `position ${p.position}`, text: t.text }),
      ),
    ),
    lengths: [{ where: "the recommended deck", n: v.positions.length }],
  }),
});

/** The recommendation check reads the writer's material and what was left out; it cites nothing. */
export const reviewKb = (fit: FitSummary): KbOpts<Review> => ({
  step: "recommend",
  facts: fitFacts(fit),
  cite: false,
  items: () => [],
});

export interface SynthesisKb {
  interpretation: KbRecord | null;
  recommendations: KbRecord | null;
  abTests: KbRecord | null;
}

/** The answers with their citation marks and plain notes (the report reads them when present). */
export function withKbMarks<
  R extends {
    interpretation: object | null;
    recommendations: object | null;
    abTests: object | null;
    kb: SynthesisKb;
  },
>(out: R, run: KbRun | undefined): R {
  if (!run) return out;
  return {
    ...out,
    interpretation: withMarks(out.interpretation, marksOf(run, out.kb.interpretation)),
    recommendations: withMarks(out.recommendations, marksOf(run, out.kb.recommendations)),
    // The A/B tests carry their marks already (ab-tests.ts, shared with the country reports).
  };
}

export const abFactsOf = (evidence: readonly Evidence[]) =>
  evidence.flatMap((e) => [e.kind, `variable:${e.variable}`]);

export function abTexts(v: AbTestsOutput): {
  texts: PlacedText[];
  lengths: { where: string; n: number }[];
} {
  const texts: PlacedText[] = [];
  const lengths: { where: string; n: number }[] = [];
  v.tests.forEach((t, i) => {
    for (const [k, variant] of [
      ["", t.variant],
      [" second variant", t.secondVariant],
    ] as const) {
      if (!variant) continue;
      lengths.push({ where: `test ${i + 1}${k}`, n: variant.slots.length });
      for (const s of variant.slots)
        texts.push({ where: `test ${i + 1}${k} image ${s.position}`, text: s.headline });
    }
  });
  return { texts, lengths };
}

export const abKb = (evidence: readonly Evidence[]): KbOpts<AbTestsOutput> => ({
  step: "abTests",
  facts: abFactsOf(evidence),
  items: (v) => v.tests.map((_, i) => `test:${i + 1}`),
  placed: abTexts,
  dropBreaking: true,
});

export const adviceKb = (facts: readonly string[], cite = true): KbOpts<CountryAdvice> => ({
  step: "countryAdvice",
  facts,
  cite,
  items: (v) => [
    ...v.actions.map((_, i) => `action:${i + 1}`),
    ...v.deck.map((d) => `image:${d.position}`),
  ],
  placed: (v) => ({
    texts: v.deck.flatMap((d) => [
      { where: `image ${d.position}`, text: d.headline },
      { where: `image ${d.position}`, text: d.subline },
    ]),
    lengths: [{ where: "the country deck", n: v.deck.length }],
  }),
});
