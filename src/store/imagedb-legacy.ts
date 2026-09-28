import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import sharp from "sharp";
import { guessDeviceClass } from "../play/screenshots.ts";
import { ensureDir, readJsonIfExists, writeJsonAtomic } from "../util/fsx.ts";
import { describeImage } from "./identity.ts";
import { EXT, type ImageDb, type ImageRecord, type ImageSource } from "./imagedb.ts";

/** The image database file of a project that has not moved to the shared library yet. */
export interface DbFile {
  version: 1;
  images: Record<string, ImageRecord>;
  /** Google image id -> image id, so a known Google image is never downloaded twice. */
  googleIndex: Record<string, string>;
}

/**
 * Per-project, content-addressed image database (one JSON index plus files named by hash).
 * Used until a project is imported into the shared library; kept on the fs allow-list.
 */
export class LegacyImageDb implements ImageDb {
  private constructor(
    private readonly path: string,
    private readonly origDir: string,
    private readonly thumbDir: string,
    private readonly data: DbFile,
  ) {}

  static open(path: string, origDir: string, thumbDir: string): LegacyImageDb {
    const data = (readJsonIfExists(path) as DbFile | undefined) ?? {
      version: 1,
      images: {},
      googleIndex: {},
    };
    ensureDir(origDir);
    ensureDir(thumbDir);
    return new LegacyImageDb(path, origDir, thumbDir, data);
  }

  /** Path relative to the folder holding db.json, with forward slashes. */
  private rel(p: string): string {
    return relative(dirname(this.path), p).split("\\").join("/");
  }

  /** Absolute path of a record's stored file or thumbnail. */
  abs(relPath: string): string {
    return join(dirname(this.path), relPath);
  }

  get size(): number {
    return Object.keys(this.data.images).length;
  }

  all(): ImageRecord[] {
    return Object.values(this.data.images);
  }

  get(id: string): ImageRecord | undefined {
    return this.data.images[id];
  }

  byGoogleId(googleId: string): ImageRecord | undefined {
    const id = this.data.googleIndex[googleId];
    return id ? this.data.images[id] : undefined;
  }

  /** Adds an image (or reuses the identical one already stored) and records where it was seen. */
  async ingest(
    buf: Buffer,
    source?: ImageSource,
    googleId?: string,
  ): Promise<{ record: ImageRecord; isNew: boolean }> {
    const facts = await describeImage(buf);
    let record = this.data.images[facts.sha256];
    const isNew = !record;
    if (!record) {
      const ext = EXT[facts.format] ?? "bin";
      const file = join(this.origDir, `${facts.sha256}.${ext}`);
      const thumb = join(this.thumbDir, `${facts.sha256}.webp`);
      if (!existsSync(file)) writeFileSync(file, buf);
      const guess = guessDeviceClass(facts.width, facts.height);
      record = {
        ...facts,
        id: facts.sha256,
        file: this.rel(file),
        thumb: this.rel(thumb),
        deviceClass: guess.deviceClass,
        orientation: guess.orientation,
        deviceConfidence: guess.confidence,
        googleIds: [],
        sources: [],
        firstSeen: new Date().toISOString(),
      };
      // Register before the next await, so a concurrent ingest of the same bytes reuses it.
      this.data.images[record.id] = record;
      if (!existsSync(thumb))
        await sharp(buf).resize({ width: 240 }).webp({ quality: 80 }).toFile(thumb);
    }
    if (googleId) this.linkGoogleId(record.id, googleId);
    if (source) this.addSource(record.id, source);
    return { record, isNew };
  }

  linkGoogleId(id: string, googleId: string): void {
    const rec = this.data.images[id];
    if (!rec) throw new Error(`Unknown image ${id}`);
    this.data.googleIndex[googleId] = id;
    if (!rec.googleIds.includes(googleId)) rec.googleIds.push(googleId);
  }

  addSource(id: string, s: ImageSource): void {
    const rec = this.data.images[id];
    if (!rec) throw new Error(`Unknown image ${id}`);
    const dup = rec.sources.some(
      (x) => x.appId === s.appId && x.gl === s.gl && x.hl === s.hl && x.position === s.position,
    );
    if (!dup) rec.sources.push(s);
  }

  save(): void {
    writeJsonAtomic(this.path, this.data);
  }
}
