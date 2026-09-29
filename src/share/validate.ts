import { z } from "zod";
import { AttemptSchema } from "../analysis/attempts.ts";
import { ProjectSettingsSchema } from "../config/project-schema.ts";
import { RunConfigSchema } from "../config/schema.ts";
import { JournalSchema } from "../jobs/journal.ts";
import { LIB } from "../library/layout.ts";
import { GoogleIdSchema, LibraryFactsSchema, RefsSchema } from "../library/refs.ts";
import { ReportDefSchema } from "../reports/types.ts";
import { sha256 } from "../util/hash.ts";
import { isPicture } from "./format.ts";

/**
 * Checks of each file of a package against what the tool expects there (plan 12C, C3, step 6):
 * the settings, refs, journal, image facts, Google-id files, analysis records and attempt logs
 * pass their schemas; pictures are pictures, originals hash to their name, and every library
 * file about an image belongs to an image of this project. Returns a plain problem, or null.
 */
export const RecordSchema = z
  .object({
    imageId: z.string().regex(/^[0-9a-f]{64}$/),
    status: z.enum(["ok", "failed", "disputed", "adjudicated", "corrected", "unreviewed"]),
    // A real time, not in the future: a package cannot make its record win forever.
    updatedAt: z.iso
      .datetime({ offset: true })
      .refine((t) => Date.parse(t) <= Date.now() + 24 * 3_600_000),
    final: z.record(z.string(), z.unknown()).nullable(),
  })
  .passthrough();

export const AttemptLogSchema = z.object({ imageId: z.string(), attempts: z.array(AttemptSchema) });

const MAGIC: [RegExp, (b: Buffer) => boolean][] = [
  [/\.jpe?g$/i, (b) => b[0] === 0xff && b[1] === 0xd8],
  [/\.png$/i, (b) => b.subarray(0, 4).toString("latin1") === "\x89PNG"],
  [
    /\.webp$/i,
    (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
  ],
  [/\.gif$/i, (b) => b.subarray(0, 4).toString() === "GIF8"],
  [/\.bin$/i, () => true],
];

const SHA_IN =
  /^library\/(?:images\/(?:orig|thumb|model|crops|facts|pixels)\/|analysis\/|attempts\/|layer-diff\/|pixel-check\/|same-screen\/|layout\/)([0-9a-f]{64})/;

/** An analysis record has a status; anything else in the analysis folder is a side file. */
export const isRecordLike = (v: unknown) =>
  v !== null && typeof v === "object" && ("status" in v || "final" in v || "imageId" in v);

export function checkFile(name: string, bytes: Buffer, refs: Set<string>): string | null {
  const sha = SHA_IN.exec(name)?.[1];
  if (/^library\/images\//.test(name) && !sha)
    return `"${name}" is not a picture file the tool knows.`;
  if (sha && !refs.has(sha)) return `"${name}" belongs to a picture this project does not use.`;
  if (isPicture(name)) {
    const magic = MAGIC.find(([re]) => re.test(name));
    if (!magic?.[1](bytes)) return `"${name}" is not the picture it says it is.`;
    if (name.startsWith("library/images/orig/") && sha256(bytes) !== sha)
      return `"${name}" does not match its content.`;
    if (name.endsWith(".bin") && !name.startsWith("library/images/orig/"))
      return `"${name}" is not a picture file the tool knows.`;
    return null;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return `"${name}" is not readable text.`;
  }
  if (name.endsWith(".md")) return null;
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return `"${name}" is damaged (not valid JSON).`;
  }
  const bad = (what: string) => `"${name}" is not a valid ${what}.`;
  if (name === "project/project.json")
    return ProjectSettingsSchema.safeParse(v).success ? null : bad("project settings file");
  if (name === "project/refs.json")
    return RefsSchema.safeParse(v).success ? null : bad("image list");
  if (name === "project/run-config.json")
    return RunConfigSchema.safeParse(v).success ? null : bad("competitor pick");
  if (/^project\/reports\/defs\/[^/]+\.json$/.test(name))
    return ReportDefSchema.safeParse(v).success ? null : bad("report definition");
  if (name === "project/state/job.json")
    return JournalSchema.safeParse(v).success ? null : bad("job history");
  if (name.startsWith("library/images/facts/")) {
    const f = LibraryFactsSchema.safeParse(v);
    return f.success && f.data.sha256 === sha && f.data.id === sha ? null : bad("image record");
  }
  if (name.startsWith("library/google/")) {
    const g = GoogleIdSchema.safeParse(v);
    return g.success && LIB.google(g.data.googleId) === name ? null : bad("Google Play image link");
  }
  // Analysis records; other files kept beside them (e.g. layout notes) only need to be JSON.
  if (name.startsWith("library/analysis/") && isRecordLike(v)) {
    const r = RecordSchema.safeParse(v);
    return r.success && r.data.imageId === sha ? null : bad("analysis");
  }
  if (name.startsWith("library/attempts/")) {
    const a = AttemptLogSchema.safeParse(v);
    return a.success && a.data.imageId === sha ? null : bad("cost record");
  }
  return v !== null && typeof v === "object" ? null : bad("data file");
}
