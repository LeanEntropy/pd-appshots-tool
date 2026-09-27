import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectPaths } from "../config/load.ts";
import { readJson, writeJsonAtomic } from "../util/fsx.ts";
import type { ViewAnalysis } from "../view/model.ts";
import type { ImageAnalysis } from "./schema.ts";

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
}

/** Statuses that count as usable in statistics and for reuse by identical images. */
export const USABLE: readonly AnalysisStatus[] = ["ok", "adjudicated", "corrected"];

export function writeRecord(paths: ProjectPaths, r: AnalysisRecord): void {
  writeJsonAtomic(join(paths.analysis, `${r.imageId}.json`), r);
}

export function readRecords(paths: ProjectPaths): Map<string, AnalysisRecord> {
  const out = new Map<string, AnalysisRecord>();
  if (!existsSync(paths.analysis)) return out;
  for (const f of readdirSync(paths.analysis).filter((n) => n.endsWith(".json"))) {
    const r = readJson(join(paths.analysis, f)) as AnalysisRecord;
    out.set(r.imageId, r);
  }
  return out;
}

export function summaries(paths: ProjectPaths): Map<string, ViewAnalysis> {
  const out = new Map<string, ViewAnalysis>();
  for (const [id, r] of readRecords(paths)) {
    const screen = r.final
      ? `${r.final.screenType}${r.final.subtype ? ` / ${r.final.subtype}` : ""}`
      : "not analysed";
    out.set(id, {
      screen: screen.replace(/_/g, " "),
      headline: r.final?.headline ?? "",
      status: r.status,
    });
  }
  return out;
}
