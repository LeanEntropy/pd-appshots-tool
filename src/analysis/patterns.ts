import { ART_SCREEN } from "./art-wording.ts";
import { asCounted, categoryOf, FULL_SCREEN_ART } from "./categories.ts";
import { colourFamily, textColourFamily } from "./colours.ts";
import { type TagStats, tagStats } from "./image-tags.ts";
import type { ImageAnalysis } from "./schema.ts";

/** One analysed screenshot in store order. `canvas` comes from the image size, by code. */
export interface DeckEntry {
  appId: string;
  name: string;
  position: number;
  imageId: string;
  /** The image's own orientation, from its pixel size. */
  canvas: "portrait" | "landscape" | "square";
  /** Colour families measured from the pixels (colorthief), most dominant first. */
  imageColours?: string[];
  gl?: string;
  hl?: string;
  final: ImageAnalysis;
}

export interface Count {
  key: string;
  n: number;
  share: number;
}

export interface PositionStats {
  position: number;
  n: number;
  types: Count[];
  top: Count | null;
  layerShare: number;
  proportions: Count[];
}

export interface TypeStats {
  key: string;
  label: string;
  n: number;
  layerShare: number;
  maskColours: Count[];
  maskShapes: Count[];
  textColours: Count[];
  textPositions: Count[];
  elementKinds: Count[];
  headlines: string[];
}

export interface Patterns {
  games: { appId: string; name: string; analysed: number; deckLength: number }[];
  images: number;
  deckLength: { min: number; median: number; max: number };
  perPosition: PositionStats[];
  screenTypes: {
    key: string;
    games: number;
    gameShare: number;
    images: number;
    positions: number[];
  }[];
  orientation: { canvas: Count[]; capture: Count[]; byCountry: { market: string; mix: Count[] }[] };
  composition: Count[];
  capturesPerImage: Count[];
  /** A portrait in-game capture shown inside a landscape marketing image. */
  portraitInLandscape: { n: number; share: number };
  marketingLayer: { share: number; perGame: { name: string; share: number }[] };
  proportion: Count[];
  colours: { image: Count[]; screenshot: Count[]; layer: Count[]; masks: Count[]; texts: Count[] };
  maskShapes: Count[];
  maskLocations: Count[];
  textPositions: Count[];
  elementKinds: Count[];
  byScreenType: TypeStats[];
  /** The game logo per position and deck, and what full-screen art says (absent before 2026-09-29). */
  tags?: TagStats;
}

export const PROPORTION = {
  none: "no marketing layer",
  small: "full screenshot, small layer",
  large: "screenshot with a large layer",
  inside: "small screenshot inside a marketing image",
  art: ART_SCREEN,
} as const;

/**
 * Layer vs screenshot proportion, from the capture area (percent of the whole image). Title
 * screen / full-screen art is always the art layout, whichever form its analysis has.
 */
export function proportion(a: ImageAnalysis): string {
  if (categoryOf(a) === FULL_SCREEN_ART) return PROPORTION.art;
  if (!a.marketingLayer.present) return PROPORTION.none;
  const c = a.screenshot.captureAreaPercent;
  if (c >= 80) return PROPORTION.small;
  if (c >= 50) return PROPORTION.large;
  if (c > 0) return PROPORTION.inside;
  return PROPORTION.art;
}

export const portraitInLandscape = (e: DeckEntry) =>
  e.canvas === "landscape" &&
  asCounted(e.final).screenshot.captures.some((c) => c.orientation === "portrait");

