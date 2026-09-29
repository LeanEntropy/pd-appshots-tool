import { type AnalysisRecord, isUsable } from "../analysis/records.ts";
import { appleRefsKey } from "../appstore/data.ts";
import { forPlatform } from "../appstore/platform.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { readRefs } from "../library/refs.ts";
import { workspaceStorage } from "../storage/index.ts";
import { hamming } from "../store/identity.ts";
import { openImageDb } from "../store/imagedb.ts";
import type { AnchorCandidate } from "./anchors.ts";
import { type CrossStore, RESHAPED_BITS } from "./cross-store.ts";
import type { PlanContext } from "./plan-context.ts";
import { projectMarkets } from "./scope-plan.ts";

/**
 * The App Store part of a report's plan (plan-app-store 4): per image, its store and the Play
 * picture it equals apart from file compression (the fetch's strict check); per game, every
 * analysed picture of either store and any country as a possible anchor for a text comparison.
 * `planned`: Play images a "Google Play vs App Store" report analyses in the same run.
 */
export function appleScope(
  loaded: LoadedConfig,
  ctx: PlanContext,
  games: readonly { appId: string }[],
  records: ReadonlyMap<string, AnalysisRecord>,
  planned: readonly AnchorCandidate[] = [],
): {
  input: (imageId: string) => { platform: "appstore"; sameAs?: string };
  cross: Omit<CrossStore, "same">;
} {
  const apple = ctx.apple ?? new Set<string>();
  const label = new Map(projectMarkets(loaded).map((m) => [m.gl, m.label]));
  const wanted = new Set(games.map((g) => g.appId));
  const candidates = new Map<string, AnchorCandidate[]>();
  const add = (c: AnchorCandidate) => {
    const list = candidates.get(c.appId) ?? [];
    if (!list.some((x) => x.imageId === c.imageId)) candidates.set(c.appId, [...list, c]);
  };
  for (const r of records.values()) {
    if (!isUsable(r) || !wanted.has(r.appId)) continue;
    const rec = ctx.db.get(r.imageId);
    if (!rec) continue;
    add({
      appId: r.appId,
      gl: r.gl,
      hl: r.hl,
      country: label.get(r.gl) ?? r.gl.toUpperCase(),
      position: r.position,
      imageId: r.imageId,
      phash: rec.phash,
      width: rec.width,
      height: rec.height,
      analysed: true,
      store: apple.has(r.imageId) ? "App Store" : "Google Play",
    });
  }
  for (const c of planned) if (wanted.has(c.appId)) add({ ...c, analysed: true });
  return {
    input: (imageId) => {
      const sameAs = ctx.twins?.get(imageId);
      return { platform: "appstore", ...(sameAs ? { sameAs } : {}) };
    },
    cross: { candidates, bits: RESHAPED_BITS },
  };
}

/**
 * A picture pair the user may answer across the two stores (plan-app-store 4): an App Store
 * image and another image of the project whose fingerprints are within the reshaped line.
 */
export function crossStorePair(loaded: LoadedConfig, image: string, anchor: string): boolean {
  const paths = projectPaths(forPlatform(loaded, "appstore"));
  if (!paths.library || image === anchor) return false;
  const db = openImageDb(paths);
  const s = workspaceStorage(paths.workspace);
  const apple = readRefs(s, appleRefsKey(paths), paths.projectId).images;
  const a = db.get(image);
  const b = db.get(anchor);
  if (!a || !b || !(apple[a.id] || apple[b.id])) return false;
  return a.phash.length === b.phash.length && hamming(a.phash, b.phash) <= RESHAPED_BITS;
}

/** Per store, what a plan sends to AI and what is free (the approval's lines, plan-app-store 4). */
export function storeCounts(
  items: readonly {
    tier: string;
    platform?: string;
    pixelSuggested?: string;
    sameAs?: string;
    basedOn: string | null;
  }[],
): { play: StoreCount; appstore: StoreCount } | null {
  if (!items.some((i) => i.platform === "appstore")) return null;
  const count = (list: typeof items): StoreCount => ({
    full: list.filter((i) => i.tier === "full").length,
    layerDiff: list.filter((i) => i.tier === "layer-diff").length,
    identical: list.filter((i) => i.tier === "identical").length,
    samePicture: list.filter((i) => i.tier === "identical" && !!i.sameAs && i.basedOn === i.sameAs)
      .length,
    toConfirm: list.filter((i) => i.tier === "full" && !!i.pixelSuggested).length,
  });
  return {
    play: count(items.filter((i) => i.platform !== "appstore")),
    appstore: count(items.filter((i) => i.platform === "appstore")),
  };
}

export interface StoreCount {
  full: number;
  layerDiff: number;
  identical: number;
  /** Free: the same picture as a Play image apart from file compression. */
  samePicture: number;
  /** Full analyses that become text comparisons if the user answers "Same screen". */
  toConfirm: number;
}
