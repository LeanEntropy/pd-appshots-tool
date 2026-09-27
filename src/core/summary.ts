import type { ChartResult, Listing } from "../play/client.ts";
import { googleImageId } from "../play/screenshots.ts";
import { type DeckTarget, deckKey, type Group } from "./targets.ts";

export interface GroupCounts {
  apps: number;
  decks: number;
  available: number;
  unavailable: number;
  failed: number;
  screenshots: number;
  uniqueImages: number;
}

export interface ChartCountry {
  gl: string;
  status: "ok" | "error";
  found: number;
  /** Chart games that are not ours and not a named competitor. */
  newGames: number;
  error?: string;
}

export interface PreviewSummary {
  groups: Record<Group, GroupCounts>;
  total: GroupCounts;
  /** Screenshots whose Google image id already appeared in another deck (no second download). */
  repeatedAcrossDecks: number;
  estimatedBytes: number;
  aiCalls: 0;
  charts: ChartCountry[];
}

function emptyCounts(): GroupCounts {
  return {
    apps: 0,
    decks: 0,
    available: 0,
    unavailable: 0,
    failed: 0,
    screenshots: 0,
    uniqueImages: 0,
  };
}

function count(
  targets: readonly DeckTarget[],
  listings: ReadonlyMap<string, Listing>,
): GroupCounts {
  const c = emptyCounts();
  const apps = new Set<string>();
  const ids = new Set<string>();
  for (const t of targets) {
    apps.add(t.appId);
    c.decks++;
    const l = listings.get(deckKey(t));
    if (!l || l.status === "error") c.failed++;
    else if (l.status === "unavailable") c.unavailable++;
    else {
      c.available++;
      c.screenshots += l.screenshots.length;
      for (const s of l.screenshots) ids.add(googleImageId(s));
    }
  }
  c.apps = apps.size;
  c.uniqueImages = ids.size;
  return c;
}

/** Deterministic preview numbers: what a download would fetch, and its disk estimate. */
export function summarize(
  targets: readonly DeckTarget[],
  listings: ReadonlyMap<string, Listing>,
  charts: readonly ChartResult[],
  bytesPerImage: number,
  thumbBytesPerImage = 20_000,
): PreviewSummary {
  const groups = {
    ours: count(
      targets.filter((t) => t.group === "ours"),
      listings,
    ),
    named: count(
      targets.filter((t) => t.group === "named"),
      listings,
    ),
    chart: count(
      targets.filter((t) => t.group === "chart"),
      listings,
    ),
  };
  const total = count(targets, listings);
  const chartIds = new Set(targets.filter((t) => t.group === "chart").map((t) => t.appId));
  const chartRows: ChartCountry[] = charts.map((ch) => ({
    gl: ch.gl,
    status: ch.status,
    found: ch.entries.length,
    newGames: ch.entries.filter((e) => chartIds.has(e.appId)).length,
    ...(ch.error ? { error: ch.error } : {}),
  }));
  return {
    groups,
    total,
    repeatedAcrossDecks: total.screenshots - total.uniqueImages,
    estimatedBytes: total.uniqueImages * (bytesPerImage + thumbBytesPerImage),
    aiCalls: 0,
    charts: chartRows,
  };
}
