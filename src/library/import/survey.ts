import { createHash } from "node:crypto";
import type { StoredObject } from "../../analysis/call.ts";
import { PER_IMAGE_STEPS } from "../../analysis/pipeline.ts";
import type { AnalysisRecord } from "../../analysis/records.ts";
import type { ProjectContext } from "../../storage/index.ts";
import { projectKey, type Storage } from "../../storage/index.ts";
import type { DbFile } from "../../store/imagedb-legacy.ts";
import { LIB, modelFile } from "../layout.ts";
import { type Provenance, proveRecord } from "./provenance.ts";

/** One file the import hardlinks from the project into the library. */
export interface LinkOp {
  from: string;
  to: string;
  kind: "original" | "thumbnail" | "model copy" | "model answer";
  /** Originals only: the content hash the file must have. */
  sha256?: string;
}

export interface Inventory {
  db: DbFile;
  links: LinkOp[];
  /** Pixel facts (colours, orientation) cached per image, by facts version. */
  pixels: { from: string; sha: string; version: string }[];
  records: { record: AnalysisRecord; proof: Provenance }[];
  bytes: number;
}

const DB = (ctx: ProjectContext) => projectKey(ctx, "images", "db.json");

export function hasLegacyData(storage: Storage, ctx: ProjectContext): boolean {
  return storage.exists(DB(ctx));
}

/** Everything the import would link, write and classify. Reads only. */
export function inventory(storage: Storage, ctx: ProjectContext): Inventory {
  const db = storage.getJson(DB(ctx)) as DbFile | undefined;
  if (!db?.images) throw new Error(`Project "${ctx.projectId}" has no image database to import.`);
  const links: LinkOp[] = [];
  const pixels: Inventory["pixels"] = [];
  let bytes = 0;
  for (const r of Object.values(db.images)) {
    bytes += r.bytes;
    links.push({
      from: projectKey(ctx, "images", r.file),
      to: LIB.imageFile(r.file),
      kind: "original",
      sha256: r.id,
    });
    const thumb = projectKey(ctx, "images", r.thumb);
    if (storage.exists(thumb))
      links.push({ from: thumb, to: LIB.imageFile(r.thumb), kind: "thumbnail" });
    const model = projectKey(ctx, "images", modelFile(false, r.id));
    if (storage.exists(model))
      links.push({
        from: model,
        to: LIB.imageFile(modelFile(true, r.id)),
        kind: "model copy",
      });
    const px = projectKey(ctx, "images", "facts", `${r.id}.json`);
    const facts = storage.getJson(px) as { version?: string } | undefined;
    if (facts?.version) pixels.push({ from: px, sha: r.id, version: facts.version });
  }
  for (const step of PER_IMAGE_STEPS)
    for (const k of storage.list(projectKey(ctx, "objects", step))) {
      const name = k.split("/").at(-1) ?? "";
      const o = storage.getJson(k) as StoredObject | undefined;
      if (name.endsWith(".json") && o?.key)
        links.push({ from: k, to: LIB.object(step, name.slice(0, -5)), kind: "model answer" });
    }
  const records: Inventory["records"] = [];
  for (const k of storage.list(projectKey(ctx, "analysis"))) {
    if (!k.endsWith(".json")) continue;
    const record = storage.getJson(k) as AnalysisRecord;
    records.push({ record, proof: proveRecord(storage, ctx, record) });
  }
  records.sort((a, b) => a.record.imageId.localeCompare(b.record.imageId));
  return { db, links, pixels, records, bytes };
}

/** Hashes every original and checks it equals its name. Returns the ones that do not. */
export function verifyOriginals(
  storage: Storage,
  links: readonly LinkOp[],
  side: "from" | "to",
  onProgress?: (done: number, total: number) => void,
): string[] {
  const originals = links.filter((l) => l.kind === "original");
  const bad: string[] = [];
  originals.forEach((l, i) => {
    const bytes = storage.getBytes(l[side]);
    const h = bytes ? createHash("sha256").update(bytes).digest("hex") : "missing";
    if (h !== l.sha256) bad.push(l[side]);
    if ((i + 1) % 200 === 0) onProgress?.(i + 1, originals.length);
  });
  return bad;
}

/** An analysis started by the old tool that is still running blocks the import (it holds no lock). */
export function runningAnalysis(
  storage: Storage,
  ctx: ProjectContext,
  now = Date.now(),
): string | null {
  const s = storage.getJson(projectKey(ctx, "pending", "analysis-status.json")) as
    | { running?: boolean; startedAt?: string; progress?: { message?: string } }
    | undefined;
  if (!s?.running || !s.startedAt) return null;
  if (now - Date.parse(s.startedAt) > 6 * 3600_000) return null; // left over from a crash
  return s.progress?.message ?? "an analysis is running";
}
