import type { ProjectPaths } from "../config/load.ts";
import type { InfoView, ViewAnalysis } from "../view/model.ts";
import { artWording, artWordingDeep } from "./art-wording.ts";
import type { ImageIdentity } from "./identity.ts";
import { COMPOSITION, captureLines, imageLine, pendingMessage } from "./info-text.ts";
import { type Labeler, plainLabel, screenName } from "./labels.ts";
import type { PipelineSpec } from "./pipeline.ts";
import type { MappedFrom } from "./record-refresh.ts";
import { readStoredRecord, readStoredRecords, writeStoredRecord } from "./record-store.ts";
import { type ImageAnalysis, READABLE_SCHEMAS } from "./schema.ts";

/** Plan-v2 statuses, plus "unreviewed": a required second opinion could not be read. */
export type AnalysisStatus =
  | "ok"
  | "failed"
  | "disputed"
  | "adjudicated"
  | "corrected"
  | "unreviewed";

export interface AnalysisRecord {
  imageId: string;
  /** Schema version of `final`; records of another version are analysed again. */
  schema?: string;
  appId: string;
  gl: string;
  hl: string;
  position: number;
  status: AnalysisStatus;
  /** The accepted reading (producer's, or the adjudicated one); null when failed. */
  final: ImageAnalysis | null;
  producer: { model: string; object: string } | null;
  reviewer: { model: string; object: string } | null;
  adjudication: { model: string; object: string; reason: string } | null;
  differences: string[];
  problems: string[];
  runId: string;
  updatedAt: string;
  /** Which image this is: game, files, source URL, every appearance. Rebuilt on every write. */
  identity?: ImageIdentity;
  /** Taxonomy id@version the screen type refers to. */
  taxonomy?: string;
  /** Set when a deterministic taxonomy mapping changed the screen type (no model call). */
  mappedFrom?: MappedFrom | null;
  /** Version of the deterministic taxonomy mapping last applied. */
  mapping?: string;
  // Shared library only (plan 12A):
  /** Analysis key the record is stored under, or "unproven-<project>" for imported ones. */
  key?: string;
  /** "proven": reusable by any project with the same settings; "unproven": its project only. */
  provenance?: "proven" | "unproven";
  /** The settings the analysis key is the hash of (proven records). */
  pipeline?: PipelineSpec;
  /** Project that last wrote the record. */
  writtenBy?: string;
  /** Project and run that first paid for a usable result. Set once; usd unknown for imports. */
  paidBy?: {
    projectId: string;
    runId: string;
    batchId?: string | null;
    usd: number | null;
    at: string;
  } | null;
}

/**
 * Statuses that count as usable in statistics and for reuse by identical images. "unreviewed"
 * keeps the first reading: a failed second opinion never throws away a valid analysis.
 */
export const USABLE: readonly AnalysisStatus[] = ["ok", "adjudicated", "corrected", "unreviewed"];

/** Done = usable status, current schema, and a reading. Failed or old records are redone. */
export function isUsable(r: AnalysisRecord | undefined): r is AnalysisRecord & {
  final: ImageAnalysis;
} {
  // Which shapes a project accepts is decided by its analysis key (record-store.ts).
  return !!r && USABLE.includes(r.status) && READABLE_SCHEMAS.has(r.schema ?? "") && !!r.final;
}

export function writeRecord(paths: ProjectPaths, r: AnalysisRecord): void {
  writeStoredRecord(paths, r);
}

export function readRecord(paths: ProjectPaths, imageId: string): AnalysisRecord | undefined {
  return readStoredRecord(paths, imageId);
}

export function readRecords(paths: ProjectPaths): Map<string, AnalysisRecord> {
  return readStoredRecords(paths);
}

export function screenLabel(a: ImageAnalysis | null, label: Labeler = plainLabel): string {
  if (!a) return "not analysed";
  return screenName(label, a.screenshot.screenType, a.screenshot.subtype);
}

/** Short caption under a thumbnail: usable analyses only (failed ones are shown as errors). */
export function summaries(
  paths: ProjectPaths,
  label: Labeler = plainLabel,
): Map<string, ViewAnalysis> {
  const out = new Map<string, ViewAnalysis>();
  for (const [id, r] of readRecords(paths)) {
    if (!isUsable(r)) continue;
    out.set(id, {
      screen: artWording(screenLabel(r.final, label)),
      headline: r.final.headline,
      status: r.status,
    });
  }
  return out;
}

/** Everything the (i) popover shows, per image id. Includes failed records with their errors. */
export function infoViews(
  paths: ProjectPaths,
  label: Labeler = plainLabel,
): Record<string, InfoView> {
  const out: Record<string, InfoView> = {};
  for (const [id, r] of readRecords(paths)) {
    const usable = isUsable(r);
    const idn = r.identity;
    out[id] = artWordingDeep({
      status: !usable
        ? r.status === "failed"
          ? "failed"
          : `${r.status} (outdated)`
        : r.status === "unreviewed"
          ? "not double-checked (the second opinion failed; first reading kept)"
          : r.status,
      screen: usable ? screenLabel(r.final, label) : "",
      final: usable ? r.final : null,
      differences: r.differences,
      problems: r.problems,
      models: [r.producer?.model, r.reviewer?.model, r.adjudication?.model].filter(
        (m): m is string => !!m,
      ),
      updatedAt: r.updatedAt,
      game: idn?.game ?? r.appId,
      position: r.position,
      filename: idn?.filename ?? id,
      file: idn?.files.original?.relative ?? null,
      sourceUrl: idn?.sourceUrl ?? null,
      appearances: (idn?.appearances ?? []).map(
        (a) => `${a.game} ${a.gl.toUpperCase()}-${a.hl} #${a.position}`,
      ),
      labels: usable
        ? {
            type: label(r.final.screenshot.screenType),
            subtype: r.final.screenshot.subtype ? label(r.final.screenshot.subtype) : "",
          }
        : null,
      mappedFrom: r.mappedFrom ? label(r.mappedFrom.screenType) : null,
      image: imageLine(idn?.image),
      imageColours:
        idn?.image?.dominantColours.map((c) => ({ name: c.family ?? c.hex, hex: c.hex })) ?? [],
      composition: usable ? (COMPOSITION[r.final.screenshot.composition] ?? null) : null,
      captures: usable ? captureLines(r.final, idn?.image, label) : [],
      pending: usable ? null : pendingMessage(r),
    });
  }
  return out;
}
