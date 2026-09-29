import type { ImageDb, ImageRecord, ImageSource } from "../store/imagedb.ts";

/**
 * The images of the App Store view of a project: its App Store images (refs-appstore.json)
 * first, then its Google Play images (refs.json), so a report on the App Store can reach the
 * Play pictures that anchor a text comparison. Both are views of the one shared library, so an
 * image is the same record through either. Writes go to the App Store refs.
 */
export class BothStoresImageDb implements ImageDb {
  constructor(
    private readonly apple: ImageDb,
    private readonly play: ImageDb,
  ) {}

  get size(): number {
    return this.all().length;
  }

  all(): ImageRecord[] {
    const seen = new Set<string>();
    const out: ImageRecord[] = [];
    for (const r of [...this.apple.all(), ...this.play.all()])
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
      }
    return out;
  }

  get(id: string): ImageRecord | undefined {
    const a = this.apple.get(id);
    const p = this.play.get(id);
    if (!a || !p) return a ?? p;
    return { ...a, sources: [...a.sources, ...p.sources] };
  }

  byGoogleId(googleId: string): ImageRecord | undefined {
    return this.play.byGoogleId(googleId);
  }

  ingest(buf: Buffer, source?: ImageSource, googleId?: string) {
    return this.apple.ingest(buf, source, googleId);
  }

  linkGoogleId(id: string, googleId: string): void {
    this.play.linkGoogleId(id, googleId);
  }

  addSource(id: string, s: ImageSource): void {
    this.apple.addSource(id, s);
  }

  save(): void {
    this.apple.save();
  }

  abs(relPath: string): string {
    return this.apple.abs(relPath);
  }
}
