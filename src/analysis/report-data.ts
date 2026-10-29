import type { AbTestsPart, PlayContext } from "../reports/ab-section.ts";
import { bottomLine, OLDER_STYLE, olderStyle } from "../reports/bottom-line.ts";
import type { SummaryPart } from "../reports/summary.ts";
import type { ImageDb } from "../store/imagedb.ts";
import type { DeckManifest } from "../store/manifest.ts";
import type { AbTestsOutput } from "./ab-tests-schema.ts";
import { artWordingDeep } from "./art-wording.ts";
import { asCounted } from "./categories.ts";
import { batchEntries } from "./entries.ts";
import { orientationOf, ratioLabel } from "./image-facts.ts";
import type { ArtMessage } from "./image-tags.ts";
import { COMPOSITION, captureLines } from "./info-text.ts";
import type { Labeler } from "./labels.ts";
import { layerStructure } from "./layer-structure.ts";
import { compareOurs, type OursVsPatterns } from "./ours-vs.ts";
import { type FitSummary, patternFit } from "./pattern-fit.ts";
import { findPatterns, type Patterns } from "./patterns.ts";
import type { AnalysisPlan } from "./plan.ts";
import { PROMPT_VERSIONS } from "./prompts.ts";
import { type AnalysisRecord, isUsable } from "./records.ts";
import { type DeckRepeats, type RepeatFinding, withRepeatFindings } from "./repeat-findings.ts";
import {
  type Example,
  labelsFor,
  recExamples,
  rowTags,
  type SortingPart,
  sortingPart,
} from "./report-sorting.ts";
import type { StoreCountry } from "./store-compare.ts";
import {
  type Interpretation,
  labelProblems,
  type Recommendations,
  type Review,
} from "./synthesis-schema.ts";

/** One store position of one game, exactly as Google Play shows it. */
export interface OrderRow {
  position: number;
  imageId: string | null;
  thumb: string | null;
  file: string | null;
  screen: string;
  screenType: string | null;
  /** Report category (categories.ts) and tags; absent in reports saved before 2026-09-29. */
  category?: string | null;
  logo?: boolean | null;
  message?: ArtMessage | null;
  headline: string;
  orientation: string;
  /** Pixel ratio and layer structure (absent in reports saved before 2026-10-30). */
  ratio?: string;
  size?: string;
  layerStructure?: string | null;
  composition: string;
  captures: string[];
  layer: boolean | null;
  /** analysed | not double-checked | not analysed | excluded */
  state: string;
  note: string;
  repeatOf?: number;
}

export interface GameOrder {
  appId: string;
  name: string;
  ours: boolean;
  orderDate: string | null;
  rows: OrderRow[];
}

export type { Example };

export interface AiPart {
  runId: string;
  /** True when built from the same analyses as the data shown now. */
  current: boolean;
  interpretation: Interpretation | null;
  recommendations: Recommendations | null;
  review: Review | null;
  revised: boolean;
  /** The AI's A/B tests as written (checked when the report is built); absent in older runs. */
  abTests?: AbTestsOutput | null;
  /** Prompt versions the AI parts were written with (older style detection). */
  promptVersions?: Record<string, string> | null;
}

export interface ReportData {
  stage: string;
  market: string;
  approved: boolean;
  games: GameOrder[];
  coverage: { used: number; total: number; missing: string[] };
  patterns: Patterns | null;
  oursVs: OursVsPatterns | null;
  /** Every competitor pattern and whether we fit it, the verdict and the key points (by code). */
  fit: FitSummary | null;
  ai: AiPart | null;
  synthesis: { state: "current" | "stale" | "missing"; reason: string; howTo: string };
  /** Competitor examples per recommended position (same screen type, same position first). */
  examples: Record<string, Example[]>;
  /** Label/spec mismatches in the recommendations, found by code (e.g. a recapture labelled art). */
  recProblems: string[];
  /** Plain names for the codes used in the patterns and recommendations. */
  labels: Record<string, string>;
  /** Named competitors not on Google Play in the core country: not in this check, by design. */
  leftOut: string[];
  /** Store text and derived keywords per country (absent in runs saved before it existed). */
  storeText?: StoreCountry[];
  /** The bottom line and the A/B tests to run next (absent in reports saved before them). */
  summary?: SummaryPart;
  abTests?: AbTestsPart;
  /** "How we sort images": every category and tag used, defined, with an example. */
  sorting?: SortingPart;
  repeats?: RepeatFinding[];
}

