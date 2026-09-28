import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { analysedSlots, fitFor } from "../core/selection.ts";
import { settingsOf } from "../settings/access.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import { hamming, NEAR_IDENTICAL_BITS } from "../store/identity.ts";
import { openImageDb } from "../store/imagedb.ts";
import { readDeck } from "../store/manifest.ts";
import { pairKey, samePicture } from "./anchors.ts";

/**
 * The early accuracy check of "same picture" (plan-reports 2.4, milestone R3), code only: every
 * image of our game and the picked competitors in the other countries is matched with the
 * closest picture of the same game in the main country. Matches near the threshold are doubtful
 * and shown side by side; the user can mark a pair as different screens, and the planner then
 * never treats them as the same picture (the image gets a full analysis).
 */
export const DOUBT_BITS = { from: 4, to: 10 } as const;

const fileKey = (c: { projectId: string }) => projectKey(c, "state", "picture-checks.json");

interface Saved {
  pairs: Record<string, { same: boolean; at: string }>;
}

function read(loaded: LoadedConfig): Saved {
  const paths = projectPaths(loaded);
  try {
    const raw = workspaceStorage(paths.workspace).getJson(fileKey(paths)) as Saved | undefined;
    return raw && typeof raw.pairs === "object" && raw.pairs ? raw : { pairs: {} };
  } catch {
    return { pairs: {} };
  }
}

/** Pairs the user marked as different screens (never the same picture in any plan). */
export function readDifferentPairs(loaded: LoadedConfig): Set<string> {
  return new Set(
    Object.entries(read(loaded).pairs)
      .filter(([, v]) => v.same === false)
      .map(([k]) => k),
  );
}

export function savePairVerdict(loaded: LoadedConfig, a: string, b: string, same: boolean): void {
  const paths = projectPaths(loaded);
  const s = read(loaded);
  s.pairs[pairKey(a, b)] = { same, at: new Date().toISOString() };
  workspaceStorage(paths.workspace).putJson(fileKey(paths), s);
}

export interface MatchPair {
  game: string;
  country: string;
  position: number;
  image: { id: string; thumb: string | null };
  anchor: { id: string; thumb: string | null; position: number };
  bits: number;
  /** How the planner treats the pair now. */
  treatedAs: "same" | "different";
  /** The user's own answer, when given. */
  userSaid: "same" | "different" | null;
}

export interface MatchCheck {
  checked: number;
  identical: number;
  same: number;
  different: number;
  doubtful: MatchPair[];
}

export function matchCheck(loaded: LoadedConfig, limit = 24): MatchCheck {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const db = openImageDb(paths);
  const main = settingsOf(config).mainMarket;
  const saved = read(loaded).pairs;
  const apps = [
    { appId: config.ourApp.id, name: config.ourApp.name },
    ...fitFor(loaded).fit.selected,
  ];
  const out: MatchCheck = { checked: 0, identical: 0, same: 0, different: 0, doubtful: [] };
  for (const a of apps) {
    const home = readDeck(paths.decks, { appId: a.appId, gl: main.gl, hl: main.hl });
    const anchors = (home?.status === "ok" ? analysedSlots(config, home) : []).flatMap((s) => {
      const r = s.imageId ? db.get(s.imageId) : undefined;
      return r ? [{ r, position: s.position }] : [];
    });
    for (const m of config.markets) {
      if (m.gl === main.gl && m.hl === main.hl) continue;
      const d = readDeck(paths.decks, { appId: a.appId, gl: m.gl, hl: m.hl });
      for (const s of d?.status === "ok" ? analysedSlots(config, d) : []) {
        const img = s.imageId ? db.get(s.imageId) : undefined;
        if (!img) continue;
        out.checked++;
        if (anchors.some((x) => x.r.id === img.id)) {
          out.identical++;
          continue;
        }
        const best = anchors
          .filter((x) => x.r.phash.length === img.phash.length)
          .map((x) => ({ ...x, bits: hamming(x.r.phash, img.phash) }))
          .sort((x, y) => x.bits - y.bits)[0];
        const user = best ? saved[pairKey(best.r.id, img.id)] : undefined;
        const same = !!best && samePicture(best.r, img) && user?.same !== false;
        if (same) out.same++;
        else out.different++;
        if (!best || best.bits < DOUBT_BITS.from || best.bits > DOUBT_BITS.to) continue;
        out.doubtful.push({
          game: a.name,
          country: m.label,
          position: s.position,
          image: { id: img.id, thumb: img.thumb ?? null },
          anchor: { id: best.r.id, thumb: best.r.thumb ?? null, position: best.position },
          bits: best.bits,
          treatedAs: same ? "same" : "different",
          userSaid: user ? (user.same ? "same" : "different") : null,
        });
      }
    }
  }
  // Closest to the threshold first: those are the least certain.
  out.doubtful.sort(
    (x, y) =>
      Math.abs(x.bits - NEAR_IDENTICAL_BITS - 0.5) - Math.abs(y.bits - NEAR_IDENTICAL_BITS - 0.5),
  );
  out.doubtful = out.doubtful.slice(0, limit);
  return out;
}

/**
 * The doubtful picture matches of one report's plan that the user has not answered yet
 * (plan-reports 2.4; the R3 review, finding 8): each text comparison whose picture is close to
 * the "same picture" line. The paid approval shows them first, and a run is refused until every
 * one is answered (Same screen keeps the text comparison; Different screens makes it a full
 * analysis).
 */
export function doubtfulInPlan(
  loaded: LoadedConfig,
  items: readonly {
    tier: string;
    imageId: string;
    basedOn: string | null;
    name: string;
    country: string;
    position: number;
  }[],
): MatchPair[] {
  const db = openImageDb(projectPaths(loaded));
  const saved = read(loaded).pairs;
  const out: MatchPair[] = [];
  for (const it of items) {
    if (it.tier !== "layer-diff" || !it.basedOn) continue;
    const img = db.get(it.imageId);
    const anchor = db.get(it.basedOn);
    if (!img || !anchor || img.phash.length !== anchor.phash.length) continue;
    const bits = hamming(img.phash, anchor.phash);
    const user = saved[pairKey(img.id, anchor.id)];
    if (bits < DOUBT_BITS.from || user) continue;
    out.push({
      game: it.name,
      country: it.country,
      position: it.position,
      image: { id: img.id, thumb: img.thumb ?? null },
      anchor: { id: anchor.id, thumb: anchor.thumb ?? null, position: 0 },
      bits,
      treatedAs: "same",
      userSaid: null,
    });
  }
  return out;
}
