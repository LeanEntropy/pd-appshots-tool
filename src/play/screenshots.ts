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

/** Shape class by the long:short ratio: phone-like (16:9 and longer), tablet-like (4:3 to 16:10), square-ish. */
export function shapeClass(width: number, height: number): "long" | "mid" | "square" {
  if (width <= 0 || height <= 0) return "square";
  const r = Math.max(width, height) / Math.min(width, height);
  return r >= 1.7 ? "long" : r >= 1.25 ? "mid" : "square";
}

/** Screenshot sizes that only come from tablet or iPad store sets (either orientation). */
const TABLET_SIZES = new Set(
  [
    [2048, 2732],
    [2064, 2752],
    [1536, 2048],
    [1668, 2388],
    [1668, 2224],
    [1640, 2360],
    [1600, 2560],
    [1200, 1920],
    [800, 1280],
  ].flatMap(([w, h]) => [`${w}x${h}`, `${h}x${w}`]),
);
/** A run of at least this many same-size tablet-shaped images after the phone set is a tablet set. */
const TABLET_SET_MIN = 3;

/**
 * Device class per screenshot using the whole deck. Google Play shows the phone set first and
 * appends the 7- and 10-inch tablet sets (and iPad sets) after it. The leading set is what phone
 * users see, whatever its shape. After it, a tablet-shaped image is tablet only when it clearly
 * belongs to an appended tablet set: a known tablet/iPad size, or a run of at least 3 images of
 * the same size. Any other image (e.g. a single landscape marketing image) stays phone.
 * Leading set: for a phone-shaped first image, every leading phone-shaped image (resolutions may
 * vary); for a tablet-shaped first image (a deck with no phone set), the leading run of that exact
 * resolution.
 */
export function deckDeviceClasses(
  sizes: readonly { width: number; height: number }[],
): DeviceClass[] {
  const first = sizes.find((s) => s.width > 0 && s.height > 0);
  if (!first) return sizes.map(() => "unknown");
  const lead = shapeClass(first.width, first.height);
  const sameAs = (a: { width: number; height: number }, b: { width: number; height: number }) =>
    Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2;
  const runLength = (i: number) => {
    const s = sizes[i] as { width: number; height: number };
    let a = i;
    let b = i;
    while (a > 0 && sameAs(sizes[a - 1] as typeof s, s)) a--;
    while (b < sizes.length - 1 && sameAs(sizes[b + 1] as typeof s, s)) b++;
    return b - a + 1;
  };
  let inLead = true;
  return sizes.map((s, i) => {
    if (s.width <= 0 || s.height <= 0) return "unknown";
    const shape = shapeClass(s.width, s.height);
    if (inLead && (lead === "long" ? shape === "long" : sameAs(s, first))) return "phone";
    inLead = false;
    if (shape === "long") return "phone";
    const tabletSet = TABLET_SIZES.has(`${s.width}x${s.height}`) || runLength(i) >= TABLET_SET_MIN;
    return tabletSet ? "tablet" : "phone";
  });
}

/** The same slots with device classes decided from the whole deck. */
export function withDeckDeviceClasses<
  T extends { width: number; height: number; deviceClass: DeviceClass },
>(slots: readonly T[]): T[] {
  const classes = deckDeviceClasses(slots);
  return slots.map((s, i) => ({ ...s, deviceClass: classes[i] as DeviceClass }));
}
