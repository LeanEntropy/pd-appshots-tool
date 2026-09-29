import { type SameCheck, sameCheck } from "../analysis/deck-repeats.ts";
import type { LayerDiffRecord } from "../analysis/layer-diff.ts";
import { type AnalysisRecord, isUsable, readRecords } from "../analysis/records.ts";
import { appleRefsKey, SamePictureSchema, samePictureKey } from "../appstore/data.ts";
import { forPlatform } from "../appstore/platform.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { readRefs } from "../library/refs.ts";
import { workspaceStorage } from "../storage/index.ts";
import { type ImageDb, openImageDb } from "../store/imagedb.ts";
import { latestRun } from "../view/model.ts";
import { layerLookup } from "./layer-lookup.ts";
import { readDifferentPairs, readSamePairs } from "./match-check.ts";
import { pixelInput } from "./pixel-pairs.ts";

/**
 * What every plan of one request reads from disk (the image database, the analyses, the pairs
 * marked different, the game names): read once and shared, so the suggestions can price many
 * scopes in one go.
 */
export interface PlanContext {
  db: ImageDb;
  records: Map<string, AnalysisRecord>;
  different: Set<string>;
  names: Map<string, string>;
  /** The current text-layer comparison of an image against an anchor (none: not compared). */
  layer?: (imageId: string, anchorId: string) => LayerDiffRecord | undefined;
  /** The pixel check (item 8); undefined when it is off (fingerprint only). */
  pixel?: ReturnType<typeof pixelInput>;
  /** The "same screen uploaded twice" check (cached pixel checks and headlines); none: never. */
  same?: SameCheck;
  /** The store the context reads (missing: Google Play). */
  platform?: "play" | "appstore";
  /** App Store: the project's App Store images (the rest of `db` are Google Play's). */
  apple?: ReadonlySet<string>;
  /** App Store: the Play picture each App Store image equals apart from file compression. */
  twins?: ReadonlyMap<string, string>;
}

/** Chart games of the latest download (never analysed unless the user ticks them). */
export function chartGames(loaded: LoadedConfig): { appId: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const d of latestRun(projectPaths(loaded).runs)?.decks ?? [])
    if (d.group === "chart" && !seen.has(d.appId)) seen.set(d.appId, d.title ?? d.name);
  return [...seen].map(([appId, name]) => ({ appId, name }));
}

/** Plain name of a game of the project (ours, a named competitor or a chart game). */
export function gameNames(loaded: LoadedConfig): Map<string, string> {
  const { config } = loaded;
  return new Map([
    ...chartGames(loaded).map((g) => [g.appId, g.name] as const),
    ...config.competitors.map((c) => [c.id, c.name] as const),
    [config.ourApp.id, config.ourApp.name],
  ]);
}

/**
 * App Store images that are the same picture as a Play image apart from file compression (the
 * fetch's strict check, library/same-picture): each reads its twin's analysis, with no copy made.
 */
function withTwins(
  loaded: LoadedConfig,
  records: Map<string, AnalysisRecord>,
): { apple: Set<string>; twins: Map<string, string> } {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const apple = new Set(Object.keys(readRefs(s, appleRefsKey(paths), paths.projectId).images));
  const twins = new Map<string, string>();
  for (const id of apple) {
    const p = SamePictureSchema.safeParse(s.getJson(samePictureKey(id)));
    if (!p.success) continue;
    twins.set(id, p.data.sameAs);
    const twin = records.get(p.data.sameAs);
    if (!isUsable(records.get(id)) && isUsable(twin)) records.set(id, { ...twin, imageId: id });
  }
  return { apple, twins };
}

export function planContext(loaded: LoadedConfig): PlanContext {
  const paths = projectPaths(loaded);
  const records = readRecords(paths);
  const appstore = paths.platform === "appstore" && !!paths.library;
  const apple = appstore ? withTwins(loaded, records) : undefined;
  return {
    db: openImageDb(paths),
    records,
    different: readDifferentPairs(loaded),
    names: gameNames(loaded),
    layer: layerLookup(loaded, records),
    pixel: pixelInput(loaded, records, readSamePairs(loaded)),
    same: sameCheck(paths, records),
    platform: appstore ? "appstore" : "play",
    ...(apple ? { apple: apple.apple, twins: apple.twins } : {}),
  };
}

const siblings = new WeakMap<PlanContext, PlanContext>();

/**
 * The project and the plan context for a report's store (plan-app-store 7.1): a context read for
 * Google Play is never used for an App Store report (its decks, images and twins differ).
 */
export function forStore(
  loaded: LoadedConfig,
  platform: unknown,
  ctx?: PlanContext,
): { loaded: LoadedConfig; ctx: PlanContext } {
  const view = forPlatform(loaded, platform);
  const want = view.platform === "appstore" ? "appstore" : "play";
  if (ctx && (ctx.platform ?? "play") === want) return { loaded: view, ctx };
  const hit = ctx && siblings.get(ctx);
  if (hit) return { loaded: view, ctx: hit };
  const made = planContext(view);
  if (ctx) siblings.set(ctx, made);
  return { loaded: view, ctx: made };
}
