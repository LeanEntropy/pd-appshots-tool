import { namesBrand } from "../analysis/brand.ts";
import { lines, showsLogo } from "../analysis/image-tags.ts";
import type { Labeler } from "../analysis/labels.ts";
import type { FitSummary } from "../analysis/pattern-fit.ts";
import type { DeckEntry } from "../analysis/patterns.ts";
import { type Interpretation, logoOf, type Recommendations } from "../analysis/synthesis-schema.ts";

/**
 * The summary at the top of every report (plan-reports 3C): the short answer, the key
 * recommendations and the dates. The verdict is computed by code; the AI's short answer is used
 * only when it is current and keeps that verdict word, otherwise code writes it.
 */
export interface SummaryPart {
  shortAnswer: string;
  /** True when the short answer is the AI's wording (current, with the computed verdict). */
  worded: boolean;
  /** The top changes, one line each, with the position (full spec in Recommendations). */
  keyRecommendations: { position: number; text: string }[];
  /** The recommendations came from older data. */
  recommendationsStale: boolean;
  country: string;
  dates: {
    generated: string | null;
    storeFrom: string | null;
    storeTo: string | null;
    analyses: string | null;
  };
}

export interface SummaryInput {
  fit: FitSummary | null;
  interpretation: Interpretation | null;
  recommendations: Recommendations | null;
  aiCurrent: boolean;
  competitors: number;
  market: string;
  label: Labeler;
  generatedAt: string | null;
  orderDates: (string | null)[];
  analysedAt: (string | null)[];
  /** Our analysed images: a kept position counts as a change when its text or logo differs. */
  ours?: readonly Pick<DeckEntry, "position" | "name" | "final">[];
}

const KEEP = /^keep our current position (\d+)/i;
type RecPosition = Recommendations["positions"][number];
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * What a slot changes against our deck, in a few words; "" when it keeps our image as it is.
 * A kept screenshot still changes when it moves, or its marketing text or logo differs from ours.
 */
function changeOf(p: RecPosition, ours: SummaryInput["ours"]): string {
  const keep = KEEP.exec(p.source);
  if (!keep) return "change";
  const n = Number(keep[1]);
  if (n !== p.position) return `moved from position ${n}`;
  const cur = ours?.find((o) => o.position === n);
  if (!cur) return "";
  const now = lines(cur.final, cur.name).map(norm);
  const next = (p.marketingLayer.present ? p.marketingLayer.texts : [])
    .map((t) => t.text)
    .filter((t) => /[\p{L}\p{N}]/u.test(t) && !namesBrand(t, cur.name))
    .map(norm);
  const what: string[] = [];
  if (next.some((t) => !now.includes(t))) what.push("new text");
  else if (now.some((t) => !next.includes(t))) what.push("text removed");
  const logo = logoOf(p);
  const had = showsLogo(cur.final, cur.name);
  if (logo && logo.show !== had) what.push(logo.show ? "add the logo" : "remove the logo");
  return what.join(", ");
}

export function summaryPart(x: SummaryInput): SummaryPart {
  const f = x.fit;
  const ai = x.aiCurrent ? x.interpretation : null;
  // Reports saved before the short answer existed have none.
  const short = (ai as { shortAnswer?: string } | null)?.shortAnswer ?? "";
  const worded = !!f && !!short && short.toLowerCase().includes(f.verdict);
  const code = f
    ? [
        `Our store page is ${f.verdict} compared with ${x.competitors} ${x.competitors === 1 ? "competitor" : "competitors"} in ${x.market}${f.points ? `: it fits ${f.points.fit} of ${f.points.total} weighted pattern points` : f.score !== null ? `: it fits ${Math.round(f.score * 100)}% of their weighted patterns` : ""}.`,
        f.keyPoints[0]
          ? `The most important change: ${f.keyPoints[0]}`
          : "It already follows every competitor pattern found.",
      ].join(" ")
    : "Not enough competitor data yet for a verdict: at least 2 competitors need analysed screenshots.";
  const recs = x.recommendations
    ? [...x.recommendations.positions].sort((a, b) => a.position - b.position)
    : [];
  const changes = recs.map((p) => ({ p, change: changeOf(p, x.ours) })).filter((c) => c.change);
  const keyRecommendations = changes.slice(0, 5).map(({ p, change }) => {
    const headline = p.marketingLayer.present ? p.marketingLayer.texts[0]?.text : "";
    const logo = logoOf(p);
    return {
      position: p.position,
      text: `${x.label(p.screenType)}${p.subtype ? ` / ${x.label(p.subtype)}` : ""}${headline ? `, headline "${headline}"` : ""}${logo ? `, ${logo.show ? "with" : "without"} the game logo` : ""} (${p.source}${KEEP.test(p.source) ? `: ${change}` : ""})`,
    };
  });
  const dates = (xs: (string | null)[]) => xs.filter((d): d is string => !!d).sort();
  const store = dates(x.orderDates);
  const analysed = dates(x.analysedAt);
  return {
    shortAnswer: worded ? short : code,
    worded,
    keyRecommendations,
    recommendationsStale: !!x.recommendations && !x.aiCurrent,
    country: x.market,
    dates: {
      generated: x.generatedAt,
      storeFrom: store[0] ?? null,
      storeTo: store.at(-1) ?? null,
      analyses: analysed.at(-1)?.slice(0, 10) ?? null,
    },
  };
}
