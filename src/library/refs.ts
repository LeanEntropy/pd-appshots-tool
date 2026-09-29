import { z } from "zod";
import type { Storage } from "../storage/index.ts";

export const ImageSourceSchema = z.object({
  appId: z.string(),
  gl: z.string(),
  hl: z.string(),
  position: z.number().int(),
  /** Missing means Google Play; read through platformOf (src/appstore/data.ts). */
  platform: z.literal("appstore").optional(),
});

/** Which library images one project uses, and where each appears (plan 12A, A1). */
export const RefsSchema = z.object({
  version: z.literal(1),
  projectId: z.string(),
  images: z.record(
    z.string().regex(/^[0-9a-f]{64}$/),
    z.object({ sources: z.array(ImageSourceSchema), googleIds: z.array(z.string()) }),
  ),
});
export type Refs = z.infer<typeof RefsSchema>;

/** Image record facts stored once in the library (the old db.json entry minus project data). */
export const LibraryFactsSchema = z.object({
  id: z.string(),
  sha256: z.string(),
  phash: z.string(),
  width: z.number(),
  height: z.number(),
  format: z.string(),
  bytes: z.number(),
  /** Relative to library/images, e.g. "orig/<sha>.jpg". */
  file: z.string(),
  thumb: z.string(),
  deviceClass: z.enum(["phone", "tablet", "unknown"]),
  orientation: z.string(),
  deviceConfidence: z.number(),
  firstSeen: z.string(),
});
export type LibraryFacts = z.infer<typeof LibraryFactsSchema>;

/** Every image fetched under one Google image id, oldest first (append-only). */
export const GoogleIdSchema = z.object({
  version: z.literal(1),
  googleId: z.string(),
  entries: z.array(z.object({ sha256: z.string(), firstSeen: z.string() })),
});
export type GoogleIdFile = z.infer<typeof GoogleIdSchema>;

export function readRefs(storage: Storage, key: string, projectId: string): Refs {
  const raw = storage.getJson(key);
  if (raw === undefined) return { version: 1, projectId, images: {} };
  const parsed = RefsSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`The image references of "${projectId}" cannot be read.`);
  return parsed.data;
}