/** The screen category the patterns compare (categories.ts). */
export function typeKey(a: ImageAnalysis): string {
  return categoryOf(a);
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Counts values, most common first (ties by name), with the share of `total` (default: values). */
export function counts(values: readonly (string | null)[], total?: number): Count[] {
  const m = new Map<string, number>();
  for (const v of values) if (v) m.set(v, (m.get(v) ?? 0) + 1);
  const t = total ?? values.filter(Boolean).length;
  return [...m.entries()]
    .map(([key, n]) => ({ key, n, share: t ? round(n / t) : 0 }))
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

const share = (xs: readonly boolean[]) =>
  xs.length ? round(xs.filter(Boolean).length / xs.length) : 0;

function typeStats(key: string, list: readonly DeckEntry[]): TypeStats {
  const layers = list.map((e) => e.final.marketingLayer);
  const masks = layers.flatMap((l) => l.backgroundMasks);
  const texts = layers.flatMap((l) => l.texts);
  return {
    key,
    label: key.replace(/_/g, " "),
    n: list.length,
    layerShare: share(layers.map((l) => l.present)),
    maskColours: counts(masks.map((m) => colourFamily(m.colourName, m.colourHex))),
    maskShapes: counts(masks.map((m) => m.shape)),
    textColours: counts(texts.map((t) => textColourFamily(t.colour))),
    textPositions: counts(texts.map((t) => t.position)),
    elementKinds: counts(layers.flatMap((l) => l.elements.map((e) => e.kind))),
    headlines: list.map((e) => e.final.headline).filter(Boolean),
  };
}

/**
 * Patterns across the competitors' analysed decks, by code only. `decks` maps each game to its
 * full store deck length (analysed or not), so deck length stats are true to the store.
 */
export function findPatterns(
  entries: readonly DeckEntry[],
  decks: readonly { appId: string; name: string; deckLength: number }[],
): Patterns {
  const maxPos = Math.max(0, ...entries.map((e) => e.position));
  const perPosition: PositionStats[] = [];
  for (let p = 1; p <= maxPos; p++) {
    const at = entries.filter((e) => e.position === p);
    const types = counts(at.map((e) => typeKey(e.final)));
    perPosition.push({
      position: p,
      n: at.length,
      types,
      top: types[0] ?? null,
      layerShare: share(at.map((e) => e.final.marketingLayer.present)),
      proportions: counts(at.map((e) => proportion(e.final))),
    });
  }
  const gameCount = decks.length || 1;
  const screenTypes = counts(entries.map((e) => typeKey(e.final))).map((c) => {
    const withType = entries.filter((e) => typeKey(e.final) === c.key);
    const games = new Set(withType.map((e) => e.appId)).size;
    return {
      key: c.key,
      games,
      gameShare: round(games / gameCount),
      images: c.n,
      positions: [...new Set(withType.map((e) => e.position))].sort((a, b) => a - b),
    };
  });
  const layers = entries.map((e) => e.final.marketingLayer);
  const masks = layers.flatMap((l) => l.backgroundMasks);
  const texts = layers.flatMap((l) => l.texts);
  const lengths = decks.map((d) => d.deckLength);
  return {
    games: decks.map((d) => ({
      ...d,
      analysed: entries.filter((e) => e.appId === d.appId).length,
    })),
    images: entries.length,
    deckLength: {
      min: lengths.length ? Math.min(...lengths) : 0,
      median: median(lengths),
      max: Math.max(0, ...lengths),
    },
    perPosition,
    screenTypes,
    orientation: {
      canvas: counts(entries.map((e) => e.canvas)),
      capture: counts(
        entries.flatMap((e) => asCounted(e.final).screenshot.captures.map((c) => c.orientation)),
      ),
      byCountry: [...new Set(entries.map((e) => `${e.gl ?? "?"}-${e.hl ?? "?"}`))].map((m) => ({
        market: m,
        mix: counts(
          entries.filter((e) => `${e.gl ?? "?"}-${e.hl ?? "?"}` === m).map((e) => e.canvas),
        ),
      })),
    },
    composition: counts(entries.map((e) => asCounted(e.final).screenshot.composition)),
    capturesPerImage: counts(
      entries.map((e) => {
        const n = asCounted(e.final).screenshot.captures.length;
        return n >= 3 ? "3+" : String(n);
      }),
    ),
    portraitInLandscape: {
      n: entries.filter(portraitInLandscape).length,
      share: share(entries.map(portraitInLandscape)),
    },
    marketingLayer: {
      share: share(layers.map((l) => l.present)),
      perGame: decks.map((d) => ({
        name: d.name,
        share: share(
          entries.filter((e) => e.appId === d.appId).map((e) => e.final.marketingLayer.present),
        ),
      })),
    },
    proportion: counts(entries.map((e) => proportion(e.final))),
    colours: {
      image: counts(entries.flatMap((e) => e.imageColours ?? [])),
      screenshot: counts(
        entries.flatMap((e) =>
          e.final.screenshot.mainColours.slice(0, 2).map((c) => colourFamily(c.name, c.hex)),
        ),
      ),
      layer: counts(
        layers.flatMap((l) => l.mainColours.slice(0, 2).map((c) => colourFamily(c.name, c.hex))),
      ),
      masks: counts(masks.map((m) => colourFamily(m.colourName, m.colourHex))),
      texts: counts(texts.map((t) => textColourFamily(t.colour))),
    },
    maskShapes: counts(masks.map((m) => m.shape)),
    maskLocations: counts(masks.map((m) => m.location)),
    textPositions: counts(texts.map((t) => t.position)),
    elementKinds: counts(layers.flatMap((l) => l.elements.map((e) => e.kind))),
    byScreenType: screenTypes.map((t) =>
      typeStats(
        t.key,
        entries.filter((e) => typeKey(e.final) === t.key),
      ),
    ),
    tags: tagStats(entries),
  };
}
