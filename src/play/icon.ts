import sharp from "sharp";
import { type ProjectContext, projectKey, type Storage } from "../storage/index.ts";
import { appSegment } from "./lookup.ts";

const MAX_BYTES = 1024 * 1024;
const HOSTS = /(^|\.)(googleusercontent\.com|ggpht\.com)$/i;

/** Only https icons on Google's image hosts are fetched (plan 3.2). */
export function iconUrlAllowed(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Reads a response body, refusing more than MAX_BYTES. */
async function capped(res: Response): Promise<Buffer | null> {
  if (!res.body) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * Downloads a store icon once into the project's icons/ folder as a 128 px PNG and returns its
 * file name, or null on any failure (the page then shows a letter). No redirects are followed,
 * 10 s timeout, image content type only, 1 MB cap, 4 megapixel decode limit.
 */
export async function fetchIcon(
  storage: Storage,
  ctx: ProjectContext,
  appId: string,
  url: string,
  fetcher: Fetcher = fetch,
): Promise<string | null> {
  const file = `${appSegment(appId)}.png`;
  const k = projectKey(ctx, "icons", file);
  if (storage.exists(k)) return file;
  if (!iconUrlAllowed(url)) return null;
  try {
    const res = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (res.status !== 200) return null;
    if (!(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    const bytes = await capped(res);
    if (!bytes) return null;
    const png = await sharp(bytes, { limitInputPixels: 4_000_000 })
      .resize(128, 128, { fit: "cover" })
      .png()
      .toBuffer();
    storage.putBlob(k, png);
    return file;
  } catch {
    return null;
  }
}
