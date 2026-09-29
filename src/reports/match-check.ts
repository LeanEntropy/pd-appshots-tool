import { readRecords } from "../analysis/records.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { analysedSlots, fitFor } from "../core/selection.ts";
import { settingsOf } from "../settings/access.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import { hamming, NEAR_IDENTICAL_BITS } from "../store/identity.ts";
import { openImageDb } from "../store/imagedb.ts";
import { readDeck } from "../store/manifest.ts";
import { PIXEL_ASK_BITS, PIXEL_MAX_BITS, pixelVerdict } from "../store/pixel-diff.ts";
import { pairKey, samePicture } from "./anchors.ts";
import { type PairPixel, pairPixelOf, pixelLookup, pixelSettings } from "./pixel-pairs.ts";

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

/** Pairs the user answered "same screen" (the pixel check never overrides them). */
export function readSamePairs(loaded: LoadedConfig): Set<string> {
  return new Set(
    Object.entries(read(loaded).pairs)
      .filter(([, v]) => v.same === true)
      .map(([k]) => k),
  );
}

export function savePairVerdict(loaded: LoadedConfig, a: string, b: string, same: boolean): void {
  savePairVerdicts(loaded, [{ image: a, anchor: b, same }]);
}

/** Several answers in one write (the pixel check's "Confirm all"); null removes an answer (Undo). */
export function savePairVerdicts(
  loaded: LoadedConfig,
  pairs: readonly { image: string; anchor: string; same: boolean | null }[],
): void {
  const paths = projectPaths(loaded);
  const s = read(loaded);
  const at = new Date().toISOString();
  for (const p of pairs) {
    const k = pairKey(p.image, p.anchor);
    if (p.same === null) delete s.pairs[k];
    else s.pairs[k] = { same: p.same, at };
  }
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
  /** What the pixel check found (when it ran): its verdict, shares and the changed areas. */
  pixel?: PairPixel;
  /**
   * same-new-text: one block the user confirms with one click (suggest mode); moved: a full
   * analysis the check would turn into a text comparison (in the same block, never blocking);
   * decided: automatic mode, listed only. Absent: asked one by one.
   */
  group?: "same-new-text" | "moved" | "decided";
}

/** The pairs a run waits for: everything asked, and the one-click block until it is confirmed. */
export const blocking = (pairs: readonly MatchPair[]) =>
  pairs.filter((p) => p.group !== "moved" && p.group !== "decided");

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
  const px = pixelSettings(config);
  const look = px.mode === "off" ? null : pixelLookup(loaded, readRecords(paths));
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
        const r = best && look ? look(img.id, best.r.id) : undefined;
        const v = r ? pixelVerdict(r, px) : undefined;
        const same =
          !!best &&
          user?.same !== false &&
          (look
            ? samePicture(best.r, img, PIXEL_MAX_BITS) &&
              (user?.same === true ||
                (px.mode === "automatic" && v ? v !== "different" : samePicture(best.r, img)))
            : samePicture(best.r, img));
        if (same) out.same++;
        else out.different++;
        if (!best) continue;
        const listed = v
          ? best.bits <= PIXEL_MAX_BITS &&
            (best.bits >= DOUBT_BITS.from || (v === "different" && best.bits <= PIXEL_ASK_BITS))
          : best.bits >= DOUBT_BITS.from && best.bits <= DOUBT_BITS.to;
        if (!listed) continue;
        const group = !user && v === "same-new-text" ? groupOf(px.mode) : undefined;
        out.doubtful.push({
          game: a.name,
          country: m.label,
          position: s.position,
          image: { id: img.id, thumb: img.thumb ?? null },
          anchor: { id: best.r.id, thumb: best.r.thumb ?? null, position: best.position },
          bits: best.bits,
          treatedAs: same ? "same" : "different",
          userSaid: user ? (user.same ? "same" : "different") : null,
          ...(r && v ? { pixel: pairPixelOf(r, v) } : {}),
          ...(group ? { group } : {}),
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

const groupOf = (mode: "off" | "suggest" | "automatic") =>
  mode === "automatic" ? ("decided" as const) : ("same-new-text" as const);

/**
 * The doubtful picture matches of one report's plan that the user has not answered yet
 * (plan-reports 2.4; the R3 review, finding 8): each text comparison whose picture is close to
 * the "same picture" line. The paid approval shows them first, and a run is refused until every
 * one is answered (Same screen keeps the text comparison; Different screens makes it a full
 * analysis). With the pixel check (item 8): pairs it calls "same picture, new text" form one
 * block ("Confirm all"; in automatic mode listed as decided), together with the full analyses it
 * would move to text comparisons; pairs with changes outside the text and band stay one by one
 * with the changed areas; a pair the check calls different is asked when its fingerprint is
 * within 10 bits. A saved answer always wins: answered pairs are never listed.
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
    pixelSuggested?: string;
  }[],
): MatchPair[] {
  const paths = projectPaths(loaded);
  const db = openImageDb(paths);
  const saved = read(loaded).pairs;
  const px = pixelSettings(loaded.config);
  const look = px.mode === "off" ? null : pixelLookup(loaded, readRecords(paths));
  const out: MatchPair[] = [];
  for (const it of items) {
    const moved = it.tier === "full" && !!it.pixelSuggested;
    const anchorId = moved ? it.pixelSuggested : it.tier === "layer-diff" ? it.basedOn : null;
    if (!anchorId) continue;
    const img = db.get(it.imageId);
    const anchor = db.get(anchorId);
    if (!img || !anchor || img.phash.length !== anchor.phash.length) continue;
    const bits = hamming(img.phash, anchor.phash);
    if (saved[pairKey(img.id, anchor.id)]) continue;
    const r = look ? look(img.id, anchor.id) : undefined;
    const v = r ? pixelVerdict(r, px) : undefined;
    let group: MatchPair["group"];
    if (moved) group = "moved";
    else if (!v || v === "same-screen") {
      if (bits < DOUBT_BITS.from) continue;
    } else if (v === "same-new-text") {
      if (bits < DOUBT_BITS.from) continue;
      group = groupOf(px.mode);
    } else if (bits > PIXEL_ASK_BITS) continue;
    out.push({
      game: it.name,
      country: it.country,
      position: it.position,
      image: { id: img.id, thumb: img.thumb ?? null },
      anchor: { id: anchor.id, thumb: anchor.thumb ?? null, position: 0 },
      bits,
      treatedAs: moved ? "different" : "same",
      userSaid: null,
      ...(r && v ? { pixel: pairPixelOf(r, v) } : {}),
      ...(group ? { group } : {}),
    });
  }
  return out;
}
