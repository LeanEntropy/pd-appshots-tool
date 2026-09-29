import { playSetup } from "../analysis/play-experiments.ts";
import type { ReportData } from "../analysis/report-data.ts";
import type { AbTestCard, AbTestsPart, PlayContext } from "./ab-section.ts";
import type { CountryReport } from "./country-report-types.ts";
import { countryName } from "./names.ts";
import type { MarketRef } from "./types.ts";

/**
 * The A/B tests of a One country report made from a comparison (plan-cross-country 2.3), by code:
 * a comparison test is kept for this country only when (1) it names this country and cites at
 * least one value measured here alone (not only other countries' or pooled numbers), (2) its
 * variant makes sense here (the positions exist in our deck, new text is in this country's
 * script), and (3) its control, evidence and Play setup are recomputed for this country. The
 * rest are listed as left out with the reason; the country's own code-written tests top it up
 * to 2 (never more than 5).
 */

const SCRIPTS: Record<string, RegExp> = {
  ja: /[぀-ヿ一-鿿]/,
  ko: /[가-힯ᄀ-ᇿ]/,
  zh: /[一-鿿]/,
  th: /[฀-๿]/,
  vi: /[A-Za-zÀ-ỹ]/,
  ru: /[Ѐ-ӿ]/,
  uk: /[Ѐ-ӿ]/,
  ar: /[؀-ۿ]/,
  hi: /[ऀ-ॿ]/,
};
/** Letters of another script than the country's (e.g. Japanese kana in a Korean variant). */
const FOREIGN: Record<string, RegExp> = {
  ko: /[぀-ヿ]/,
  zh: /[぀-ヿ가-힯]/,
  ja: /[가-힯]/,
};

/** True when a new headline is written in the script of this listing language. */
export function textFits(text: string, hl: string): boolean {
  const t = text.trim();
  if (!t) return true;
  const lang = hl.split("-")[0] ?? hl;
  const own = SCRIPTS[lang] ?? /[A-Za-z]/;
  const foreign = FOREIGN[lang];
  return own.test(t) && !(foreign?.test(t) ?? false);
}

/** Why a comparison test does not hold for this country alone, or null when it does. */
export function reuseProblem(t: AbTestCard, market: MarketRef, ourDeck: number): string | null {
  const name = countryName(market.label);
  if (!t.countries.some((c) => countryName(c) === name)) return `it is not about ${name}`;
  if (!t.evidence.some((e) => e.statement.startsWith(`${name}: `)))
    return `its evidence is from other countries only, never a value measured in ${name} alone`;
  if (t.positions.some((p) => p > ourDeck))
    return `it changes a position our ${name} page does not have`;
  const changed = t.variant?.slots.filter((s) => s.changes.includes("text")) ?? [];
  if (changed.some((s) => !textFits(s.headline, market.hl)))
    return `its new text is written for another language than ${name}'s`;
  return null;
}

/** Our deck here as the control (position, screen, headline, orientation). */
function controlOf(d: ReportData): AbTestCard["control"] {
  const ours = d.games.find((g) => g.ours);
  return (ours?.rows ?? []).map((r) => ({
    position: r.position,
    screen: r.screen,
    headline: r.headline,
    orientation: r.orientation,
  }));
}

export function derivedAbTests(
  parent: CountryReport,
  c: CountryReport["countries"][number],
  play: PlayContext,
): AbTestsPart {
  const market: MarketRef = { gl: c.gl, hl: c.hl, label: c.label };
  const name = countryName(c.label);
  const control = controlOf(c.data);
  const setupFor = (second: boolean) =>
    playSetup(
      [market],
      [market],
      play.projectMarkets,
      (gl) => play.traffic[gl] ?? "unknown",
      second,
    );
  const leftOut: AbTestsPart["leftOut"] = [];
  const tests: AbTestCard[] = [];
  for (const t of parent.abTests.tests.filter((x) => x.source === "ai")) {
    const problem = reuseProblem(t, market, control.length);
    if (problem) {
      if (t.countries.some((x) => countryName(x) === name))
        leftOut.push({ title: t.title, reason: `From the comparison, not kept: ${problem}.` });
      continue;
    }
    const setup = setupFor(!!t.secondVariant);
    tests.push({
      ...t,
      evidence: t.evidence
        .filter((e) => e.statement.startsWith(`${name}: `))
        .map((e) => ({ ...e, statement: e.statement.slice(name.length + 2) })),
      countries: [c.label],
      control,
      setup,
      secondVariant: setup.variants === 2 ? t.secondVariant : null,
    });
  }
  const own = c.data.abTests;
  const taken = new Set(tests.map((t) => `${t.variable}|${t.positions.join(",")}`));
  for (const t of own?.tests ?? []) {
    if (tests.length >= 2) break;
    const key = `${t.variable}|${t.positions.join(",")}`;
    if (taken.has(key)) continue;
    taken.add(key);
    tests.push({ ...t, countries: [c.label], control, setup: setupFor(!!t.secondVariant) });
  }
  const kept = tests.slice(0, 5).map((t, i) => ({ ...t, priority: i + 1 }));
  const fromParent = kept.filter((t) => t.source === "ai").length;
  const note = [
    fromParent
      ? `${fromParent} ${fromParent === 1 ? "test is" : "tests are"} from the comparison, kept because ${fromParent === 1 ? "it rests" : "they rest"} on values measured in ${name} alone; control and Play setup are this country's.`
      : `No test of the comparison rests on values measured in ${name} alone, so these tests are written by code from ${name}'s own gaps.`,
    own?.gaps === 1 ? "Only 1 gap found; we do not invent a second test." : "",
    own?.gaps === 0 ? "No gaps found here: nothing to test yet." : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { tests: kept, leftOut, gaps: own?.gaps ?? kept.length, note };
}
