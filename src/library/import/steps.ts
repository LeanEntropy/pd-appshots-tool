import { IMAGE_FACTS_VERSION } from "../../analysis/image-facts.ts";
import { recordWriter } from "../../analysis/record-refresh.ts";
import { isUsable, readRecords } from "../../analysis/records.ts";
import type { LoadedConfig } from "../../config/load.ts";
import { projectPaths } from "../../config/load.ts";
import { linkOrCopy } from "../../storage/import-ops.ts";
import type { ProjectContext, Storage } from "../../storage/index.ts";
import { readGoogleId } from "../imagedb.ts";
import { LIB } from "../layout.ts";
import type { LibraryFacts, Refs } from "../refs.ts";
import type { Journal } from "./journal.ts";
import { type Inventory, verifyOriginals } from "./survey.ts";

export type Log = (s: string) => void;
export interface LinkCounts {
  linked: number;
  copied: number;
  existed: number;
}

/** Step 1: hardlink (or copy) every file, then hash every library original against its name. */
export function linkFiles(
  storage: Storage,
  inv: Inventory,
  j: Journal,
  save: () => void,
  log: Log,
): LinkCounts {
  const n: LinkCounts = { linked: 0, copied: 0, existed: 0 };
  inv.links.forEach((l, i) => {
    const r = linkOrCopy(storage, l.from, l.to);
    if (r === "exists") n.existed++;
    else {
      j.created.push(l.to);
      n[r]++;
    }
    if ((i + 1) % 500 === 0) {
      save();
      log(`  ${i + 1} of ${inv.links.length} files linked`);
    }
  });
  save();
  log("Checking every original against its content hash…");
  const bad = verifyOriginals(storage, inv.links, "to", (d, t) =>
    d % 400 === 0 ? log(`  ${d} of ${t} checked`) : undefined,
  );
  if (bad.length)
    throw new Error(`${bad.length} library files do not match their content hash: ${bad[0]}`);
  return n;
}

/** Step 2: image facts, pixel facts and Google image ids (append-only) in the library. */
export function writeFacts(storage: Storage, inv: Inventory, j: Journal, now: string): void {
  for (const r of Object.values(inv.db.images)) {
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
    if (storage.putJsonOnce(LIB.facts(r.id), facts)) j.created.push(LIB.facts(r.id));
  }
  for (const p of inv.pixels) {
    const k = LIB.pixels(p.sha, p.version);
    if (storage.putJsonOnce(k, storage.getJson(p.from))) j.created.push(k);
  }
  for (const [googleId, sha] of Object.entries(inv.db.googleIndex)) {
    const k = LIB.google(googleId);
    const cur = readGoogleId(storage, googleId);
    const entry = { sha256: sha, firstSeen: inv.db.images[sha]?.firstSeen ?? now };
    if (!cur) {
      storage.putJson(k, { version: 1, googleId, entries: [entry] });
      j.created.push(k);
    } else if (cur.entries.at(-1)?.sha256 !== sha) {
      j.modified.push({ key: k, before: cur });
      storage.putJson(k, { ...cur, entries: [...cur.entries, entry] });
    }
  }
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
export function writeRecords(storage: Storage, ctx: ProjectContext, inv: Inventory, j: Journal) {
  for (const { record: r, proof } of inv.records) {
    const k = LIB.record(r.imageId, proof.key);
    if (storage.exists(k) && !j.created.includes(k)) {
      j.notes.push(`kept the library's existing record for ${r.imageId} (${proof.key})`);
      continue;
    }
    if (!storage.exists(k)) j.created.push(k);
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
): Promise<void> {
  const write = recordWriter(staged);
  for (const r of readRecords(projectPaths(staged)).values()) {
    // Only existing identity blocks are rewritten; a record without one stays as it was.
    if (!r.identity) continue;
    const px = LIB.pixels(r.imageId, IMAGE_FACTS_VERSION);
    const had = storage.exists(px);
    await write(r);
    if (!had && storage.exists(px)) j.created.push(px);
  }
}
