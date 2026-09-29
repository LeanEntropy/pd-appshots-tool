import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import { readSettings } from "../config/project.ts";
import { readRegistry } from "../config/registry.ts";
import type { Storage } from "../storage/index.ts";
import { fileSize, openShareWrite, SHARE_PREFIX } from "../storage/share-files.ts";
import { sha256 } from "../util/hash.ts";
import { type Collected, collectProject, filesFor } from "./collect.ts";
import {
  type FileEntry,
  FORMAT,
  FORMAT_VERSION,
  isPicture,
  MANIFEST,
  type Manifest,
  ManifestSchema,
  type ShareKind,
} from "./format.ts";
import { exportBytes, scrubContext } from "./scrub.ts";

export const exportKey = (exportId: string) => `${SHARE_PREFIX}/exports/${exportId}.zip`;

export interface ExportResult {
  exportId: string;
  fileName: string;
  bytes: number;
  files: number;
}

export interface ExportOptions {
  kind: ShareKind;
  /** The tool folder and the workspace folder (both hidden from the package). */
  toolRoot: string;
  workspace: string;
  toolVersion: string;
  progress?: (step: string, done: number, total: number) => void;
  /** Tests: a collected list to use instead of reading the project again. */
  collected?: Collected;
}

/**
 * Builds a package of one project (plan 12C): every file is read once, hashed and added to the
 * zip; the manifest (with each file's hash) is added last. The file is written under
 * shared/share/exports/ and gets its final name only when it is complete.
 */
export async function writePackage(
  storage: Storage,
  projectId: string,
  o: ExportOptions,
): Promise<ExportResult> {
  const settings = readSettings(storage, { projectId });
  if (!settings) throw new Error(`There is no project "${projectId}".`);
  o.progress?.("Counting files", 0, 0);
  const c = o.collected ?? (await collectProject(storage, projectId));
  const files = filesFor(c, o.kind);
  const others = readRegistry(storage)
    .projects.map((p) => p.id)
    .filter((id) => id !== projectId);
  const scrub = scrubContext(o.workspace, o.toolRoot, others);
  const exportId = randomBytes(10).toString("hex");
  const out = openShareWrite(storage, exportKey(exportId));
  const zip = new yazl.ZipFile();
  const index: FileEntry[] = [];
  const total = files.length;
  let done = 0;
  const mtime = new Date();
  for (const f of files) {
    zip.addReadStreamLazy(f.name, { mtime, compress: !isPicture(f.name) }, (cb) => {
      try {
        const raw = storage.getBytes(f.key);
        if (!raw) throw new Error(`A file disappeared while sharing: ${f.name}`);
        const bytes = exportBytes(f.name, raw, scrub);
        index.push({ path: f.name, sha256: sha256(bytes), bytes: bytes.length });
        done++;
        if (done % 25 === 0 || done === total)
          o.progress?.(isPicture(f.name) ? "Adding pictures" : "Adding project data", done, total);
        cb(null, Readable.from([bytes]));
      } catch (e) {
        cb(e, Readable.from([]));
      }
    });
  }
  const manifest = (): Manifest =>
    ManifestSchema.parse({
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      tool: { version: o.toolVersion },
      createdAt: new Date().toISOString(),
      packageId: exportId,
      kind: o.kind,
      project: { id: projectId, name: settings.name, ourAppId: settings.ourApp.id },
      counts: {
        images: c.images,
        fullSize: o.kind === "full" ? c.fullSize : 0,
        analyses: c.analyses,
        reports: c.reports.length,
        competitors: settings.competitors.length,
        countries: settings.markets.length,
      },
      reports: c.reports,
      files: index,
    });
  // Lazy: called only after every file above was added, so the index is complete.
  zip.addReadStreamLazy(MANIFEST, { mtime, compress: true }, (cb) => {
    try {
      cb(null, Readable.from([Buffer.from(JSON.stringify(manifest(), null, 1))]));
    } catch (e) {
      cb(e, Readable.from([]));
    }
  });
  // A file that cannot be read stops the export (the half-written file is removed).
  zip.on("error", (e: Error) => out.stream.destroy(e));
  zip.end();
  try {
    await pipeline(zip.outputStream as unknown as Readable, out.stream);
    out.commit();
  } catch (e) {
    out.abort();
    throw e;
  }
  const date = new Date().toISOString().slice(0, 10);
  const bytes = fileSize(storage, exportKey(exportId)) ?? 0;
  return { exportId, fileName: `${projectId}-${date}-${o.kind}.zip`, bytes, files: total };
}
