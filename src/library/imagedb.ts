import { join } from "node:path";
import sharp from "sharp";
import { guessDeviceClass } from "../play/screenshots.ts";
import { type Storage, workspaceStorage } from "../storage/index.ts";
import { describeImage } from "../store/identity.ts";
import { EXT, type ImageDb, type ImageRecord, type ImageSource } from "../store/imagedb.ts";
import { LIB } from "./layout.ts";
import {
  type GoogleIdFile,
  GoogleIdSchema,
  type LibraryFacts,
  LibraryFactsSchema,
  type Refs,
  readRefs,
} from "./refs.ts";
import { forgetRefs } from "./serve.ts";

/** Library fact files never change once written, so they are cached for the whole process. */
const factsCache = new Map<string, LibraryFacts>();

export function readFacts(storage: Storage, sha: string): LibraryFacts | undefined {
  const k = `${storage.localPath(LIB.facts(sha))}`;
  const hit = factsCache.get(k);
  if (hit) return hit;
  const raw = storage.getJson(LIB.facts(sha));
  if (raw === undefined) return undefined;
  const f = LibraryFactsSchema.parse(raw);
  factsCache.set(k, f);
  return f;
}

export function readGoogleId(storage: Storage, googleId: string): GoogleIdFile | undefined {
  const raw = storage.getJson(LIB.google(googleId));
  return raw === undefined ? undefined : GoogleIdSchema.parse(raw);
}

/** Facade over the shared library and one project's refs, with the old ImageDb methods. */
export class LibraryImageDb implements ImageDb {
  private readonly googleIndex = new Map<string, string>();
  private readonly pendingGoogle = new Map<string, GoogleIdFile>();

  private constructor(
    private readonly storage: Storage,
    private readonly refsKey: string,
    private readonly refs: Refs,
  ) {
    for (const [sha, r] of Object.entries(refs.images))
      for (const g of r.googleIds) this.googleIndex.set(g, sha);
  }

  static open(workspace: string, refsKey: string, projectId: string): LibraryImageDb {
    const storage = workspaceStorage(workspace);
    return new LibraryImageDb(storage, refsKey, readRefs(storage, refsKey, projectId));
  }

  get size(): number {
    return Object.keys(this.refs.images).length;
  }

  all(): ImageRecord[] {
    return Object.keys(this.refs.images)
      .map((id) => this.get(id))
      .filter((r): r is ImageRecord => !!r);
  }

  get(id: string): ImageRecord | undefined {
    const ref = this.refs.images[id];
    const f = ref && readFacts(this.storage, id);
    return f ? { ...f, googleIds: [...ref.googleIds], sources: [...ref.sources] } : undefined;
  }

  /** Also finds images another project fetched under this id (reused, not downloaded again). */
  byGoogleId(googleId: string): ImageRecord | undefined {
    const own = this.googleIndex.get(googleId);
    if (own) return this.get(own);
    const known = this.pendingGoogle.get(googleId) ?? readGoogleId(this.storage, googleId);
    const sha = known?.entries.at(-1)?.sha256;
    const f = sha ? readFacts(this.storage, sha) : undefined;
    return f ? { ...f, googleIds: [googleId], sources: [] } : undefined;
  }

  /** Starts using a library image in this project. */
  private adopt(id: string) {
    let ref = this.refs.images[id];
    if (!ref) {
      if (!readFacts(this.storage, id)) throw new Error(`Unknown image ${id}`);
      ref = { sources: [], googleIds: [] };
      this.refs.images[id] = ref;
    }
    return ref;
  }

  async ingest(
    buf: Buffer,
    source?: ImageSource,
    googleId?: string,
  ): Promise<{ record: ImageRecord; isNew: boolean }> {
    const facts = await describeImage(buf);
    const id = facts.sha256;
    const isNew = !this.refs.images[id];
    if (!readFacts(this.storage, id)) {
      const file = `orig/${id}.${EXT[facts.format] ?? "bin"}`;
      const thumb = `thumb/${id}.webp`;
      this.storage.putBlob(LIB.imageFile(file), buf, id);
      const t = await sharp(buf).resize({ width: 240 }).webp({ quality: 80 }).toBuffer();
      this.storage.putBlob(LIB.imageFile(thumb), t);
      const guess = guessDeviceClass(facts.width, facts.height);
      // Facts last: an image counts as stored only when its files are in place.
      this.storage.putJsonOnce(LIB.facts(id), {
        ...facts,
        id,
        file,
        thumb,
        deviceClass: guess.deviceClass,
        orientation: guess.orientation,
        deviceConfidence: guess.confidence,
        firstSeen: new Date().toISOString(),
      } satisfies LibraryFacts);
    }
    this.adopt(id);
    if (googleId) this.linkGoogleId(id, googleId);
    if (source) this.addSource(id, source);
    return { record: this.get(id) as ImageRecord, isNew };
  }

  linkGoogleId(id: string, googleId: string): void {
    const ref = this.adopt(id);
    if (!ref.googleIds.includes(googleId)) ref.googleIds.push(googleId);
    this.googleIndex.set(googleId, id);
    const file = this.pendingGoogle.get(googleId) ??
      readGoogleId(this.storage, googleId) ?? { version: 1, googleId, entries: [] };
    // Append-only: if the store replaced the picture, the new hash is added, never overwritten.
    if (file.entries.at(-1)?.sha256 !== id) {
      file.entries.push({ sha256: id, firstSeen: new Date().toISOString() });
      this.pendingGoogle.set(googleId, file);
    }
  }

  addSource(id: string, s: ImageSource): void {
    const ref = this.adopt(id);
    const dup = ref.sources.some(
      (x) => x.appId === s.appId && x.gl === s.gl && x.hl === s.hl && x.position === s.position,
    );
    if (!dup) ref.sources.push(s);
  }

  save(): void {
    for (const [g, f] of this.pendingGoogle) this.storage.putJson(LIB.google(g), f);
    this.pendingGoogle.clear();
    this.storage.putJson(this.refsKey, this.refs);
    forgetRefs(this.storage.localPath(this.refsKey));
  }

  abs(relPath: string): string {
    return join(this.storage.localPath(LIB.images), relPath);
  }
}
