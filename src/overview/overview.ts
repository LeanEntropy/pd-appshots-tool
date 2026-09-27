import { imageFacts, orientationOf, ratioLabel } from "../analysis/image-facts.ts";
import { type Count, counts, median } from "../analysis/patterns.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { ImageDb } from "../store/imagedb.ts";
import { type DeckManifest, withDeckClasses } from "../store/manifest.ts";
import { latestRun } from "../view/model.ts";

export interface MarketOverview {
  gl: string;
  hl: string;
  label: string;
  games: number;
  /** Store images in the phone set (what phone users see), all games. */
  images: number;
  orientation: Count[];
  ratios: Count[];
  deckLength: { min: number; median: number; max: number };
  /** Share of images that are byte-identical to the same game's US image; null for the US. */
  reusedFromUs: number | null;
  colours: Count[];
  /** Tablet-set images appended after the phone set (not counted above). */
  tabletImages: number;
}

export interface GameOrientation {
  name: string;
  group: string;
  us: number | null;
  asia: number | null;
}

export interface Overview {
  createdAt: string;
  runId: string;
  /** Per country: the games in that country's own top-grossing chart, in that country's store. */
  markets: MarketOverview[];
  /** Same numbers for the named competitors and our game only. */
  namedMarkets: MarketOverview[];
  /** Landscape share per named game: US vs the Asian markets together. */
  games: GameOrientation[];
  totals: { games: number; images: number; uniqueImages: number };
}

type Slot = DeckManifest["slots"][number];
const phoneSet = (d: DeckManifest) =>
  d.slots.filter((s) => s.deviceClass === "phone" && s.width > 0);
const landscapeShare = (slots: readonly Slot[]) =>
  slots.length
    ? Math.round(
        (slots.filter((s) => orientationOf(s.width, s.height) === "landscape").length /
          slots.length) *
          100,
      ) / 100
    : null;

/**
 * Deterministic store overview from the downloaded data only (no AI): per country, across every
 * downloaded game, the orientation mix, aspect ratios, deck lengths, reuse of US images and the
 * measured dominant colours (colorthief, cached per image).
 */
export async function buildOverview(loaded: LoadedConfig): Promise<Overview> {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const run = latestRun(paths.runs);
  if (!run) throw new Error("No download run found yet. Run the download step first.");
  const db = ImageDb.open(paths.imageDb, paths.imagesOrig, paths.imagesThumb);
  const decks = run.decks.filter((d) => d.status === "ok").map(withDeckClasses);
  const topFamily = new Map<string, string | null>();
  for (const id of new Set(
    decks.flatMap((d) => phoneSet(d).map((s) => s.imageId)).filter((x): x is string => !!x),
  )) {
    const f = await imageFacts(paths, db, id);
    topFamily.set(id, f?.dominantColours[0]?.family ?? null);
  }
  const usDecks = new Map(
    decks
      .filter((d) => d.gl === "us")
      .map((d) => [d.appId, new Set(d.slots.map((s) => s.imageId))]),
  );
  const market = (
    m: { gl: string; hl: string; label: string },
    list: DeckManifest[],
  ): MarketOverview => {
    const here = list.filter((d) => d.gl === m.gl && d.hl === m.hl);
    const slots = here.flatMap(phoneSet);
    const reusable = here.filter((d) => m.gl !== "us" && usDecks.has(d.appId));
    const reuseSlots = reusable.flatMap(phoneSet);
    const reused = reuseSlots.filter((s) => {
      const d = reusable.find((x) => x.slots.includes(s));
      return !!s.imageId && !!d && !!usDecks.get(d.appId)?.has(s.imageId);
    }).length;
    const lengths = here.map((d) => phoneSet(d).length);
    return {
      gl: m.gl,
      hl: m.hl,
      label: m.label,
      games: here.length,
      images: slots.length,
      orientation: counts(slots.map((s) => orientationOf(s.width, s.height))),
      ratios: counts(slots.map((s) => ratioLabel(s.width, s.height))),
      deckLength: {
        min: lengths.length ? Math.min(...lengths) : 0,
        median: median(lengths),
        max: lengths.length ? Math.max(...lengths) : 0,
      },
      reusedFromUs:
        m.gl === "us" || !reuseSlots.length
          ? null
          : Math.round((reused / reuseSlots.length) * 100) / 100,
      colours: counts(slots.map((s) => (s.imageId ? (topFamily.get(s.imageId) ?? null) : null))),
      tabletImages: here.reduce(
        (n, d) => n + d.slots.filter((s) => s.deviceClass === "tablet").length,
        0,
      ),
    };
  };
  const named = decks.filter((d) => d.group !== "chart");
  const charted = decks.filter((d) => d.chartRanks?.[d.gl] !== undefined);
  const asia = (d: DeckManifest) => d.gl !== "us" && d.gl !== "ph";
  const names = [...new Set(named.map((d) => d.appId))];
  return {
    createdAt: new Date().toISOString(),
    runId: run.runId,
    markets: config.markets.map((m) => market(m, charted)),
    namedMarkets: config.markets.map((m) => market(m, named)),
    games: names.map((id) => {
      const mine = named.filter((d) => d.appId === id);
      const first = mine[0] as DeckManifest;
      return {
        name: mine.find((d) => d.title)?.title ?? first.name,
        group: first.group,
        us: landscapeShare(mine.filter((d) => d.gl === "us").flatMap(phoneSet)),
        asia: landscapeShare(mine.filter(asia).flatMap(phoneSet)),
      };
    }),
    totals: {
      games: new Set(decks.map((d) => d.appId)).size,
      images: decks.reduce((n, d) => n + phoneSet(d).length, 0),
      uniqueImages: topFamily.size,
    },
  };
}
