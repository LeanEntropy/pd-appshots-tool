/**
 * Pure helpers for Google Play screenshot URLs and decks (no network).
 * Findings from the feasibility spike:
 * - the scraper's screenshot array often repeats every image (e.g. 21 entries = 7 images x 3);
 *   dedupe by the base URL (everything before "=") and keep the first occurrence, which is
 *   the store order;
 * - appending "=s0" to the base URL returns the full native resolution.
 */

export function baseUrl(url: string): string {
  const i = url.indexOf("=");
  return i === -1 ? url : url.slice(0, i);
}

export function fullResUrl(url: string): string {
  return `${baseUrl(url)}=s0`;
}

export function thumbUrl(url: string, width = 240): string {
  return `${baseUrl(url)}=w${width}`;
}

/** Google's image id: the last path segment of the base URL. Identical ids = identical image. */
export function googleImageId(url: string): string {
  const base = baseUrl(url);
  return base.slice(base.lastIndexOf("/") + 1);
}

/** Removes repeated entries while keeping store order. */
export function dedupScreenshots(urls: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const b = baseUrl(u);
    if (seen.has(b)) continue;
    seen.add(b);
    out.push(b);
  }
  return out;
}

export type DeviceClass = "phone" | "tablet" | "unknown";

export interface DeviceGuess {
  deviceClass: DeviceClass;
  orientation: "portrait" | "landscape" | "square";
  confidence: number;
}

/**
 * Guess by aspect ratio. Phones are about 16:9 or longer (1.7+), tablets about 4:3 to 16:10
 * (1.25-1.6). Anything in between is "unknown". Every screenshot is kept either way.
 */
export function guessDeviceClass(width: number, height: number): DeviceGuess {
  if (width <= 0 || height <= 0)
    return { deviceClass: "unknown", orientation: "square", confidence: 0 };
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const ratio = long / short;
  const orientation = ratio < 1.05 ? "square" : height > width ? "portrait" : "landscape";
  if (ratio >= 1.7)
    return { deviceClass: "phone", orientation, confidence: ratio >= 1.75 ? 0.9 : 0.7 };
  if (ratio >= 1.25 && ratio <= 1.6) return { deviceClass: "tablet", orientation, confidence: 0.7 };
  return { deviceClass: "unknown", orientation, confidence: 0.3 };
}

/** Median of deck lengths (rounded down for even counts to stay conservative). */
export function medianLength(lengths: readonly number[]): number {
  if (lengths.length === 0) return 0;
  const s = [...lengths].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : Math.floor(((s[mid - 1] as number) + (s[mid] as number)) / 2);
}
