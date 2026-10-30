/**
 * Market leaders within the analysed competitor set (decision D1, 2026-10-30): a game is a leader
 * when its installs are at least 20% of the set's top game, or when it is in the category's
 * top 10 grossing chart. Never relative to our game (against a new entrant everyone would be a
 * leader). Leaders confirm or cap a signal's strength; they never add votes (strength.ts).
 */
export const LEADER_SHARE = 0.2;
export const GROSSING_TOP = 10;

export interface GameMarket {
  appId: string;
  name: string;
  /** Google Play's installs bucket, e.g. "100,000,000+", or null when unknown. */
  installs: string | null;
  /** Exact installs, when the store answer had them (more precise than the bucket). */
  realInstalls?: number | null;
  /** Rank in the category's grossing chart of the report's country, or null. */
  grossingRank?: number | null;
}

export interface Leaders {
  /** False when no competitor has install or chart data: leader weighting is off. */
  on: boolean;
  /** App ids of the leaders. */
  ids: ReadonlySet<string>;
  games: { appId: string; name: string; installs: number | null; leader: boolean; why: string }[];
  /** One plain line for the report. */
  note: string;
}

/** "100,000,000+" -> 100000000 (the bucket's floor); null when unreadable. */
export function installsFloor(bucket: string | null | undefined): number | null {
  if (!bucket) return null;
  const n = Number(bucket.replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const short = (n: number) =>
  n >= 1e9 ? `${n / 1e9}B+` : n >= 1e6 ? `${n / 1e6}M+` : n >= 1e3 ? `${n / 1e3}K+` : `${n}+`;

export function leadersOf(games: readonly GameMarket[]): Leaders {
  const rows = games.map((g) => ({
    g,
    installs: g.realInstalls ?? installsFloor(g.installs),
    top10: g.grossingRank != null && g.grossingRank <= GROSSING_TOP,
  }));
  const known = rows.filter((r) => r.installs !== null || r.top10);
  if (!known.length)
    return {
      on: false,
      ids: new Set(),
      games: games.map((g) => ({
        appId: g.appId,
        name: g.name,
        installs: null,
        leader: false,
        why: "",
      })),
      note: "No install or chart data for the competitors: leader weighting is off.",
    };
  const top = Math.max(0, ...rows.map((r) => r.installs ?? 0));
  const out = rows.map((r) => {
    const big = r.installs !== null && top > 0 && r.installs >= top * LEADER_SHARE;
    const why = [
      big
        ? `${short(r.installs as number)} installs (at least ${LEADER_SHARE * 100}% of the top game)`
        : "",
      r.top10 ? `#${r.g.grossingRank} grossing` : "",
    ]
      .filter(Boolean)
      .join(", ");
    return { appId: r.g.appId, name: r.g.name, installs: r.installs, leader: big || r.top10, why };
  });
  const leaders = out.filter((x) => x.leader);
  return {
    on: true,
    ids: new Set(leaders.map((x) => x.appId)),
    games: out,
    note: leaders.length
      ? `Leaders: ${leaders.map((x) => `${x.name} (${x.why})`).join("; ")}.`
      : "No competitor qualifies as a leader.",
  };
}
