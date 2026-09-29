import { noFactIds } from "../analysis/country-advice-schema.ts";
import type { CountryReport } from "./country-report-types.ts";

/**
 * The bottom line's lists (by code, the same as the page's report-country.ts): the gaps several
 * countries share (a computed key point's claim, the part before ": ", found in 2 or more
 * countries) and each country's own key points (its advice's first actions when written, else
 * its computed gaps not shared).
 */
export interface SharedPoint {
  key: string;
  per: { gl: string; label: string; detail: string }[];
}

export interface OwnPoint {
  text: string;
  why: string;
  impact: "small" | "medium" | "large" | null;
  code: boolean;
}

function kpKey(k: string): { key: string; detail: string } {
  const m = /^(.+?):\s+(.+)$/.exec(k);
  return m?.[1] && m[2] ? { key: m[1], detail: m[2].replace(/\.$/, "") } : { key: k, detail: "" };
}

export function sharedPoints(r: CountryReport): SharedPoint[] {
  if (r.countries.length < 2) return [];
  const m = new Map<string, SharedPoint>();
  for (const c of r.countries)
    for (const k of c.data.fit?.keyPoints ?? []) {
      const p = kpKey(k);
      const g = m.get(p.key) ?? { key: p.key, per: [] };
      if (!g.per.some((q) => q.gl === c.gl))
        g.per.push({ gl: c.gl, label: c.label, detail: p.detail });
      m.set(p.key, g);
    }
  return [...m.values()]
    .filter((g) => g.per.length >= 2)
    .sort((a, b) => b.per.length - a.per.length);
}

const firstSentence = (s: string) => /^.+?[.!?](?=\s|$)/.exec(s.trim())?.[0] ?? s.trim();

export function ownPoints(r: CountryReport, gl: string, shared: SharedPoint[]): OwnPoint[] {
  const a = r.advice.find((x) => x.gl === gl)?.advice;
  if (a)
    return a.actions.slice(0, 3).map((x) => ({
      text: noFactIds(x.action),
      why: firstSentence(noFactIds(x.why)),
      impact: x.impact,
      code: false,
    }));
  const kps = r.countries.find((c) => c.gl === gl)?.data.fit?.keyPoints ?? [];
  const keys = new Set(shared.filter((g) => g.per.some((q) => q.gl === gl)).map((g) => g.key));
  const acts = r.summary.keyActions
    .filter((k) => k.gl === gl && k.source === "code" && !kps.includes(k.text))
    .map((k) => ({ text: k.text, why: k.why, impact: null, code: true }));
  const gaps = kps
    .filter((k) => !keys.has(kpKey(k).key))
    .map((k) => ({ text: k, why: "", impact: null, code: true }));
  return [...acts, ...gaps].slice(0, 3);
}
