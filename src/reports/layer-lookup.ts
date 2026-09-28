import { currentLayerDiff, type LayerDiffRecord } from "../analysis/layer-diff.ts";
import { renderReportPrompt } from "../analysis/prompts.ts";
import { type AnalysisRecord, isUsable } from "../analysis/records.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import type { ScopeItem } from "./anchors.ts";

/** The text-layer comparison model and prompt of this project (part of every comparison key). */
export function layerSettings(loaded: LoadedConfig): { model: string; promptHash: string } {
  const paths = projectPaths(loaded);
  const prompt = renderReportPrompt(
    loaded.root,
    paths.objects,
    "layerDiff",
    loadTaxonomy(loaded).taxonomy,
  );
  const model = loaded.config.models.layerDiff.split(":")[1] ?? loaded.config.models.layerDiff;
  return { model, promptHash: prompt.hash };
}

/** Looks up the current text-layer comparison of an image against its anchor (no AI). */
export function layerLookup(
  loaded: LoadedConfig,
  records: ReadonlyMap<string, AnalysisRecord>,
): (imageId: string, anchorId: string) => LayerDiffRecord | undefined {
  const paths = projectPaths(loaded);
  const { model, promptHash } = layerSettings(loaded);
  return (imageId, anchorId) => {
    const anchor = records.get(anchorId);
    if (!isUsable(anchor)) return undefined;
    return currentLayerDiff(paths, imageId, anchor, model, promptHash);
  };
}

/**
 * A text comparison already done is free (its record is reused); one that found a different
 * screen under the text needs a full analysis instead (plan-reports 2.3; never escalated by
 * itself: this plan is shown and approved first).
 */
export function withLayerResults<T extends ScopeItem>(
  items: T[],
  ctx: { layer?: (imageId: string, anchorId: string) => LayerDiffRecord | undefined },
): T[] {
  if (!ctx.layer) return items;
  const planned = new Set(items.filter((i) => i.tier === "full").map((i) => i.imageId));
  return items.map((it) => {
    if (it.tier !== "layer-diff" || !it.basedOn) return it;
    const d = ctx.layer?.(it.imageId, it.basedOn);
    if (d?.status === "ok")
      return { ...it, tier: "identical", reason: "its text was compared already (free)" };
    if (d?.status !== "different-screen") return it;
    if (planned.has(it.imageId))
      return {
        ...it,
        tier: "identical",
        basedOn: it.imageId,
        reason: "the same image appears earlier in this report",
      };
    planned.add(it.imageId);
    return {
      ...it,
      tier: "full",
      basedOn: null,
      reason: "the text comparison found a different screen under the text: full analysis",
    };
  });
}