export interface ReportInputs {
  plan: AnalysisPlan;
  approved: boolean;
  ourAppId: string;
  records: ReadonlyMap<string, AnalysisRecord>;
  decks: ReadonlyMap<string, DeckManifest | undefined>;
  db: Pick<ImageDb, "get">;
  orderDates: ReadonlyMap<string, string | null>;
  label: Labeler;
  dataHash: string;
  /** Latest AI output of the stage, with the data hash it was built from. */
  latestAi: (Omit<AiPart, "current"> & { dataHash: string | null }) | null;
  /** Why the last run did not write the synthesis, from the saved run status. */
  lastSkip: string | null;
  estimateUsd: [number, number];
  /** Named competitors not on Google Play in the core country (left out of this check). */
  leftOut?: string[];
  storeText?: StoreCountry[];
  /** Where A/B tests run (countries, traffic); without it, the main market only. */
  play?: PlayContext;
  generatedAt?: string;
  repeats?: ReadonlyMap<string, DeckRepeats>;
  /** What each image highlights (its saved layout's focus kind), when known. */
  focus?: (imageId: string) => string | null;
}

function row(
  x: ReportInputs,
  slot: DeckManifest["slots"][number],
  excluded: string | null,
  game: string,
) {
  const id = slot.imageId;
  const img = id ? x.db.get(id) : undefined;
  const r = id ? x.records.get(id) : undefined;
  const f = isUsable(r) ? r.final : null;
  const c = f ? asCounted(f) : null;
  const state = excluded
    ? "excluded"
    : f
      ? r?.status === "unreviewed"
        ? "not double-checked"
        : "analysed"
      : "not analysed";
  const t = rowTags(f, game, x.label);
  const out: OrderRow = {
    position: slot.position,
    imageId: id,
    thumb: img?.thumb ?? null,
    file: img?.file ?? null,
    screen: t.screen,
    // The taxonomy type (a banner keeps the model's); `category` says it is a banner.
    screenType: r?.banner?.from.screenType ?? f?.screenshot.screenType ?? null,
    category: t.category,
    logo: t.logo,
    message: t.message,
    headline: f?.headline ?? "",
    orientation: orientationOf(slot.width, slot.height),
    ratio: ratioLabel(slot.width, slot.height),
    ...(slot.width && slot.height ? { size: `${slot.width}x${slot.height}` } : {}),
    layerStructure: f ? layerStructure(f) : null,
    composition: c
      ? (COMPOSITION[c.screenshot.composition] ?? x.label(c.screenshot.composition))
      : "",
    captures: c ? captureLines(c, r?.identity?.image, x.label) : [],
    layer: f ? f.marketingLayer.present : null,
    state,
    note: excluded ?? (f ? "" : r ? `${r.status}: ${r.problems.join("; ")}` : "not analysed yet"),
  };
  return out;
}

