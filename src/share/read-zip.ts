import { createHash } from "node:crypto";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { isPicture, LIMITS, MANIFEST } from "./format.ts";

/**
 * Reading a package (plan 12C, C3 and C7) with yauzl: the central directory is read first (no
 * byte is decompressed before the names, sizes and methods are checked), then entries one at a
 * time with their sizes enforced while streaming. Nothing here writes anything.
 */
export class PackageError extends Error {}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

export interface ZipIndex {
  zip: ZipFile;
  entries: Map<string, Entry>;
  close: () => void;
}

function listEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const out: Entry[] = [];
    zip.on("entry", (e: Entry) => {
      out.push(e);
      if (out.length > LIMITS.entries) reject(new PackageError("The file has too many entries."));
      else zip.readEntry();
    });
    zip.once("end", () => resolve(out));
    zip.once("error", reject);
    zip.readEntry();
  });
}

/** Opens the zip and checks every entry's header: name, method, encryption, type and size. */
export async function openPackage(path: string): Promise<ZipIndex> {
  let zip: ZipFile;
  try {
    zip = await yauzl.openPromise(path, {
      lazyEntries: true,
      autoClose: false,
      validateEntrySizes: true,
      strictFileNames: true,
      decodeStrings: true,
    });
  } catch {
    throw new PackageError("This file is not a readable zip file.");
  }
  const entries = new Map<string, Entry>();
  const fail = (m: string) => {
    zip.close();
    return new PackageError(m);
  };
  try {
    for (const e of await listEntries(zip)) {
      const name = e.fileName;
      if (name.endsWith("/")) continue; // directory entries carry no data
      if (entries.size >= LIMITS.entries) throw fail("The file has too many entries.");
      if (entries.has(name)) throw fail(`The file lists "${name}" twice.`);
      if (e.isEncrypted()) throw fail("The file is password-protected; the tool cannot read it.");
      if (e.compressionMethod !== 0 && e.compressionMethod !== 8)
        throw fail(`"${name}" uses a compression the tool does not read.`);
      if (((e.externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK)
        throw fail(`"${name}" is a link, which a shared project never contains.`);
      const cap =
        name === MANIFEST
          ? LIMITS.manifestBytes
          : isPicture(name)
            ? LIMITS.imageBytes
            : LIMITS.jsonBytes;
      if (e.uncompressedSize > cap) throw fail(`"${name}" is larger than the tool accepts.`);
      if (
        e.compressionMethod === 8 &&
        e.uncompressedSize > 1024 * 1024 &&
        e.uncompressedSize > e.compressedSize * LIMITS.ratio
      )
        throw fail(`"${name}" expands too much to be safe to open.`);
      entries.set(name, e);
    }
  } catch (e) {
    if (e instanceof PackageError) throw e;
    zip.close();
    throw new PackageError(
      `The file is damaged or not a shared project (${e instanceof Error ? e.message : String(e)}).`,
    );
  }
  return { zip, entries, close: () => zip.close() };
}

/** One entry's bytes (at most its declared size) and their SHA-256. */
export async function readEntry(
  ix: ZipIndex,
  e: Entry,
): Promise<{ bytes: Buffer; sha256: string }> {
  // The local header must agree with the central directory (name and method).
  const h = await ix.zip.readLocalFileHeaderPromise(e);
  if (h.fileName.toString("utf8") !== e.fileName || h.compressionMethod !== e.compressionMethod)
    throw new PackageError(`"${e.fileName}" is recorded two different ways in the file.`);
  const stream = await ix.zip.openReadStreamPromise(e);
  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of stream) {
    const b = c as Buffer;
    size += b.length;
    if (size > e.uncompressedSize) {
      stream.destroy();
      throw new PackageError(`"${e.fileName}" is larger than it says.`);
    }
    hash.update(b);
    chunks.push(b);
  }
  return { bytes: Buffer.concat(chunks, size), sha256: hash.digest("hex") };
}
