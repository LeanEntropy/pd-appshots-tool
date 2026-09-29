import { LibraryImageDb, readFacts } from "../library/imagedb.ts";
import { LIB } from "../library/layout.ts";
import { latestDecks } from "../library/project-decks.ts";
import type { LibraryFacts } from "../library/refs.ts";
import type { ProjectContext, Storage } from "../storage/index.ts";
import type { ImageSource } from "../store/imagedb.ts";
import { sha256 } from "../util/hash.ts";
import { appleAliasKey, assetPath, fullSizeUrl } from "./assets.ts";
import {
  type AppleAlias,
  AppleAliasSchema,
  appleRefsKey,
  type SamePicture,
  SamePictureSchema,
  samePictureKey,
} from "./data.ts";
import { comparePictures, rawOf, twinCandidates } from "./dedup.ts";

export interface IngestResult {
  sha: string;
  facts: LibraryFacts;
  reuse: "same-file" | "same-picture" | "new";
  sameAs?: string;
  /** Bytes downloaded for this image (0 when the asset path was known). */
  downloaded: number;
}

/**
 * App Store screenshots into the shared, content-addressed library (plan-app-store 3 and 4):
 * the same ingest() as Google Play images (original, thumbnail, facts with phash, size and
 * orientation), references in the project's refs-appstore.json, an append-only alias index per
 * Apple asset path (a known path is never downloaded again), and the free "same picture as a
 * Google Play image" check with its link saved for the cost planner. No AI.
 */
export class AppleImages {
  private readonly db: LibraryImageDb;
  private readonly aliases = new Map<string, AppleAlias>();
  private readonly playPool = new Map<string, LibraryFacts[]>();

  constructor(
    workspace: string,
    private readonly storage: Storage,
    private readonly ctx: ProjectContext,
    private readonly download: (url: string) => Promise<Buffer>,
    /** Throws when the project lock was lost; called right before every write. */
    private readonly check: () => void = () => {},
  ) {
    this.db = LibraryImageDb.open(workspace, appleRefsKey(ctx), ctx.projectId);
  }

  private alias(path: string): AppleAlias | undefined {
    const hit = this.aliases.get(path);
    if (hit) return hit;
    const raw = this.storage.getJson(appleAliasKey(path));
    const p = raw === undefined ? undefined : AppleAliasSchema.safeParse(raw);
    return p?.success ? p.data : undefined;
  }

  /** The same game's Google Play pictures (all countries), from the project's latest decks. */
  private playPictures(appId: string): LibraryFacts[] {
    let pool = this.playPool.get(appId);
    if (!pool) {
      const ids = new Set<string>();
      for (const d of latestDecks(this.storage, this.ctx.projectId))
        if (d.appId === appId) for (const s of d.slots) if (s.imageId) ids.add(s.imageId);
      pool = [...ids]
        .map((id) => readFacts(this.storage, id))
        .filter((f): f is LibraryFacts => !!f);
      this.playPool.set(appId, pool);
    }
    return pool;
  }

  private readTwin(sha: string): SamePicture | undefined {
    const raw = this.storage.getJson(samePictureKey(sha));
    const p = raw === undefined ? undefined : SamePictureSchema.safeParse(raw);
    return p?.success ? p.data : undefined;
  }

  /** Strict pixel check against the game's Play pictures; the link is saved once found. */
  private async twin(facts: LibraryFacts, appId: string): Promise<string | undefined> {
    const known = this.readTwin(facts.sha256);
    if (known) return known.sameAs;
    const file = (f: LibraryFacts) => this.storage.localPath(LIB.imageFile(f.file));
    const cands = twinCandidates({ ...facts, id: facts.sha256 }, this.playPictures(appId));
    if (!cands.length) return undefined;
    const mine = await rawOf(file(facts));
    for (const c of cands) {
      const r = comparePictures(mine, await rawOf(file(c)));
      if (!r.same) continue;
      this.check();
      this.storage.putJsonOnce(samePictureKey(facts.sha256), {
        version: 1,
        sameAs: c.sha256,
        method: "strict-pixels.v1",
        width: facts.width,
        height: facts.height,
        changedShare: r.changedShare,
        meanDiff: Math.round(r.meanDiff * 1000) / 1000,
        checkedAt: new Date().toISOString(),
      } satisfies SamePicture);
      return c.sha256;
    }
    return undefined;
  }

  async get(url: string, appId: string, source: ImageSource): Promise<IngestResult> {
    const path = assetPath(url);
    const known = this.alias(path)?.entries.at(-1)?.sha256;
    const knownFacts = known ? readFacts(this.storage, known) : undefined;
    let sha: string;
    let downloaded = 0;
    let before: boolean;
    if (knownFacts) {
      sha = knownFacts.sha256;
      before = true;
      this.db.addSource(sha, source);
    } else {
      const buf = await this.download(fullSizeUrl(url));
      downloaded = buf.length;
      sha = sha256(buf);
      before = !!readFacts(this.storage, sha);
      this.check();
      await this.db.ingest(buf, source);
      this.link(path, sha);
    }
    const facts = readFacts(this.storage, sha) as LibraryFacts;
    const sameAs = await this.twin(facts, appId);
    // Identical bytes first (another country's Apple deck, or any library image); then the twin.
    const reuse = before ? "same-file" : sameAs ? "same-picture" : "new";
    return { sha, facts, reuse, ...(sameAs ? { sameAs } : {}), downloaded };
  }

  private link(path: string, sha: string): void {
    const file = this.alias(path) ?? { version: 1 as const, assetPath: path, entries: [] };
    // Append-only: if Apple serves new bytes under an old path, the new hash is added.
    if (file.entries.at(-1)?.sha256 !== sha) {
      file.entries.push({ sha256: sha, firstSeen: new Date().toISOString() });
      this.check();
      this.storage.putJson(appleAliasKey(path), file);
    }
    this.aliases.set(path, file);
  }

  save(): void {
    this.check();
    this.db.save();
  }
}
