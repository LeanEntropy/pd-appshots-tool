import type { ProjectPaths } from "../config/load.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import {
  type AttributesAnswer,
  attributesAnswerSchema,
  fromAnswer,
  type ImageAttributes,
} from "./attributes.ts";

/** Backfilled image attributes (D6), one file per image: projects/<id>/attributes/<image>.json. */
export const ATTRIBUTES_CONTRACT = "attributes.v1";

const fileKey = (paths: Pick<ProjectPaths, "projectId">, imageId: string) =>
  projectKey(paths, "attributes", `${imageId}.json`);

export function readSavedAttributes(
  paths: Pick<ProjectPaths, "projectId" | "workspace">,
  imageId: string,
): ImageAttributes | null {
  let raw: unknown;
  try {
    raw = workspaceStorage(paths.workspace).getJson(fileKey(paths, imageId));
  } catch {
    return null;
  }
  const v = raw as { contract?: string; answer?: unknown } | undefined;
  if (v?.contract !== ATTRIBUTES_CONTRACT) return null;
  const a = attributesAnswerSchema.safeParse(v.answer);
  return a.success ? fromAnswer(a.data) : null;
}

export function saveAttributes(
  paths: Pick<ProjectPaths, "projectId" | "workspace">,
  imageId: string,
  answer: AttributesAnswer,
  meta: { model: string; at: string },
): void {
  workspaceStorage(paths.workspace).putJson(fileKey(paths, imageId), {
    contract: ATTRIBUTES_CONTRACT,
    imageId,
    answer,
    ...meta,
  });
}
