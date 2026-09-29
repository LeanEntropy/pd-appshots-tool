import { join } from "node:path";
import {
  analysisKey,
  currentPipeline,
  MODEL_COPY,
  PER_IMAGE_STEPS,
  type PipelineSpec,
} from "../analysis/pipeline.ts";
import type { Config } from "../config/schema.ts";
import { libraryKey, type ProjectContext, projectKey, workspaceStorage } from "../storage/index.ts";
import { sha256 } from "../util/hash.ts";

/**
 * Shared library layout (plan 12A, A1), all under library/ (workspace/_library/):
 *   images/orig/<sha>.<ext>, images/thumb/<sha>.webp, images/model/<sha>-<edge>.jpg
 *   images/facts/<sha>.json     image record: hashes, size, device guess (write-once)
 *   images/pixels/<sha>.<v>.json pixel facts: orientation, ratio, colours (write-once per version)
 *   google/<hash of id>.json    Google image id -> the image hashes fetched under it (append-only)
 *   analysis/<sha>/<key>.json   analysis records
 *   objects/<step>/<key>.json   per-image model answers
 */
export const LIB = {
  images: libraryKey("images"),
  imageFile: (rel: string) => libraryKey("images", rel),
  facts: (sha: string) => libraryKey("images", "facts", `${sha}.json`),
  pixels: (sha: string, version: string) =>
    libraryKey("images", "pixels", `${sha}.${version}.json`),
  google: (googleId: string) => libraryKey("google", `${sha256(googleId).slice(0, 40)}.json`),
  analysisDir: (sha: string) => libraryKey("analysis", sha),
  record: (sha: string, key: string) => libraryKey("analysis", sha, `${key}.json`),
  object: (step: string, key: string) => libraryKey("objects", step, `${key}.json`),
  /** layout/<sha>/<layout key>.json: an image's layout breakdown (write-once per key). */
  layoutDir: (sha: string) => libraryKey("layout", sha),
  layout: (sha: string, key: string) => libraryKey("layout", sha, `${key}.json`),
};

export const refsKey = (ctx: ProjectContext) => projectKey(ctx, "refs.json");

/** Storage key of an image file ("orig/<sha>.jpg", "thumb/...", "model/...") for a project. */
export function imageKey(
  p: ProjectContext & { library: LibraryLayout | null },
  rel: string,
): string {
  return p.library ? LIB.imageFile(rel) : projectKey(p, "images", rel);
}

/**
 * The model copy's path relative to the images folder. In the library its name carries the
 * long edge, so a change of preprocessing (a new model-copy version) never reuses old copies.
 */
export function modelFile(inLibrary: boolean, imageId: string): string {
  return inLibrary ? `model/${imageId}-${MODEL_COPY.longEdge}.jpg` : `model/${imageId}.jpg`;
}

/** Storage key of a cached model answer (per-image steps are shared once in the library). */
export function answerKey(
  p: ProjectContext & { library: LibraryLayout | null },
  step: string,
  key: string,
): string {
  return p.library && PER_IMAGE_STEPS.has(step)
    ? LIB.object(step, key)
    : projectKey(p, "objects", step, `${key}.json`);
}

/** Storage key of an image's cached pixel facts (colours, orientation, ratio). */
export function pixelsKey(
  p: ProjectContext & { library: LibraryLayout | null },
  imageId: string,
  version: string,
): string {
  return p.library
    ? LIB.pixels(imageId, version)
    : projectKey(p, "images", "facts", `${imageId}.json`);
}

/** How a project reaches its images and analyses once it uses the shared library. */
export interface LibraryLayout {
  /** Absolute path of workspace/_library. */
  dir: string;
  /** Storage key of this project's references (refs.json, or a staged copy during the import). */
  refsKey: string;
  /** Analysis key of this project's current settings, and the spec it is the hash of. */
  analysisKey: string;
  pipeline: PipelineSpec;
}

/** Forces a layout (the import compares the old and the staged new layout side by side). */
export type LayoutOverride = { mode: "legacy" } | { mode: "library"; refsKey: string };

/** A project uses the library once it has refs.json (written by the import or a new download). */
export function libraryLayout(
  config: Config,
  workspace: string,
  override?: LayoutOverride,
): LibraryLayout | null {
  if (override?.mode === "legacy") return null;
  const storage = workspaceStorage(workspace);
  const refs = override?.refsKey ?? refsKey({ projectId: config.project });
  if (!override && !storage.exists(refs)) return null;
  const pipeline = currentPipeline(config);
  return {
    dir: join(storage.root, "_library"),
    refsKey: refs,
    analysisKey: analysisKey(pipeline),
    pipeline,
  };
}
