import { estimate } from "../analysis/estimate.ts";
import type { LoadedConfig } from "../config/load.ts";
import { settingsOf } from "../settings/access.ts";
import { stableHash } from "../util/hash.ts";
import type { AnchorCandidate } from "./anchors.ts";
import { storeCounts } from "./apple-scope.ts";
import { forStore, type PlanContext } from "./plan-context.ts";
import { buildScopePlan, type PlanImage, type ScopePlan } from "./scope-plan.ts";
import type { ReportScope } from "./types.ts";

/**
 * The plan of a "Google Play vs App Store" report (plan-app-store 7.2): the chosen games in the
 * chosen countries on both stores. Play images are tiered as in a Compare countries report; App
 * Store images then take the Play images of this plan as anchors too (they are analysed first in
 * the same run), so a picture is never paid twice across the stores. The written parts are made
 * by code: the plan has no text-only AI step.
 */
export function buildStoresPlan(
  loaded: LoadedConfig,
  scope: ReportScope,
  o: { ctx?: PlanContext } = {},
): ScopePlan {
  const base = { ...scope, type: "compare" as const };
  const p = forStore(loaded, "play", o.ctx);
  const play = buildScopePlan(
    p.loaded,
    { ...base, platform: "play" },
    { proposeDrop: false, ctx: p.ctx },
  );
  const planned: AnchorCandidate[] = play.items
    .filter((i) => i.tier === "full")
    .map((i) => ({
      appId: i.appId,
      gl: i.gl,
      hl: i.hl,
      country: i.country,
      position: i.position,
      imageId: i.imageId,
      phash: i.phash,
      width: i.width,
      height: i.height,
      analysed: true,
      store: "Google Play",
    }));
  const a = forStore(loaded, "appstore", o.ctx);
  const apple = buildScopePlan(
    a.loaded,
    { ...base, platform: "appstore" },
    { proposeDrop: false, ctx: a.ctx, crossPlanned: planned },
  );
  // A file or picture analysed for Google Play in this run is never analysed again for Apple.
  const playFull = new Set(planned.map((c) => c.imageId));
  const appleItems: PlanImage[] = apple.items.map((i) => {
    if (i.tier !== "full") return i;
    if (playFull.has(i.imageId))
      return {
        ...i,
        tier: "identical",
        basedOn: i.imageId,
        reason: "the same file as a Google Play image of this report",
      };
    if (i.sameAs && playFull.has(i.sameAs))
      return {
        ...i,
        tier: "identical",
        basedOn: i.sameAs,
        reason: "the same picture as a Google Play image (only file compression differs)",
      };
    return i;
  });
  const items = [...play.items, ...appleItems];
  const counts = {
    identical: items.filter((i) => i.tier === "identical").length,
    layerDiff: items.filter((i) => i.tier === "layer-diff").length,
    full: items.filter((i) => i.tier === "full").length,
    newImages: 0,
  };
  counts.newImages = counts.layerDiff + counts.full;
  const images = estimate(loaded.config, items, false);
  const limitUsd = settingsOf(loaded.config).spending.perReportUsd;
  const body = {
    type: "stores" as const,
    main: play.main,
    markets: play.markets,
    games: play.games,
    decks: [...play.decks, ...apple.decks],
    items,
    counts,
    cap: null,
    instant: counts.newImages === 0,
    images,
    text: { parts: [], usd: [0, 0] as [number, number], later: false },
    usd: images.usd,
    limitUsd,
    overLimit: images.usd[1] > limitUsd,
    drop: null,
    byStore: storeCounts(items),
    platform: "both" as const,
  };
  return { ...body, planHash: stableHash(body) };
}