/** Everything the report shows, from the saved analyses only (no AI). Pure. */
export function buildReportData(x: ReportInputs): ReportData {
  const { plan } = x;
  const games: GameOrder[] = plan.games.map((g) => {
    const deck = x.decks.get(g.appId);
    // The batch's own image at each analysed position (the plan), so a newer download never
    // pairs an old analysis with a different screenshot; the deck gives the rest of the order.
    const rows = (deck?.slots ?? []).map((s) => {
      const ex = plan.excluded.find((e) => e.name === g.name && e.position === s.position);
      const item = plan.items.find((i) => i.appId === g.appId && i.position === s.position);
      return row(x, item ? { ...s, imageId: item.imageId } : s, ex ? ex.reason : null, g.name);
    });
    return {
      appId: g.appId,
      name: g.name,
      ours: g.appId === x.ourAppId,
      orderDate: x.orderDates.get(g.appId) ?? null,
      rows,
    };
  });
  const entries = batchEntries(plan, x.records, x.db, x.ourAppId, x.repeats, x.focus);
  const total = entries.decks.reduce((n, g) => n + g.deckLength, entries.ourDeckLength);
  const coverage = { used: total - entries.missing.length, total, missing: entries.missing };
  let patterns: Patterns | null = null;
  let oursVs: OursVsPatterns | null = null;
  let fit: FitSummary | null = null;
  if (entries.competitors.length >= 2) {
    patterns = findPatterns(entries.competitors, entries.decks);
    oursVs = compareOurs(entries.ours, patterns, entries.ourDeckLength, x.label);
    fit = patternFit(entries.competitors, entries.ours, patterns, entries.ourDeckLength, x.label);
  }
  const l = x.latestAi;
  // AI parts written with older text prompts are out of date even when the analyses are not.
  const older = !!l && olderStyle(l.promptVersions, PROMPT_VERSIONS);
  const ai: AiPart | null = l ? { ...l, current: l.dataHash === x.dataHash && !older } : null;
  const cost = `about $${x.estimateUsd[0].toFixed(2)} to $${x.estimateUsd[1].toFixed(2)}`;
  const howTo = `Open the approval (Analysis page, Start analysis) and approve. Screenshots already analysed are not sent again; the cost shown there is ${cost}.`;
  let synthesis: ReportData["synthesis"];
  if (ai?.current && ai.recommendations) synthesis = { state: "current", reason: "", howTo: "" };
  else if (!x.approved)
    synthesis = {
      state: "missing",
      reason: "No batch has been approved for this stage yet.",
      howTo,
    };
  else if (coverage.missing.length)
    synthesis = {
      state: ai ? "stale" : "missing",
      reason: `${coverage.missing.length} of ${total} screenshots have no usable analysis yet (${coverage.missing.join(", ")}). Patterns and recommendations are written once every screenshot is analysed.`,
      howTo,
    };
  else if (ai && older)
    synthesis = {
      state: "stale",
      reason: OLDER_STYLE,
      howTo: `To rewrite them: ${howTo} This run sends 0 images: only the pattern wording, the recommendations, their check (when on in Settings) and the A/B tests.`,
    };
  else if (ai)
    synthesis = {
      state: "stale",
      reason: `The insights and recommendations below come from run ${ai.runId}, which used older analyses than the ones shown now.`,
      howTo: `To refresh them: ${howTo}`,
    };
  else
    synthesis = {
      state: "missing",
      reason: x.lastSkip
        ? `The last run did not write them: ${x.lastSkip}`
        : "Every screenshot is analysed, but the AI insights and recommendations have not been written yet.",
      howTo,
    };
  // Display wording only (user rule): older text never says an art screen is not from the game.
  const data: ReportData = artWordingDeep({
    stage: plan.stage,
    market: plan.market.label,
    approved: x.approved,
    games,
    coverage,
    patterns,
    oursVs,
    fit,
    ai,
    synthesis,
    examples: recExamples(ai?.recommendations ?? null, games),
    sorting: sortingPart(games, ai?.recommendations ?? null),
    recProblems: ai?.recommendations
      ? labelProblems(
          ai.recommendations,
          new Map(
            (games.find((g) => g.ours)?.rows ?? []).map((r) => [r.position, r.screenType ?? ""]),
          ),
        )
      : [],
    labels: labelsFor(x.label, patterns, oursVs, ai?.recommendations ?? null, games),
    leftOut: x.leftOut ?? [],
    storeText: x.storeText ?? [],
    ...bottomLine(x, entries, fit, patterns, ai),
  });
  return withRepeatFindings(data, x.repeats ?? new Map(), true);
}
