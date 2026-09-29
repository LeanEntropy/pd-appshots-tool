import { writeAbTests } from "../analysis/ab-tests.ts";
import { cachedConceptMap, writeConceptMap } from "../analysis/concept-map.ts";
import type { ConceptMap } from "../analysis/concept-map-schema.ts";
import { writeCountryAdvice } from "../analysis/country-advice.ts";
import { buildReportData, type ReportData } from "../analysis/report-data.ts";
import { brief } from "../analysis/synthesis.ts";
import type { LoadedConfig } from "../config/load.ts";
import { projectPaths } from "../config/load.ts";
import { settingsOf } from "../settings/access.ts";
import { workspaceStorage } from "../storage/index.ts";
import { abTestsPart } from "./ab-section.ts";
import type { CountrySlice } from "./build.ts";
import type { ReportAi } from "./country-ai.ts";
import { adviceInput, type CountryPart, countryEvidence, countryRules } from "./country-facts.ts";
import { type CountryInputs, countryInputs, sliceEntries } from "./country-inputs.ts";
import { mainSynthesis } from "./country-main.ts";
import { withCountryRepeats } from "./country-repeats.ts";
import type { AdvicePart, CountryReport } from "./country-report-types.ts";
import { dates, keyActions, shortAnswer, verdicts } from "./country-summary.ts";
import { countryName } from "./names.ts";
import { playContextOf } from "./play-context.ts";
import { adviceFixLabel, stepKey } from "./run-steps.ts";
import type { PlanContext, ScopePlan } from "./scope-plan.ts";
import { mergedSorting } from "./sorting-merge.ts";
import {
  crossCountryTerms,
  imageTextItems,
  storeTextItems,
  type TerminologyCountry,
  type TextItem,
  terminologyFor,
  textSet,
} from "./terminology.ts";
import type { ReportDef } from "./types.ts";

const isMainOf = (plan: ScopePlan, gl: string, hl: string) =>
  plan.main.gl === gl && plan.main.hl === hl;

/** Words used per country: one concept map per language (cached, else written when paid). */
async function wordsUsed(
  loaded: LoadedConfig,
  x: CountryInputs,
  entries: Map<string, ReturnType<typeof sliceEntries>>,
  ai: ReportAi,
): Promise<{ terms: TerminologyCountry[]; problems: string[] }> {
  const storage = workspaceStorage(projectPaths(loaded).workspace);
  const perCountry = x.slices.map((s) => {
    const e = entries.get(s.market.gl);
    const img = imageTextItems(
      [...(e?.ours ?? []), ...(e?.competitors ?? [])].map((d) => ({
        appId: d.appId,
        name: d.name,
        ours: d.appId === loaded.config.ourApp.id,
        position: d.position,
        final: d.final,
      })),
    );
    const games = s.inputs.plan.games.map((g) => ({
      appId: g.appId,
      name: g.name,
      ours: g.appId === loaded.config.ourApp.id,
    }));
    const store = storeTextItems(storage, games, s.market.gl, s.market.hl);
    return { s, games, items: [...img, ...store.items] as TextItem[], missing: store.missing };
  });
  const maps = new Map<string, ConceptMap | null>();
  const problems: string[] = [];
  for (const hl of [...new Set(perCountry.map((c) => c.s.market.hl))]) {
    const set = textSet(
      hl,
      perCountry.filter((c) => c.s.market.hl === hl).flatMap((c) => c.items),
    );
    if (ai.mode === "cached") {
      maps.set(hl, cachedConceptMap(storage, set, ai.prompts.concept, ai.writers.concept.model));
      continue;
    }
    ai.report("concept-map", `Grouping the words used (${hl})…`);
    ai.steps?.start(stepKey.words(hl));
    const r = await writeConceptMap(set, ai.writers.concept, ai.prompts.concept, ai.ctx, storage);
    ai.steps?.end(stepKey.words(hl), r.map ? null : r.problems.join("; ") || "not written");
    maps.set(hl, r.map);
    if (!r.map && r.problems.length) problems.push(`words used (${hl}): ${r.problems.join("; ")}`);
  }
  const terms = perCountry.map((c) =>
    terminologyFor(
      c.s.market,
      c.games.map((g) => ({ appId: g.appId, game: g.name, ours: g.ours })),
      c.items,
      maps.get(c.s.market.hl) ?? null,
      c.missing,
    ),
  );
  return { terms, problems };
}

