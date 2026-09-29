import { readFacts } from "../library/imagedb.ts";
import { LIB, refsKey } from "../library/layout.ts";
import { readRefs } from "../library/refs.ts";
import type { Storage } from "../storage/index.ts";
import { sha256 } from "../util/hash.ts";

/**
 * Pictures that came in a Light package have no full-size original, only a small preview
 * (plan 12C, C6). Pages show the preview; anything that analyses a picture needs the original
 * first, fetched again from Google Play for free.
 */
export function previewOnly(
  storage: Storage,
  projectId: string,
  ids?: readonly string[],
): string[] {
  const k = refsKey({ projectId });
  if (!storage.exists(k)) return [];
  const refs = readRefs(storage, k, projectId);
  const out: string[] = [];
  for (const id of ids ?? Object.keys(refs.images)) {
    if (!refs.images[id]) continue;
    const f = readFacts(storage, id);
    if (f && !storage.exists(LIB.imageFile(f.file))) out.push(id);
  }
  return [...new Set(out)];
}

/** The plain message shown instead of starting paid work on preview-only pictures, or null. */
export function originalsProblem(
  storage: Storage,
  projectId: string,
  items: readonly { imageId: string }[],
): string | null {
  const n = previewOnly(
    storage,
    projectId,
    items.map((i) => i.imageId),
  ).length;
  if (!n) return null;
  return `${n === 1 ? "1 picture" : `${n} pictures`} in this batch ${n === 1 ? "was" : "were"} shared as a small preview only (a Light copy of the project), and ${n === 1 ? "it needs its" : "they need their"} full-size picture before ${n === 1 ? "it is" : "they are"} analysed. Nothing was started or paid. Download the full-size pictures first (free, from Google Play): Overview page, "Download full-size pictures".`;
}

export interface FetchOutcome {
  recovered: number;
  changed: number;
  gone: number;
  failed: number;
  total: number;
}

export type Fetch = (url: string) => Promise<{ status: number; bytes: Buffer | null }>;

export const playFetch: Fetch = async (url) => {
  const r = await fetch(url);
  return { status: r.status, bytes: r.ok ? Buffer.from(await r.arrayBuffer()) : null };
};

/**
 * Downloads the full-size picture of every preview-only image again, by its Google image id.
 * The same bytes fill in the original; different bytes (the game changed that picture on
 * Google Play since it was shared) are not used, so the project keeps what it was analysed with.
 */
export async function fetchOriginals(
  storage: Storage,
  projectId: string,
  o: { fetch?: Fetch; progress?: (done: number, total: number) => void; delayMs?: number } = {},
): Promise<FetchOutcome> {
  const ids = previewOnly(storage, projectId);
  const refs = readRefs(storage, refsKey({ projectId }), projectId);
  const out: FetchOutcome = { recovered: 0, changed: 0, gone: 0, failed: 0, total: ids.length };
  const get = o.fetch ?? playFetch;
  let done = 0;
  for (const id of ids) {
    const facts = readFacts(storage, id);
    let result: keyof Omit<FetchOutcome, "total"> = "gone";
    for (const gid of refs.images[id]?.googleIds ?? []) {
      if (!/^[A-Za-z0-9._-]{1,200}$/.test(gid)) continue;
      try {
        const r = await get(`https://play-lh.googleusercontent.com/${gid}=s0`);
        if (!r.bytes) {
          if (r.status !== 404 && r.status !== 410) result = "failed";
          continue;
        }
        if (facts && sha256(r.bytes) === id) {
          storage.putBlob(LIB.imageFile(facts.file), r.bytes, id);
          result = "recovered";
          break;
        }
        result = "changed";
      } catch {
        result = "failed";
      }
    }
    out[result]++;
    o.progress?.(++done, ids.length);
    if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
  }
  return out;
}
