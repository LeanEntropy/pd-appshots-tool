import { readSettings } from "../config/project.ts";
import { ProjectSettingsSchema } from "../config/project-schema.ts";
import { RefsSchema } from "../library/refs.ts";
import type { Storage } from "../storage/index.ts";
import { fileSize, freeDiskBytes, SHARE_PREFIX } from "../storage/share-files.ts";
import {
  entryKey,
  FORMAT,
  FORMAT_VERSION,
  LIMITS,
  MANIFEST,
  type Manifest,
  ManifestSchema,
  sizeText,
} from "./format.ts";
import { openPackage, PackageError, readEntry, type ZipIndex } from "./read-zip.ts";

export const uploadKey = (uploadId: string) => `${SHARE_PREFIX}/incoming/${uploadId}.zip`;
export const UPLOAD_ID = /^[0-9a-f]{20}$/;

/** What the page shows before the user presses Import (plan 12C, C1 step 3). */
export interface Inspection {
  uploadId: string;
  kind: Manifest["kind"];
  createdAt: string;
  toolVersion: string;
  project: Manifest["project"];
  counts: Manifest["counts"];
  reports: string[];
  /** Size of the file, and of what it holds once unpacked. */
  fileBytes: number;
  dataBytes: number;
  /** Library files not on this computer yet (the rest are reused). */
  newFiles: number;
  newBytes: number;
  files: number;
  /** A project with the same id exists here: its name, and the id a copy would get. */
  collision: { name: string; copyId: string } | null;
  sizeLine: string;
}

/**
 * Reads the manifest and the zip's directory and runs every check that needs no unpacking:
 * format and version, the entry list against the manifest (no extra, missing or duplicate
 * entry), every name maps to an allowed place, the sizes, and the free disk space.
 */
export async function inspectPackage(
  storage: Storage,
  uploadId: string,
): Promise<{ ix: ZipIndex; manifest: Manifest; inspection: Inspection }> {
  if (!UPLOAD_ID.test(uploadId)) throw new PackageError("This upload is not known.");
  const k = uploadKey(uploadId);
  const fileBytes = fileSize(storage, k);
  if (fileBytes === undefined)
    throw new PackageError("The uploaded file is no longer here. Choose it again.");
  const ix = await openPackage(storage.localPath(k));
  try {
    const me = ix.entries.get(MANIFEST);
    if (!me)
      throw new PackageError(
        "This zip is not a shared project from this tool (it has no manifest.json).",
      );
    let raw: unknown;
    try {
      raw = JSON.parse((await readEntry(ix, me)).bytes.toString("utf8"));
    } catch (e) {
      if (e instanceof PackageError) throw e;
      throw new PackageError("The file's manifest.json is damaged.");
    }
    const head = raw as { format?: unknown; formatVersion?: unknown };
    if (head?.format !== FORMAT)
      throw new PackageError("This zip is not a shared project from this tool.");
    if (typeof head.formatVersion === "number" && head.formatVersion > FORMAT_VERSION)
      throw new PackageError(
        "This project was shared from a newer version of the tool. Update the tool (git pull, then npm install) and try again.",
      );
    const parsed = ManifestSchema.safeParse(raw);
    if (!parsed.success) throw new PackageError("The file's manifest.json has problems.");
    const manifest = parsed.data;

    const listed = new Map(manifest.files.map((f) => [f.path, f]));
    if (listed.size !== manifest.files.length)
      throw new PackageError("The file's manifest lists a file twice.");
    if (!listed.has("project/project.json") || !listed.has("project/refs.json"))
      throw new PackageError("The file does not contain a complete project.");
    let dataBytes = 0;
    let newFiles = 0;
    let newBytes = 0;
    let projectBytes = 0;
    for (const [name, e] of ix.entries) {
      if (name === MANIFEST) continue;
      const f = listed.get(name);
      if (!f)
        throw new PackageError(`The file contains "${name}", which its manifest does not list.`);
      if (e.uncompressedSize !== f.bytes)
        throw new PackageError(`"${name}" does not have the size its manifest says.`);
      const target = entryKey(name, manifest.project.id);
      if (!target)
        throw new PackageError(`"${name}" is not something a shared project may contain.`);
      dataBytes += f.bytes;
      if (target.area === "project") projectBytes += f.bytes;
      else if (!storage.exists(target.key)) {
        newFiles++;
        newBytes += f.bytes;
      }
    }
    for (const name of listed.keys())
      if (!ix.entries.has(name)) throw new PackageError(`The file is missing "${name}".`);
    if (dataBytes > LIMITS.uploadBytes)
      throw new PackageError("The project in this file is too large.");
    const needed = newBytes + projectBytes + LIMITS.reserveBytes;
    if (needed > freeDiskBytes(storage))
      throw new PackageError(
        `There is not enough free disk space: importing needs about ${sizeText(needed)} free.`,
      );

    // What the summary shows comes from the project's own files, not only from the manifest.
    const json = async (name: string) => {
      const e = ix.entries.get(name);
      if (!e) throw new PackageError("The file does not contain a complete project.");
      try {
        return JSON.parse((await readEntry(ix, e)).bytes.toString("utf8"));
      } catch (err) {
        if (err instanceof PackageError) throw err;
        throw new PackageError(`"${name}" is damaged.`);
      }
    };
    const settings = ProjectSettingsSchema.safeParse(await json("project/project.json"));
    const refs = RefsSchema.safeParse(await json("project/refs.json"));
    if (!settings.success || !refs.success)
      throw new PackageError("The project's settings or picture list in this file have problems.");
    const s = settings.data;
    if (
      s.id !== manifest.project.id ||
      s.name !== manifest.project.name ||
      s.ourApp.id !== manifest.project.ourAppId
    )
      throw new PackageError("The file's manifest does not match the project inside it.");
    const origs = [...listed.keys()].filter((n) => n.startsWith("library/images/orig/")).length;
    if ((manifest.kind === "light") !== (origs === 0))
      throw new PackageError("The file's manifest does not match the pictures inside it.");
    const defs = [...listed.keys()].filter((n) => /^project\/reports\/defs\/[^/]+\.json$/.test(n));
    manifest.counts = {
      ...manifest.counts,
      images: Object.keys(refs.data.images).length,
      fullSize: origs,
      reports: defs.length,
      competitors: s.competitors.length,
      countries: s.markets.length,
    };
    if (manifest.reports.length !== defs.length) manifest.reports = [];

    const existing = readSettings(storage, { projectId: manifest.project.id });
    const taken = new Set(storage.listProjectIds());
    let copyId = manifest.project.id;
    for (let n = 2; taken.has(copyId); n++) copyId = `${manifest.project.id.slice(0, 55)}-${n}`;
    const collision = taken.has(manifest.project.id)
      ? { name: existing?.name ?? manifest.project.id, copyId }
      : null;
    const kindLine =
      manifest.kind === "light"
        ? "Light: small previews of every picture, no full-size pictures"
        : "Full: every picture at full size";
    return {
      ix,
      manifest,
      inspection: {
        uploadId,
        kind: manifest.kind,
        createdAt: manifest.createdAt,
        toolVersion: manifest.tool.version,
        project: manifest.project,
        counts: manifest.counts,
        reports: manifest.reports,
        fileBytes,
        dataBytes,
        newFiles,
        newBytes,
        files: manifest.files.length,
        collision,
        sizeLine: `${kindLine}. File ${sizeText(fileBytes)}; adds about ${sizeText(newBytes + projectBytes)} to your disk.`,
      },
    };
  } catch (e) {
    ix.close();
    throw e;
  }
}
