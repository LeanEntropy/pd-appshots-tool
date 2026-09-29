import sharp from "sharp";
import { type Family, hexFamily } from "./colours.ts";
import type { ImageAnalysis } from "./schema.ts";

/**
 * Main colours per layer, measured by code from the pixels (plan-analysis-speed item 6): the
 * screen colours from the pixels inside the captures minus the text and band boxes (the whole
 * image for pure art), the layer colours from the pixels inside the band and text boxes, and
 * each band's median colour. Names are the tool's colour families; hex values are exact means.
 * Stored apart from the analysis record, with its own version, keyed by the record it used.
 */
export const COLOUR_MEASURE_VERSION = "colour-measure.v1";

export interface MeasuredColour {
  name: Family;
  hex: string;
  share: number;
}

export interface MeasuredColours {
  version: string;
  /** The analysis record whose boxes were used (its key and updatedAt). */
  basedOn: string;
  screen: MeasuredColour[];
  layer: MeasuredColour[];
  /** One per background mask, in the record's order. */
  masks: { hex: string; family: Family | null }[];
}

type Box = { x: number; y: number; w: number; h: number };
const SIDE = 320;

const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

function inBox(b: Box, x: number, y: number, w: number, h: number): boolean {
  const px = (x / w) * 100;
  const py = (y / h) * 100;
  return px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h;
}

/** Families of a set of pixels, most first, with their mean colour; shares below 5% dropped. */
function families(
  px: Buffer,
  w: number,
  h: number,
  take: (x: number, y: number) => boolean,
  max: number,
): MeasuredColour[] {
  const acc = new Map<Family, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!take(x, y)) continue;
      const i = (y * w + x) * 3;
      const r = px[i] ?? 0;
      const g = px[i + 1] ?? 0;
      const b = px[i + 2] ?? 0;
      const f = hexFamily(toHex(r, g, b));
      if (!f) continue;
      const a = acc.get(f) ?? { n: 0, r: 0, g: 0, b: 0 };
      a.n++;
      a.r += r;
      a.g += g;
      a.b += b;
      acc.set(f, a);
      total++;
    }
  }
  if (!total) return [];
  return [...acc]
    .map(([name, a]) => ({
      name,
      hex: toHex(a.r / a.n, a.g / a.n, a.b / a.n),
      share: Math.round((a.n / total) * 100) / 100,
    }))
    .filter((c) => c.share >= 0.05)
    .sort((a, b) => b.share - a.share)
    .slice(0, max);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

/** Measures the colours of one image with the boxes of its analysis. */
export async function measureColours(
  image: Buffer,
  a: ImageAnalysis,
  basedOn: string,
): Promise<MeasuredColours> {
  const { data, info } = await sharp(image)
    .resize({ width: SIDE, height: SIDE, fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const m = a.marketingLayer;
  const layerBoxes: Box[] = [...m.backgroundMasks, ...m.texts].map((x) => x.region);
  const inLayer = (x: number, y: number) => layerBoxes.some((b) => inBox(b, x, y, w, h));
  // A full background or frame behind the captures does not hide them: only boxes smaller than
  // half the image are cut out of the screen.
  const cutOut = layerBoxes.filter((b) => b.w * b.h < 5000);
  const caps = a.screenshot.captures.map((c) => c.region);
  const inScreen = (x: number, y: number) =>
    !cutOut.some((b) => inBox(b, x, y, w, h)) &&
    (!caps.length || caps.some((b) => inBox(b, x, y, w, h)));
  let screen = families(data, w, h, inScreen, 5);
  // Captures fully covered by the layer: the whole image outside the layer instead.
  if (!screen.length) screen = families(data, w, h, (x, y) => !inLayer(x, y), 5);
  if (!screen.length) screen = families(data, w, h, () => true, 5);
  const layer = m.present ? families(data, w, h, inLayer, 4) : [];
  const masks = m.backgroundMasks.map((mask) => {
    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (!inBox(mask.region, x, y, w, h)) continue;
        const i = (y * w + x) * 3;
        rs.push(data[i] ?? 0);
        gs.push(data[i + 1] ?? 0);
        bs.push(data[i + 2] ?? 0);
      }
    if (!rs.length) return { hex: "unknown", family: null };
    const hex = toHex(median(rs), median(gs), median(bs));
    return { hex, family: hexFamily(hex) };
  });
  return { version: COLOUR_MEASURE_VERSION, basedOn, screen, layer, masks };
}

/**
 * The reading with the measured colours in place of the model's (for statistics and the
 * recommendation input only; the stored record keeps the model's colours).
 */
export function withMeasuredColours(a: ImageAnalysis, c: MeasuredColours): ImageAnalysis {
  const m = a.marketingLayer;
  return {
    ...a,
    screenshot: { ...a.screenshot, mainColours: c.screen.map(({ name, hex }) => ({ name, hex })) },
    marketingLayer: {
      ...m,
      mainColours: m.present ? c.layer.map(({ name, hex }) => ({ name, hex })) : [],
      backgroundMasks: m.backgroundMasks.map((b, i) => {
        const got = c.masks[i];
        return got && got.hex !== "unknown"
          ? { ...b, colourName: got.family ?? b.colourName, colourHex: got.hex }
          : b;
      }),
    },
  };
}
