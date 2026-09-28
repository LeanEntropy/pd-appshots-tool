import type { TestRules } from "../analysis/ab-tests-schema.ts";
import { reportLabeler } from "../analysis/categories.ts";
import type { AdviceFact, CountryAdviceInput } from "../analysis/country-advice.ts";
import { plainLabel } from "../analysis/labels.ts";
import type { FitSummary } from "../analysis/pattern-fit.ts";
import type { DeckEntry } from "../analysis/patterns.ts";
import { allowedMetrics, isLowTraffic } from "../analysis/play-experiments.ts";
import { brief } from "../analysis/synthesis.ts";
import { logoOf, type Recommendations } from "../analysis/synthesis-schema.ts";
import type { TrafficLevel } from "../settings/schema.ts";
import { abCandidates, type Evidence, evidenceStrength, positionWeight } from "./ab-candidates.ts";
import type { LocalisationData } from "./localisation.ts";
import { countryName } from "./names.ts";
import { type TerminologyCountry, terminologyGaps } from "./terminology.ts";
import type { MarketRef } from "./types.ts";

/**
 * The facts a country report's text-only AI steps rest on, by code: per country the country
 * advice input (plan-reports 3, point 6), and across the report the A/B test gaps (3B.2 step 1:
 * per-country pattern gaps, localisation habits where we differ, and words where we differ).
 */
const L = reportLabeler(plainLabel);

export interface CountryPart {
  market: MarketRef;
  fit: FitSummary | null;
  ours: readonly DeckEntry[];
  competitors: readonly DeckEntry[];
  ourDeckLength: number;
  deckLength: { min: number; max: number } | null;
  terminology: TerminologyCountry | null;
}

/** The main country's recommended deck, one line per position. */
export function baseLines(r: Recommendations | null): string[] {
  if (!r) return [];
  return [...r.positions]
    .sort((a, b) => a.position - b.position)
    .map((p) => {
      const head = p.marketingLayer.present ? (p.marketingLayer.texts[0]?.text ?? "") : "";
      const logo = logoOf(p);
      return `#${p.position} ${L(p.screenType)}${p.subtype ? ` / ${L(p.subtype)}` : ""} (${p.source}): capture ${p.screenshot.whatToCapture}; headline "${head}"${logo ? `; game logo ${logo.show ? "yes" : "no"}` : ""}. Why: ${p.why}`;
    });
}

/** Competitors' local texts against the same picture in the main country (one line each). */
export function textLines(loc: LocalisationData | null, gl: string): string[] {
  if (!loc) return [];
  return loc.rows
    .filter((r) => r.gl === gl && r.state === "ok")
    .flatMap((r) => {
      const who = `${r.game}${r.ours ? " (ours)" : ""}`;
      const same = r.lines.filter((l) => l.kind === "identical").length;
      const head = same
        ? [
            `${who}: ${same} ${same === 1 ? "image is" : "images are"} the same file as in the main country`,
          ]
        : [];
      return [
        ...head,
        ...r.lines
          .filter((l) => l.kind !== "identical")
          .map((l) =>
            l.kind === "different"
              ? `${who} #${l.position}: a picture not used in the main country, headline "${l.localHeadline}"`
              : `${who} #${l.position}: main "${l.mainHeadline}" -> local "${l.localHeadline}"${l.backTranslation ? ` (back-translation: ${l.backTranslation})` : ""}${l.text === "main" ? " [left in the main country's language]" : ""}${l.band ? ` [band: ${l.band}]` : ""}`,
          ),
      ];
    });
}

export function wordLines(t: TerminologyCountry | null): string[] {
  if (!t) return [];
  return t.rows.map((r) => {
    const ours = r.cells.find((c) => c.ours)?.uses[0]?.term;
    const common = r.common
      ? `most common "${r.common.term}" (${r.common.games} of ${r.common.of} competitors)`
      : "no clear common term";
    return `${r.label} (${r.gloss}): ${common}; ours: ${ours ? `"${ours}"` : "not used"}${r.ownMismatch ? `; ${r.ownMismatch}` : ""}`;
  });
}

