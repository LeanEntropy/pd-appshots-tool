import { readAttempts } from "../analysis/attempts.ts";
import { definitionOf } from "../analysis/categories.ts";
import { readMeasured } from "../analysis/colour-store.ts";
import { showsLogo } from "../analysis/image-tags.ts";
import { humanise } from "../analysis/labels.ts";
import { type AnalysisRecord, isUsable } from "../analysis/records.ts";
import type { ProjectPaths } from "../config/load.ts";
import { readOlderLayout } from "../layout/store.ts";
import { readFacts, readGoogleId } from "../library/imagedb.ts";
import { readRefs } from "../library/refs.ts";
import type { Storage } from "../storage/index.ts";

/**
 * The image page's smaller parts (plan 2.2): the header line, the footer's "analysed when, by
 * whom, for how much", and the folded details (measured facts, colours, raw fields, history).
 * All from saved files; nothing is measured or asked on page open.
 */
export type Pairs = [string, string][];

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const money = (u: number) => `$${u.toFixed(2)}`;

export function headerOf(
  storage: Storage,
  sha: string,
  r: AnalysisRecord | undefined,
  screen: string,
  game: string,
): { screen: string; screenHint: string; size: string; logo: string } {
  const f = readFacts(storage, sha);
  const usable = isUsable(r) ? r : null;
  const s = usable?.final.screenshot;
  const def = s ? (definitionOf(s.subtype) ?? definitionOf(s.screenType)) : null;
  return {
    screen: usable ? screen : "Not analysed yet",
    screenHint: def ? `${def.label}: ${def.definition}` : "",
    size: f ? `${humanise(f.orientation)} ${f.width} × ${f.height}` : "",
    logo: usable ? (showsLogo(usable.final, game) ? "Logo: yes" : "Logo: no") : "",
  };
}

/** "Analysed 27 Sep 2026 · models · $0.21 (paid by Rogue Legend)". */
export function footerOf(
  paths: ProjectPaths,
  r: AnalysisRecord | undefined,
  projectName: (id: string) => string,
): string {
  if (!r) return "Not analysed in this project yet.";
  const when = r.paidBy?.at ? `Analysed ${day(r.paidBy.at)}` : `Last updated ${day(r.updatedAt)}`;
  const models = [
    r.producer?.model,
    r.reviewer ? `checked by ${r.reviewer.model}` : "",
    r.adjudication ? `settled by ${r.adjudication.model}` : "",
  ].filter(Boolean);
  let cost = "";
  if (r.paidBy) {
    const paid = r.paidBy;
    const fromLog = readAttempts(paths, r.imageId)
      .filter((a) => a.runId === paid.runId && a.state === "finished" && typeof a.usd === "number")
      .reduce((s, a) => s + (a.usd ?? 0), 0);
    const usd = typeof paid.usd === "number" ? paid.usd : fromLog > 0 ? fromLog : null;
    cost = usd === null ? "cost unknown" : money(usd);
    if (paid.projectId !== paths.projectId) cost += ` (paid by ${projectName(paid.projectId)})`;
  }
  return [when, models.join(", "), cost].filter(Boolean).join(" · ");
}

export function measuredOf(storage: Storage, sha: string, coverageUpTo: number | null): Pairs {
  const f = readFacts(storage, sha);
  if (!f) return [];
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a);
  const k = g(f.width, f.height) || 1;
  const out: Pairs = [
    ["Size", `${f.width} × ${f.height} px`],
    ["Orientation", humanise(f.orientation)],
    ["Ratio", `${f.width / k}:${f.height / k}`],
    ["File", `${f.format.toUpperCase()}, ${Math.round(f.bytes / 1024)} KB`],
    ["Device shape", `${f.deviceClass} (confidence ${Math.round(f.deviceConfidence * 100)}%)`],
    ["Perceptual hash", f.phash],
    ["First seen", day(f.firstSeen)],
  ];
  if (coverageUpTo !== null)
    out.push(["Marketing coverage (measured)", `up to ${Math.round(coverageUpTo)}%`]);
  return out;
}

export interface ColourSet {
  label: string;
  colours: { name: string; hex: string }[];
}

export function coloursOf(paths: ProjectPaths, r: AnalysisRecord | undefined): ColourSet[] {
  if (!isUsable(r)) return [];
  const out: ColourSet[] = [];
  const idn = r.identity?.image;
  if (idn?.dominantColours.length)
    out.push({
      label: "Measured: whole image",
      colours: idn.dominantColours.map((c) => ({ name: c.family ?? c.hex, hex: c.hex })),
    });
  const m = readMeasured(paths, r);
  if (m?.screen.length) out.push({ label: "Measured: screenshot layer", colours: m.screen });
  if (m?.layer.length) out.push({ label: "Measured: marketing layer", colours: m.layer });
  const s = r.final.screenshot.mainColours;
  if (s.length) out.push({ label: "The model's reading: screenshot", colours: s });
  const ml = r.final.marketingLayer.mainColours;
  if (ml.length) out.push({ label: "The model's reading: marketing layer", colours: ml });
  return out.map((x) => ({
    label: x.label,
    colours: x.colours.map((c) => ({
      name: String(c.name),
      hex: /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "",
    })),
  }));
}

export function rawOf(r: AnalysisRecord | undefined): Pairs {
  if (!r) return [];
  return [
    ["Status", r.status],
    ["Analysis key", r.key ?? "(project)"],
    ["Provenance", r.provenance ?? ""],
    ["Written by", r.writtenBy ?? ""],
    ["Run", r.runId],
    ["Updated", r.updatedAt],
    ["Differences", r.differences.join("; ")],
    ["Problems", r.problems.join("; ")],
  ].filter((p): p is [string, string] => !!p[1]);
}

export interface History {
  attempts: { when: string; what: string; state: string; usd: string }[];
  total: string;
  notes: string[];
}

export function historyOf(
  storage: Storage,
  paths: ProjectPaths,
  r: AnalysisRecord | undefined,
  sha: string,
): History {
  const list = r ? readAttempts(paths, sha) : [];
  const total = list.reduce((s, a) => s + (typeof a.usd === "number" ? a.usd : 0), 0);
  const notes: string[] = [];
  if (r && isUsable(r)) {
    const old = readOlderLayout(paths, r);
    if (old)
      notes.push(`An older layout from ${day(old.file.createdAt)} is kept (${old.file.model}).`);
  }
  if (paths.library) {
    try {
      const refs = readRefs(storage, paths.library.refsKey, paths.projectId);
      for (const gid of refs.images[sha]?.googleIds ?? []) {
        const g = readGoogleId(storage, gid);
        for (const e of g?.entries ?? [])
          if (e.sha256 !== sha)
            notes.push(`Earlier picture in the same store slot, first seen ${day(e.firstSeen)}.`);
      }
    } catch {}
  }
  return {
    attempts: list.map((a) => ({
      when: day(a.at),
      what: a.runId.replace(/^.*?Z-/, "").replace(/-/g, " "),
      state: a.state,
      usd: typeof a.usd === "number" ? money(a.usd) : `about ${money(a.estimateUsd)}`,
    })),
    total: list.length ? money(total) : "",
    notes,
  };
}
