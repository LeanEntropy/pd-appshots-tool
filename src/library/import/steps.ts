import { IMAGE_FACTS_VERSION } from "../../analysis/image-facts.ts";
import { recordWriter } from "../../analysis/record-refresh.ts";
import { isUsable, readRecords } from "../../analysis/records.ts";
import type { LoadedConfig } from "../../config/load.ts";
import { projectPaths } from "../../config/load.ts";
import { linkOrCopy } from "../../storage/import-ops.ts";
import type { ProjectContext, Storage } from "../../storage/index.ts";
import { readGoogleId } from "../imagedb.ts";
import { LIB } from "../layout.ts";
import type { GoogleIdFile, LibraryFacts, Refs } from "../refs.ts";
import type { Journal } from "./journal.ts";
import { type Inventory, pause, verifyOriginals } from "./survey.ts";

export type Log = (s: string) => void;
/** Live progress for the page: a plain step name, with counts when the step has them. */
export type Progress = (step: string, done?: number, total?: number) => void;
export interface LinkCounts {
  linked: number;
  copied: number;
  existed: number;
}

/**
 * Write-ahead: the keys about to be created are journaled (and saved) before anything is
 * written, so a crash at any point leaves nothing the rollback does not know about.
 */
function intend(storage: Storage, j: Journal, save: () => void, keys: readonly string[]): void {
  const fresh = keys.filter((k) => !storage.exists(k) && !j.created.includes(k));
  if (!fresh.length) return;
  j.created.push(...fresh);
  save();
}

/** Step 1: hardlink (or copy) every file, then hash every library original against its name. */
export async function linkFiles(
  storage: Storage,
  inv: Inventory,
  j: Journal,
  save: () => void,
  log: Log,
  progress: Progress = () => {},
): Promise<LinkCounts> {
  const n: LinkCounts = { linked: 0, copied: 0, existed: 0 };
  const total = inv.links.length;
  for (let i = 0; i < total; i += 50) {
    const batch = inv.links.slice(i, i + 50);
    intend(
      storage,
      j,
      save,
      batch.map((l) => l.to),
    );
    for (const l of batch) {
      const r = linkOrCopy(storage, l.from, l.to);
      n[r === "exists" ? "existed" : r]++;
    }
    const done = Math.min(i + 50, total);
    if (done % 250 === 0 || done === total) log(`  ${done} of ${total} files linked`);
    progress("Linking images and saved answers into the shared library", done, total);
    await pause();
  }
  log("Checking every original against its content hash…");
  const bad = await verifyOriginals(storage, inv.links, "to", (d, t) => {
    if (d % 400 === 0) log(`  ${d} of ${t} checked`);
    progress("Checking every image against its content hash", d, t);
  });
  if (bad.length)
    throw new Error(`${bad.length} library files do not match their content hash: ${bad[0]}`);
  return n;
}

/** Step 2: image facts, pixel facts and Google image ids (append-only) in the library. */
export function writeFacts(
  storage: Storage,
  inv: Inventory,
  j: Journal,
  save: () => void,
  now: string,
): void {
  const images = Object.values(inv.db.images);
  const googles = Object.entries(inv.db.googleIndex);
  intend(storage, j, save, [
    ...images.map((r) => LIB.facts(r.id)),
    ...inv.pixels.map((p) => LIB.pixels(p.sha, p.version)),
    ...googles.map(([g]) => LIB.google(g)),
  ]);
  for (const r of images) {
    const facts: LibraryFacts = {
      id: r.id,
      sha256: r.sha256,
      phash: r.phash,
      width: r.width,
      height: r.height,
      format: r.format,
      bytes: r.bytes,
      file: r.file,
      thumb: r.thumb,
      deviceClass: r.deviceClass,
      orientation: r.orientation,
      deviceConfidence: r.deviceConfidence,
      firstSeen: r.firstSeen,
    };
    storage.putJsonOnce(LIB.facts(r.id), facts);
  }
  for (const p of inv.pixels)
    storage.putJsonOnce(LIB.pixels(p.sha, p.version), storage.getJson(p.from));
  const appends: { key: string; sha256: string; file: GoogleIdFile }[] = [];
  for (const [googleId, sha] of googles) {
    const k = LIB.google(googleId);
    const cur = readGoogleId(storage, googleId);
    const entry = { sha256: sha, firstSeen: inv.db.images[sha]?.firstSeen ?? now };
    if (!cur) storage.putJson(k, { version: 1, googleId, entries: [entry] });
    else if (cur.entries.at(-1)?.sha256 !== sha)
      appends.push({ key: k, sha256: sha, file: { ...cur, entries: [...cur.entries, entry] } });
  }
  if (!appends.length) return;
  j.appended.push(...appends.map((a) => ({ key: a.key, sha256: a.sha256 })));
  save();
  for (const a of appends) storage.putJson(a.key, a.file);
}
/** Step 3: the project's references, staged (the project switches only after the gate). */
export function stageRefs(
  storage: Storage,
  ctx: ProjectContext,
  inv: Inventory,
  key: string,
): void {
  const refs: Refs = { version: 1, projectId: ctx.projectId, images: {} };
  for (const r of Object.values(inv.db.images))
    refs.images[r.id] = { sources: r.sources, googleIds: r.googleIds };
  storage.putJson(key, refs);
}

/** Step 4: analysis records under their analysis key (proven) or as this project's own. */
export function writeRecords(
  storage: Storage,
  ctx: ProjectContext,
  inv: Inventory,
  j: Journal,
  save: () => void,
) {
  intend(
    storage,
    j,
    save,
    inv.records.map((x) => LIB.record(x.record.imageId, x.proof.key)),
  );
  for (const { record: r, proof } of inv.records) {
    const k = LIB.record(r.imageId, proof.key);
    // Another project's record is never overwritten (the gate then shows any difference).
    if (!j.created.includes(k)) {
      j.notes.push(`kept the library's existing record for ${r.imageId} (${proof.key})`);
      continue;
    }
    storage.putJson(k, {
      ...r,
      key: proof.key,
      provenance: proof.provenance,
      ...(proof.pipeline ? { pipeline: proof.pipeline } : {}),
      writtenBy: ctx.projectId,
      paidBy: isUsable(r)
        ? { projectId: ctx.projectId, runId: r.runId, usd: null, at: r.updatedAt }
        : null,
    });
  }
}

/** Step 5: identity blocks rewritten to library paths (no AI call; updatedAt unchanged). */
export async function refreshIdentities(
  storage: Storage,
  staged: LoadedConfig,
  j: Journal,
  save: () => void,
  progress: Progress = () => {},
): Promise<void> {
  const write = recordWriter(staged);
  const all = [...readRecords(projectPaths(staged)).values()];
  for (const [i, r] of all.entries()) {
    progress("Updating the analysis records", i + 1, all.length);
    // Only records this import wrote, and only existing identity blocks, are rewritten.
    if (!r.identity || !r.key || !j.created.includes(LIB.record(r.imageId, r.key))) continue;
    intend(storage, j, save, [LIB.pixels(r.imageId, IMAGE_FACTS_VERSION)]);
    await write(r);
    if (i % 10 === 0) await pause();
  }
}
