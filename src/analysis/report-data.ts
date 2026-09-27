import type { ImageDb } from "../store/imagedb.ts";
import type { DeckManifest } from "../store/manifest.ts";
import { batchEntries } from "./entries.ts";
import { orientationOf } from "./image-facts.ts";
import { COMPOSITION, captureLines } from "./info-text.ts";
import type { Labeler } from "./labels.ts";
import { compareOurs, type OursVsPatterns } from "./ours-vs.ts";
import { type FitSummary, patternFit } from "./pattern-fit.ts";
import { findPatterns, type Patterns } from "./patterns.ts";
import type { AnalysisPlan } from "./plan.ts";
import { type AnalysisRecord, isUsable, screenLabel } from "./records.ts";
import type { Interpretation, Recommendations, Review } from "./synthesis-schema.ts";

/** One store position of one game, exactly as Google Play shows it. */
export interface OrderRow {
  position: number;
  imageId: string | null;
  thumb: string | null;
  file: string | null;
  screen: string;
  screenType: string | null;
  headline: string;
  orientation: string;
  composition: string;
  captures: string[];
  layer: boolean | null;
  /** analysed | not double-checked | not analysed | excluded */
  state: string;
  note: string;
}

export interface GameOrder {
  appId: string;
  name: string;
  ours: boolean;
  orderDate: string | null;
  rows: OrderRow[];
}

export interface Example {
  name: string;
  position: number;
  imageId: string;
  thumb: string | null;
}

export interface AiPart {
  runId: string;
  /** True when built from the same analyses as the data shown now. */
  current: boolean;
  interpretation: Interpretation | null;
  recommendations: Recommendations | null;
  review: Review | null;
  revised: boolean;
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
  /** Plain names for the codes used in the patterns and recommendations. */
  labels: Record<string, string>;
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
}

function row(x: ReportInputs, slot: DeckManifest["slots"][number], excluded: string | null) {
  const id = slot.imageId;
  const img = id ? x.db.get(id) : undefined;
  const r = id ? x.records.get(id) : undefined;
  const f = isUsable(r) ? r.final : null;
  const state = excluded
    ? "excluded"
    : f
      ? r?.status === "unreviewed"
        ? "not double-checked"
        : "analysed"
      : "not analysed";
  const out: OrderRow = {
    position: slot.position,
    imageId: id,
    thumb: img?.thumb ?? null,
    file: img?.file ?? null,
    screen: f ? screenLabel(f, x.label) : "",
    screenType: f?.screenshot.screenType ?? null,
    headline: f?.headline ?? "",
    orientation: orientationOf(slot.width, slot.height),
    composition: f
      ? (COMPOSITION[f.screenshot.composition] ?? x.label(f.screenshot.composition))
      : "",
    captures: f ? captureLines(f, r?.identity?.image, x.label) : [],
    layer: f ? f.marketingLayer.present : null,
    state,
    note: excluded ?? (f ? "" : r ? `${r.status}: ${r.problems.join("; ")}` : "not analysed yet"),
  };
  return out;
}

function examples(recs: Recommendations | null, games: GameOrder[]): Record<string, Example[]> {
  const out: Record<string, Example[]> = {};
  if (!recs) return out;
  const theirs = games.filter((g) => !g.ours);
  for (const p of recs.positions) {
    const all = theirs.flatMap((g) =>
      g.rows
        .filter((r) => r.screenType === p.screenType && r.imageId)
        .map((r) => ({
          name: g.name,
          position: r.position,
          imageId: r.imageId as string,
          thumb: r.thumb,
        })),
    );
    all.sort((a, b) => Math.abs(a.position - p.position) - Math.abs(b.position - p.position));
    out[String(p.position)] = all.slice(0, 3);
  }
  return out;
}

function labelsFor(
  label: Labeler,
  p: Patterns | null,
  o: OursVsPatterns | null,
  r: Recommendations | null,
): Record<string, string> {
  const keys = new Set<string>();
  for (const x of p?.perPosition ?? []) for (const t of x.types) keys.add(t.key);
  for (const t of p?.screenTypes ?? []) keys.add(t.key);
  for (const t of p?.byScreenType ?? []) keys.add(t.key);
  for (const c of p?.composition ?? []) keys.add(c.key);
  for (const x of o?.positions ?? []) keys.add(x.ours.type);
  for (const x of r?.positions ?? []) {
    keys.add(x.screenType);
    if (x.subtype) keys.add(x.subtype);
  }
  return Object.fromEntries([...keys].map((k) => [k, label(k)]));
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
      return row(x, item ? { ...s, imageId: item.imageId } : s, ex ? ex.reason : null);
    });
    return {
      appId: g.appId,
      name: g.name,
      ours: g.appId === x.ourAppId,
      orderDate: x.orderDates.get(g.appId) ?? null,
      rows,
    };
  });
  const entries = batchEntries(plan, x.records, x.db, x.ourAppId);
  const total = plan.games.reduce((n, g) => n + g.positions.length, 0);
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
  const ai: AiPart | null = l ? { ...l, current: l.dataHash === x.dataHash } : null;
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
  return {
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
    examples: examples(ai?.recommendations ?? null, games),
    labels: labelsFor(x.label, patterns, oursVs, ai?.recommendations ?? null),
  };
}
