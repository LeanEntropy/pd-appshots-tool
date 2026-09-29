import { STEP_CEILING_USD } from "../analysis/budget.ts";
import { isUsable, readRecords } from "../analysis/records.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { stableHash } from "../util/hash.ts";
import { LAYOUT_STEP } from "./call.ts";
import { layoutCostModel } from "./cost.ts";
import type { LayoutFailure } from "./failure.ts";
import { lastLayoutFailures } from "./run-log.ts";
import { layoutStatus } from "./store.ts";

export interface BackfillItem {
  imageId: string;
  game: string;
  ours: boolean;
  where: string[];
}

export interface BackfillScope {
  items: BackfillItem[];
  ours: number;
  competitors: number;
  usd: [number, number];
  /** The spending limit: the run stops there. */
  limitUsd: number;
  /** Fingerprint of exactly this list: the approval refers to it. */
  scopeHash: string;
  /** true: the list is the images that failed before (their own, explicit approval). */
  retryFailed: boolean;
  /** Images whose last layout run failed, with why: never in the default list. */
  failed: LayoutFailure[];
  /** One image's layout, typical and high, from the recorded costs. */
  perImageUsd: [number, number];
  /** Where the per-image cost comes from, in plain words. */
  basis: string;
}

/**
 * Earlier images without a current layout that reports need first (user decision D3): ours in
 * every country, and competitors' store positions 1 to 3. Free to compute; nothing is called.
 * An image whose last layout run failed is left out: trying it again is its own approval
 * (`retryFailed`), which lists only those images.
 */
export function backfillScope(
  loaded: LoadedConfig,
  opts: { retryFailed?: boolean } = {},
): BackfillScope {
  const retryFailed = opts.retryFailed === true;
  const paths = projectPaths(loaded);
  const ours = loaded.config.ourApp.id;
  const failedBefore = lastLayoutFailures(paths);
  const items: BackfillItem[] = [];
  const failed: LayoutFailure[] = [];
  for (const r of readRecords(paths).values()) {
    if (!isUsable(r)) continue;
    const st = layoutStatus(paths, r).status;
    if (st === "current" || st === "stale") continue;
    const apps = r.identity?.appearances ?? [
      { appId: r.appId, gl: r.gl, hl: r.hl, position: r.position, game: r.appId },
    ];
    const isOurs = r.appId === ours || apps.some((a) => a.appId === ours);
    if (!isOurs && !apps.some((a) => a.position <= 3)) continue;
    const before = failedBefore.get(r.imageId);
    if (before) failed.push(before);
    if (!!before !== retryFailed) continue;
    items.push({
      imageId: r.imageId,
      game: r.identity?.game ?? r.appId,
      ours: isOurs,
      where: apps.map((a) => `${a.gl.toUpperCase()}-${a.hl} #${a.position}`),
    });
  }
  items.sort((a, b) => Number(b.ours) - Number(a.ours) || a.game.localeCompare(b.game));
  const n = items.length;
  const cost = layoutCostModel(paths);
  // Images that failed before tend to need every attempt (3 calls): the high end counts them.
  const per = [cost.perImage[0], retryFailed ? cost.perCall[1] * 3 : cost.perImage[1]];
  const usd = per.map((u) => Math.round(n * u * 100) / 100) as [number, number];
  // It stops at the top of the range, and never below one call's reserved ceiling.
  const limitUsd = n ? Math.max(usd[1], STEP_CEILING_USD[LAYOUT_STEP] ?? 0.25) : 0;
  return {
    items,
    ours: items.filter((i) => i.ours).length,
    competitors: items.filter((i) => !i.ours).length,
    usd,
    limitUsd,
    scopeHash: stableHash({ items, usd, limitUsd, retryFailed }),
    retryFailed,
    failed,
    perImageUsd: per.map((u) => Math.round(u * 100) / 100) as [number, number],
    basis: cost.basis,
  };
}
