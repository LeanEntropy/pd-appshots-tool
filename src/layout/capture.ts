import type { CallContext, ChunkImage } from "../analysis/call.ts";
import { renderLayoutPrompt } from "../analysis/prompts.ts";
import type { Provider } from "../analysis/providers.ts";
import { type AnalysisRecord, isUsable } from "../analysis/records.ts";
import { withOwnCost } from "../analysis/run-context.ts";
import type { LoadedConfig, ProjectPaths } from "../config/load.ts";
import { imageKey, modelFile } from "../library/layout.ts";
import { workspaceStorage } from "../storage/index.ts";
import type { ImageDb } from "../store/imagedb.ts";
import { layoutCall } from "./call.ts";
import { LAYOUT_MEASURE_VERSION, type LayoutMeasure, measureLayout } from "./measure/index.ts";
import {
  type LayoutFile,
  layoutKey,
  layoutStatus,
  measureKey,
  readLayoutMeasure,
  saveLayout,
} from "./store.ts";

export { readLayoutMeasure } from "./store.ts";

/** Pixel measurements of a saved layout, written once (code only; never fails the caller). */
export async function measureSaved(
  paths: ProjectPaths,
  db: Pick<ImageDb, "get">,
  r: AnalysisRecord,
  file: LayoutFile,
): Promise<LayoutMeasure | null> {
  const done = readLayoutMeasure(paths, r);
  if (done) return done;
  const storage = workspaceStorage(paths.workspace);
  const rec = db.get(r.imageId);
  const bytes =
    (rec ? storage.getBytes(imageKey(paths, rec.file)) : undefined) ??
    storage.getBytes(imageKey(paths, modelFile(!!paths.library, r.imageId)));
  if (!bytes) return null;
  const key = layoutKey(r.imageId, file.recordKey);
  const m = await measureLayout(bytes, file.layout, { imageId: r.imageId, layoutKey: key }).catch(
    () => null,
  );
  if (m) storage.putJsonOnce(measureKey(paths, r.imageId, key, LAYOUT_MEASURE_VERSION), m);
  return m;
}

export interface LayoutDeps {
  paths: ProjectPaths;
  db: Pick<ImageDb, "get">;
  provider: Provider;
  ctx: CallContext;
  root: string;
}

export type LayoutOutcome = "saved" | "had" | "skipped" | "failed";

/**
 * A usable record's layout in its own paid call (the main analysis is never touched), saved
 * once and measured by code. An image that already has a current layout costs nothing.
 */
export async function addLayout(
  d: LayoutDeps,
  r: AnalysisRecord,
  image: ChunkImage,
  source: LayoutFile["source"],
): Promise<{ outcome: LayoutOutcome; problems: string[] }> {
  if (!isUsable(r)) return { outcome: "skipped", problems: [] };
  const s = layoutStatus(d.paths, r);
  // A saved layout that no longer fits is kept (write-once): nothing is paid to replace it.
  if (s.status === "stale")
    return { outcome: "failed", problems: ["the saved layout no longer fits"] };
  const had = s.file;
  if (had) {
    await measureSaved(d.paths, d.db, r, had);
    return { outcome: "had", problems: [] };
  }
  const prompt = renderLayoutPrompt(d.root, d.paths.objects, d.ctx.taxonomy);
  const got = await layoutCall(d.provider, prompt, image, r.final, d.ctx);
  if (!got.layout) return { outcome: "failed", problems: got.problems };
  const file = saveLayout(d.paths, r, got.layout, {
    source,
    model: d.provider.model,
    object: got.key,
  });
  await measureSaved(d.paths, d.db, r, file);
  return { outcome: "saved", problems: [] };
}

/**
 * The step after each newly saved analysis when "Layout breakdown for new analyses" is on:
 * the layout call runs in the same pool task (so 3 at a time alongside the analyses), under the
 * batch's spending limit; Stop ends the batch after the current image as before.
 */
export function layoutAfterSave(
  loaded: LoadedConfig,
  paths: ProjectPaths,
  db: Pick<ImageDb, "get">,
  ctx: CallContext,
  provider: Provider,
) {
  if (!loaded.config.options.speed.layoutCapture) return undefined;
  return async (r: AnalysisRecord, image: ChunkImage, onCost?: (usd: number) => void) =>
    addLayout(
      { paths, db, provider, ctx: withOwnCost(ctx, onCost), root: loaded.root },
      r,
      image,
      "new",
    );
}