/**
 * Builds the data of a One country or Compare countries version from the saved analyses and
 * text-layer comparisons, with the text-only AI parts from `ai` (paid: written now within the
 * approved limit; cached: only answers already saved). Deterministic content is always there.
 */
export async function assembleCountryReport(
  loaded: LoadedConfig,
  def: ReportDef,
  plan: ScopePlan,
  ctx: PlanContext,
  ai: ReportAi,
  now: Date,
): Promise<{ report: CountryReport; inputs: CountryInputs; problems: string[] }> {
  const { config } = loaded;
  const x = countryInputs(loaded, plan, ctx);
  const problems: string[] = [];
  const play = playContextOf(config, plan.markets);
  const generatedAt = now.toISOString();
  const entries = new Map(x.slices.map((s) => [s.market.gl, sliceEntries(x, s)]));
  const withPlay = (s: CountrySlice) => ({ ...s.inputs, play, generatedAt });
  const data0 = new Map<string, ReportData>(
    x.slices.map((s) => [s.market.gl, buildReportData(withPlay(s))]),
  );
  const words = await wordsUsed(loaded, x, entries, ai);
  problems.push(...words.problems);
  const parts: CountryPart[] = x.slices.map((s) => {
    const d = data0.get(s.market.gl);
    const e = entries.get(s.market.gl);
    return {
      market: s.market,
      fit: d?.fit ?? null,
      ours: e?.ours ?? [],
      competitors: e?.competitors ?? [],
      ourDeckLength: e?.ourDeckLength ?? 0,
      deckLength: d?.patterns?.deckLength ?? null,
      terminology: words.terms.find((t) => t.gl === s.market.gl) ?? null,
    };
  });
  const baseFrom = x.base.stage === "core" ? "Full check" : "Pilot";
  const advice: AdvicePart[] = [];
  for (const p of parts) {
    if (isMainOf(plan, p.market.gl, p.market.hl)) continue;
    const gl = p.market.gl;
    ai.report("country-advice", `Writing the advice for ${countryName(p.market.label)}…`);
    ai.steps?.start(stepKey.advice(gl));
    const input = adviceInput(p, plan.main, x.localisation, {
      from: baseFrom,
      recommendations: x.base.recommendations,
    });
    const r = await writeCountryAdvice(
      {
        writer: ai.writers.advice,
        reviewer: ai.writers.adviceReview,
        prompt: ai.prompts.advice,
        reviewPrompt: ai.prompts.adviceReview,
        phase: (x) =>
          x === "review"
            ? ai.steps?.start(stepKey.adviceCheck(gl))
            : ai.steps?.start(stepKey.adviceFix(gl), adviceFixLabel(p.market.label)),
      },
      input,
      ai.ctx,
    );
    ai.steps?.endRunning(r.problems.join("; ") || null);
    ai.steps?.skipWaiting("the advice was not written", stepKey.adviceCheck(gl));
    if (ai.mode === "paid") problems.push(...r.problems);
    advice.push({
      gl: p.market.gl,
      label: p.market.label,
      state: r.advice ? "current" : "missing",
      advice: r.advice,
      review: r.review,
      revised: !!r.draft,
      note: r.advice
        ? `Written from the ${baseFrom}'s recommendations for ${countryName(plan.main.label)}, this country's ${p.competitors.length ? "competitor decks" : "data"}, their local texts and the words they use.${r.review ? " Checked by a model of the other family." : ""}`
        : "Not written yet.",
    });
  }
  // The main country in the report: its own recommendations (the Full check's sections).
  const countries: CountryReport["countries"] = [];
  for (const s of x.slices) {
    const main = isMainOf(plan, s.market.gl, s.market.hl);
    let data = data0.get(s.market.gl) as ReportData;
    if (main) {
      const m = await mainSynthesis(loaded, s, entries.get(s.market.gl), ai, play, generatedAt);
      if (m.data) data = m.data;
      if (ai.mode === "paid") problems.push(...m.problems);
    }
    countries.push({ gl: s.market.gl, label: s.market.label, hl: s.market.hl, isMain: main, data });
  }
  // The A/B tests of the report: one call over every country's gaps (a main-only report keeps
  // the tests of its own recommendations run).
  const evidence = countryEvidence(parts, x.localisation);
  const rules = countryRules(parts, evidence, settingsOf(config).traffic);
  const first = parts[0];
  const market = first?.market ?? plan.main;
  let abOut = null;
  if (evidence.length && first) {
    ai.report("ab-tests", "Writing the A/B tests…");
    ai.steps?.start(stepKey.ab);
    const r = await writeAbTests(
      ai.writers.ab,
      ai.prompts.ab,
      {
        evidence,
        rules,
        market: {
          gl: market.gl,
          hl: market.hl,
          label: plan.markets.map((m) => countryName(m.label)).join(", "),
        },
        traffic: plan.markets
          .map((m) => `${countryName(m.label)}: ${settingsOf(config).traffic(m.gl)}`)
          .join(", "),
        ours: first.ours,
        brief,
        recommendations: x.base.recommendations,
      },
      ai.ctx,
    );
    abOut = r.value;
    ai.steps?.end(stepKey.ab, r.value ? null : r.problems.join("; ") || "not written");
    if (!r.value && ai.mode === "paid" && r.problems.length)
      problems.push(`A/B tests: ${r.problems.join("; ")}`);
  }
  ai.steps?.skipWaiting("no differences to test", stepKey.ab);
  const abTests = abTestsPart(
    {
      fit: first?.fit ?? null,
      ours: first?.ours ?? [],
      ourDeckLength: first?.ourDeckLength ?? 0,
      deckLength: rules.length,
      label: x.label,
      market,
      play,
      ai: abOut,
      aiCurrent: !!abOut,
    },
    { evidence, rules },
  );
  const v = verdicts(countries, x.localisation, advice, plan.main);
  const actions = keyActions(countries, advice, x.localisation);
  const missing: CountryReport["missing"] = [];
  const how =
    "Press Review and approve on this report: the approval lists these text-only steps with their cost; nothing runs until you approve.";
  for (const t of words.terms)
    if (t.state === "missing" && t.textCount)
      missing.push({
        what: `Words used in ${countryName(t.label)}: the ideas are not grouped yet`,
        how,
      });
  for (const a of advice)
    if (!a.advice) missing.push({ what: `The advice for ${countryName(a.label)}`, how });
  if (evidence.length && !abOut)
    missing.push({
      what: "The AI wording of the A/B tests (the tests below are written by code)",
      how,
    });
  for (const c of countries)
    if (c.isMain && !c.data.ai?.recommendations)
      missing.push({ what: `The recommendations for ${countryName(c.label)}`, how });
  const banners: string[] = [];
  if (x.base.stage === "pilot")
    banners.push(
      `Built on the Pilot only (${x.base.competitors} ${x.base.competitors === 1 ? "competitor" : "competitors"}): run the Full check of ${countryName(plan.main.label)} for a stronger base.`,
    );
  return {
    inputs: x,
    problems,
    report: withCountryRepeats({
      kind: "countries",
      version: 1,
      type: def.type === "compare" ? "compare" : "country",
      name: def.name,
      generatedAt,
      main: plan.main,
      base: { stage: x.base.stage, competitors: x.base.competitors },
      banners,
      missing,
      summary: {
        shortAnswer: shortAnswer(v, actions),
        verdicts: v,
        keyActions: actions,
        dates: dates(countries, generatedAt),
      },
      countries,
      localisation: x.localisation,
      terminology: words.terms,
      crossTerms: crossCountryTerms(words.terms),
      advice,
      abTests,
      sorting: mergedSorting(countries.map((c) => c.data)),
    }),
  };
}
