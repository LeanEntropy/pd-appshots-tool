import { OLD_COUNT } from "../analysis/repeat-findings.ts";
import type { ReportData } from "../analysis/report-data.ts";
import {
  type BottomItem,
  type BottomPoints,
  type BottomVerdict,
  bottomPoints,
  type StructuredBottom,
} from "./bottom-points.ts";
import { ownPoints, sharedPoints } from "./country-points.ts";
import type { CountryReport } from "./country-report-types.ts";
import { countryName } from "./names.ts";

/**
 * The bottom-line points of each report type (bottom-points.ts), from its saved data: the Pilot
 * and the Full check (report data: the big verdict word is shown above, so no verdict line), and
 * the One country and Compare countries versions (a verdict line with its chip). Computed when a
 * version is shown, so saved versions get them with no AI call; plus their markdown.
 */
const joinNames = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/** The AI's structured bottom line, when the saved answer has a usable one. */
function structuredOf(x: unknown): StructuredBottom | null {
  const b = (x as { bottomLine?: Partial<StructuredBottom> } | null | undefined)?.bottomLine;
  if (!b || !Array.isArray(b.differences) || !Array.isArray(b.actions)) return null;
  return { verdict: String(b.verdict ?? ""), differences: b.differences, actions: b.actions };
}

export function dataPoints(d: ReportData): BottomPoints | null {
  const s = d.summary;
  if (!s) return null;
  const f = d.fit;
  const ours = d.repeats?.find((r) => r.ours);
  const i = d.ai?.current ? d.ai.interpretation : null;
  // The key points and key recommendations are listed right below.
  const kp = f?.keyPoints ?? [];
  const aiKp = i?.keyPoints && i.keyPoints.length === kp.length ? i.keyPoints : [];
  return bottomPoints({
    shortAnswer: s.shortAnswer,
    verdict: null,
    verdictWords: f ? [f.verdict] : [],
    findings: ours ? [{ text: ours.text, note: ours.counted ? "" : OLD_COUNT }] : [],
    structured: s.worded ? structuredOf(i) : null,
    shownBelow: [...kp, ...aiKp, ...s.keyRecommendations.map((r) => r.text)],
    multi: false,
  });
}

function countryVerdict(r: CountryReport): BottomVerdict | null {
  const v = r.summary.verdicts;
  const one = v.length === 1 ? v[0] : undefined;
  if (one)
    return {
      groups: [
        {
          word: one.verdict,
          text:
            one.verdict === "not enough data"
              ? `in ${countryName(one.label)}`
              : `from ${one.competitors} ${one.competitors === 1 ? "competitor" : "competitors"} in ${countryName(one.label)}`,
        },
      ],
      meta: one.points ? `${one.points.fit} of ${one.points.total} pattern points` : "",
    };
  if (!v.length) return null;
  const by = new Map<string, string[]>();
  for (const x of v) by.set(x.verdict, [...(by.get(x.verdict) ?? []), countryName(x.label)]);
  const n = Math.max(0, ...v.map((x) => x.competitors));
  return {
    groups: [...by].map(([word, names]) => ({ word, text: `in ${joinNames(names)}` })),
    meta: n ? `against up to ${n} competitors per country` : "",
  };
}

export function countryPoints(r: CountryReport): BottomPoints {
  const v = r.summary.verdicts;
  const multi = r.countries.length > 1;
  const shared = sharedPoints(r);
  const below = [
    ...shared.map((g) => g.key),
    ...r.countries.flatMap((c) => ownPoints(r, c.gl, shared).map((p) => p.text)),
  ];
  const texts = new Set(
    r.countries.flatMap((c) => (c.data.repeats ?? []).filter((f) => f.ours).map((f) => f.text)),
  );
  const one = v.length === 1 ? v[0] : undefined;
  const advice = one?.shortAnswer ? r.advice.find((a) => a.gl === one.gl)?.advice : null;
  return bottomPoints({
    shortAnswer: r.summary.shortAnswer,
    verdict: countryVerdict(r),
    verdictWords: [...new Set(v.map((x) => x.verdict))],
    findings: [...texts].map((text) => ({ text, note: "" })),
    structured: structuredOf(advice),
    shownBelow: below,
    multi,
  });
}

/** Adds the points to a report's served data (saved data unchanged when anything is unexpected). */
export function withDataPoints<T>(raw: T): T {
  try {
    const d = raw as ReportData;
    const points = d?.summary ? dataPoints(d) : null;
    return points && d.summary ? ({ ...d, summary: { ...d.summary, points } } as T) : raw;
  } catch {
    return raw;
  }
}

export function withCountryPoints<T>(raw: T): T {
  try {
    const r = raw as CountryReport;
    return { ...r, summary: { ...r.summary, points: countryPoints(r) } } as T;
  } catch {
    return raw;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function itemMd(i: BottomItem): string {
  const t = i.segs
    .map((s) =>
      s.b ? `**${s.t.trim()}**${/\s$/.test(s.t) ? " " : ""}` : s.tr ? ` _${s.t.trim()}_` : s.t,
    )
    .join("");
  return `${t}${i.note ? ` _(${i.note})_` : ""}`;
}

/** The points in markdown: the verdict line, "What differs" bullets, "Do first" numbered. */
export function pointsMarkdown(p: BottomPoints): string[] {
  const out: string[] = [];
  if (p.verdict)
    out.push(
      `${p.verdict.groups.map((g) => `**${cap(g.word)}** ${g.text}`).join("; ")}${p.verdict.meta ? ` (${p.verdict.meta})` : ""}.`,
      "",
    );
  if (p.differs.length)
    out.push("**What differs**", "", ...p.differs.map((i) => `- ${itemMd(i)}`), "");
  if (p.actions.length)
    out.push("**Do first**", "", ...p.actions.map((i, n) => `${n + 1}. ${itemMd(i)}`), "");
  return out;
}

/** A saved report.md with its prose bottom line (the saved short answer) replaced by the points. */
export function upgradeBottomMd(md: string, savedShort: unknown, p: BottomPoints | null): string {
  if (!p || typeof savedShort !== "string" || !savedShort.trim()) return md;
  const at = md.indexOf(`\n${savedShort}\n`);
  if (at < 0) return md;
  const lines = pointsMarkdown(p);
  while (lines.at(-1) === "") lines.pop();
  return `${md.slice(0, at + 1)}${lines.join("\n")}${md.slice(at + 1 + savedShort.length)}`;
}
