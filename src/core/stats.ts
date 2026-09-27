import type { DeckManifest } from "../store/manifest.ts";
import type { Group } from "./targets.ts";

export interface AppStats {
  appId: string;
  name: string;
  group: Group;
  /** Deck length per "gl-hl"; missing when the listing is unavailable there. */
  lengths: Record<string, number>;
  unavailable: string[];
  /** Screenshots in non-baseline decks that are byte-identical to one in the baseline deck. */
  identicalToBaseline: number;
  nonBaselineSlots: number;
}

export interface RunStats {
  games: number;
  decks: number;
  decksAvailable: number;
  decksUnavailable: number;
  decksFailed: number;
  locales: number;
  slots: number;
  uniqueImages: number;
  identicalToBaseline: number;
  nonBaselineSlots: number;
  deckLengths: Record<Group, { min: number; median: number; max: number; n: number }>;
  apps: AppStats[];
}

function spread(ns: number[]): { min: number; median: number; max: number; n: number } {
  if (ns.length === 0) return { min: 0, median: 0, max: 0, n: 0 };
  const s = [...ns].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median =
    s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
  return { min: s[0] as number, median, max: s[s.length - 1] as number, n: s.length };
}

/** Deterministic run numbers from deck manifests. Identity = same content id (sha256). */
export function computeStats(
  decks: readonly DeckManifest[],
  baseline: { gl: string; hl: string },
): RunStats {
  const byApp = new Map<string, DeckManifest[]>();
  for (const d of decks) byApp.set(d.appId, [...(byApp.get(d.appId) ?? []), d]);
  const apps: AppStats[] = [];
  for (const [appId, list] of byApp) {
    const first = list[0] as DeckManifest;
    const base = list.find(
      (d) => d.gl === baseline.gl && d.hl === baseline.hl && d.status === "ok",
    );
    const baseIds = new Set(base?.slots.map((s) => s.imageId).filter((x) => x) ?? []);
    const a: AppStats = {
      appId,
      name: first.title ?? first.name,
      group: first.group,
      lengths: {},
      unavailable: [],
      identicalToBaseline: 0,
      nonBaselineSlots: 0,
    };
    for (const d of list) {
      const loc = `${d.gl}-${d.hl}`;
      if (d.status !== "ok") {
        if (d.status === "unavailable") a.unavailable.push(loc);
        continue;
      }
      a.lengths[loc] = d.deckLength;
      if (d === base || !base) continue;
      a.nonBaselineSlots += d.slots.length;
      a.identicalToBaseline += d.slots.filter((s) => s.imageId && baseIds.has(s.imageId)).length;
    }
    apps.push(a);
  }
  const ok = decks.filter((d) => d.status === "ok");
  const lengthsOf = (g: Group) =>
    ok
      .filter((d) => d.group === g && d.gl === baseline.gl && d.hl === baseline.hl)
      .map((d) => d.deckLength);
  const ids = new Set(
    ok.flatMap((d) => d.slots.map((s) => s.imageId).filter((x): x is string => !!x)),
  );
  return {
    games: byApp.size,
    decks: decks.length,
    decksAvailable: ok.length,
    decksUnavailable: decks.filter((d) => d.status === "unavailable").length,
    decksFailed: decks.filter((d) => d.status === "error").length,
    locales: new Set(decks.map((d) => `${d.gl}-${d.hl}`)).size,
    slots: ok.reduce((n, d) => n + d.slots.length, 0),
    uniqueImages: ids.size,
    identicalToBaseline: apps.reduce((n, a) => n + a.identicalToBaseline, 0),
    nonBaselineSlots: apps.reduce((n, a) => n + a.nonBaselineSlots, 0),
    deckLengths: {
      ours: spread(lengthsOf("ours")),
      named: spread(lengthsOf("named")),
      chart: spread(lengthsOf("chart")),
    },
    apps,
  };
}