/** The country advice input of one country other than the main one. */
export function adviceInput(
  c: CountryPart,
  main: MarketRef,
  loc: LocalisationData | null,
  base: { from: string; recommendations: Recommendations | null },
): CountryAdviceInput {
  const facts: AdviceFact[] = [];
  const add = (kind: AdviceFact["kind"], statement: string) =>
    facts.push({ id: `C${facts.length + 1}`, kind, statement });
  for (const p of c.fit?.patterns ?? [])
    if (p.fits === false) add("pattern", `${p.text} (${p.evidence}); ours: ${p.reason}.`);
  for (const h of loc?.habits.find((x) => x.gl === c.market.gl)?.habits ?? [])
    if (h.fits === false) add("habit", `${h.label}: ${h.reason}.`);
  for (const g of c.terminology ? terminologyGaps(c.terminology) : []) add("words", g.statement);
  const range = c.deckLength ?? { min: c.ourDeckLength, max: c.ourDeckLength };
  const baseLength = base.recommendations?.positions.length ?? 0;
  return {
    country: c.market,
    main,
    facts,
    base: { from: base.from, lines: baseLines(base.recommendations) },
    ours: c.ours.map(brief),
    competitors: c.competitors.map(brief),
    texts: textLines(loc, c.market.gl),
    words: wordLines(c.terminology),
    rules: {
      facts: new Set(facts.map((f) => f.id)),
      length: {
        min: Math.max(1, Math.min(c.ourDeckLength || range.min, range.min, baseLength || 99)),
        max: Math.max(c.ourDeckLength, range.max, baseLength),
      },
      baseLength,
    },
  };
}

/** Our positions whose text stays in the main country's language in one country. */
function keptPositions(loc: LocalisationData | null, gl: string): number[] {
  const ours = loc?.rows.find((r) => r.ours && r.gl === gl);
  return ours?.lines.filter((l) => l.text === "main").map((l) => l.position) ?? [];
}

/**
 * The A/B test gaps of a report of several countries, most leverage first, ids E1, E2 ...:
 * each country's pattern gaps (named by country), the countries where most competitors translate
 * the text on their images and we do not, and the words where we differ from the common term.
 */
export function countryEvidence(
  parts: readonly CountryPart[],
  loc: LocalisationData | null,
): Evidence[] {
  const all: Evidence[] = [];
  for (const c of parts) {
    const name = countryName(c.market.label);
    const range = c.deckLength ?? { min: c.ourDeckLength, max: c.ourDeckLength };
    for (const e of abCandidates(c.fit, {
      gl: c.market.gl,
      ourDeckLength: c.ourDeckLength,
      deckLength: range,
    }))
      all.push({ ...e, kind: `${c.market.gl}-${e.kind}`, statement: `${name}: ${e.statement}` });
    const tr = loc?.habits
      .find((h) => h.gl === c.market.gl)
      ?.habits.find((h) => h.id === "translate");
    const kept = keptPositions(loc, c.market.gl);
    if (tr && tr.fits === false && tr.ours === false && kept.length)
      all.push({
        id: "",
        kind: `${c.market.gl}-translate`,
        statement: `${name}: ${tr.n} of ${tr.of} competitors translate the text on their images; ours stays in the main country's language (positions ${kept.join(", ")}).`,
        n: tr.n,
        of: tr.of,
        unit: "competitors",
        games: tr.games,
        countries: [c.market.gl],
        positions: kept,
        imageIds: [],
        ours: kept,
        variable: "text",
        leverage:
          Math.round(positionWeight(Math.min(...kept)) * evidenceStrength(tr.n, tr.of) * 100) / 100,
      });
    for (const g of c.terminology ? terminologyGaps(c.terminology) : [])
      all.push({
        id: "",
        kind: `${c.market.gl}-words-${g.concept}`,
        statement: g.statement,
        n: g.games,
        of: g.of,
        unit: "competitors",
        games: [],
        countries: [c.market.gl],
        positions: [],
        imageIds: [],
        ours: [],
        variable: "text",
        leverage: Math.round(evidenceStrength(g.games, g.of) * 100) / 100,
      });
  }
  all.sort((a, b) => b.leverage - a.leverage || a.kind.localeCompare(b.kind));
  return all.map((e, i) => ({ ...e, id: `E${i + 1}` }));
}

/** The checks of the report's A/B tests (our deck of the first country is the control). */
export function countryRules(
  parts: readonly CountryPart[],
  evidence: readonly Evidence[],
  traffic: (gl: string) => TrafficLevel,
): TestRules {
  const first = parts[0];
  const ourLen = first?.ourDeckLength ?? 0;
  const mins = parts.map((c) => c.deckLength?.min ?? ourLen);
  const maxs = parts.map((c) => c.deckLength?.max ?? ourLen);
  return {
    evidence: new Map(evidence.map((e) => [e.id, e])),
    countries: parts.map((c) => c.market.gl),
    ourDeckLength: ourLen,
    length: {
      min: Math.max(1, Math.min(ourLen, ...mins)),
      max: Math.max(ourLen, ...maxs),
    },
    metrics: allowedMetrics(false),
    lowTraffic: (gl) => isLowTraffic(traffic(gl)),
    ourOrientation: new Map((first?.ours ?? []).map((e) => [e.position, e.canvas])),
  };
}
