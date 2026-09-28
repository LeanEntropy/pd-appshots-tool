import type { LayerDiffRecord } from "../analysis/layer-diff.ts";
import { type AnalysisRecord, isUsable } from "../analysis/records.ts";
import type { ImageAnalysis } from "../analysis/schema.ts";
import { pairKey, samePicture } from "./anchors.ts";
import { does, HABITS, habitsOf } from "./localisation-habits.ts";
import { orderNote } from "./localisation-order.ts";
import { countryName, theCountry } from "./names.ts";
import type { MarketRef } from "./types.ts";

/**
 * How each game localises its store page, against the main country's page (plan-reports 3,
 * section 3 and 4), computed by code: the same file (content hash), the same picture with new
 * text (perceptual hash; the text-layer comparison says what changed), or a different picture;
 * moved positions; text left in the main country's language; band and extra-element changes.
 */
export type LineKind = "identical" | "new-text" | "not-compared" | "different";

export interface LocalLine {
  position: number;
  /** The main-country position of the same picture, or null (a picture not used there). */
  mainPosition: number | null;
  kind: LineKind;
  imageId: string;
  thumb: string | null;
  mainThumb: string | null;
  mainHeadline: string;
  localHeadline: string;
  backTranslation: string;
  /** The language of the image's text: "local", "main" (left untranslated), "none", "mixed". */
  text: "local" | "main" | "none" | "mixed";
  band: string;
  swapped: string;
}

export interface LocalRow {
  appId: string;
  game: string;
  ours: boolean;
  gl: string;
  country: string;
  state: "ok" | "not-sold" | "not-downloaded" | "left-out" | "no-main";
  images: number;
  mainImages: number;
  identical: number;
  newText: number;
  notCompared: number;
  different: number;
  moved: number;
  /** Images with text, the text still in the main country's language / in the local language. */
  keptText: number;
  translated: number;
  bandChanged: number;
  swapped: number;
  orderNote: string;
  lines: LocalLine[];
}

export { HABITS, habitsOf };
export type HabitId = "translate" | "keep-text" | "swap" | "reorder" | "colours";

export interface Habit {
  id: HabitId;
  label: string;
  definition: string;
  /** Competitors that do it, of the competitors compared in that country. */
  n: number;
  of: number;
  games: string[];
  /** Whether we do it (null: our game has no page here). */
  ours: boolean | null;
  /** [V] same as most competitors, [X] different; null when fewer than 2 competitors. */
  fits: boolean | null;
  reason: string;
}

export interface CountryHabits {
  gl: string;
  country: string;
  habits: Habit[];
}

export interface LocalisationData {
  main: MarketRef;
  rows: LocalRow[];
  habits: CountryHabits[];
  /** Figures over the competitors present in every compared country (null with one country). */
  across: {
    competitors: string[];
    note: string;
    habits: { id: HabitId; label: string; perCountry: { gl: string; n: number; of: number }[] }[];
  } | null;
}

export interface LocalisationInput {
  main: MarketRef;
  markets: readonly MarketRef[];
  games: readonly { appId: string; name: string; ours: boolean }[];
  decks: readonly { appId: string; gl: string; state: string; positions: number[] }[];
  /** A game's analysed phone slots in one country (the main country included). */
  slots: (appId: string, gl: string, hl: string) => { position: number; imageId: string }[];
  image: (id: string) => { phash: string; width: number; height: number; thumb?: string } | null;
  record: (id: string) => AnalysisRecord | undefined;
  layer: (id: string) => LayerDiffRecord | undefined;
  different: ReadonlySet<string>;
}

const base = (lang: string) => lang.toLowerCase().split(/[-_]/)[0] ?? "";

/** The language of an image's text against the main and the local language (by code). */
export function textLanguage(f: ImageAnalysis | null, mainHl: string, localHl: string) {
  const texts = f?.marketingLayer.present ? f.marketingLayer.texts.filter((t) => t.text) : [];
  if (!texts.length) return "none" as const;
  const main = base(mainHl);
  const local = base(localHl);
  const langs = texts.map((t) => base(t.language));
  const isMain = langs.filter((l) => l === main).length;
  const isLocal = langs.filter((l) => l === local).length;
  if (main === local) return "local" as const;
  if (isLocal > isMain) return "local" as const;
  if (isMain > isLocal) return "main" as const;
  return "mixed" as const;
}

function line(
  x: LocalisationInput,
  m: MarketRef,
  s: { position: number; imageId: string },
  mainSlots: { position: number; imageId: string }[],
): LocalLine {
  const img = x.image(s.imageId);
  const rec = x.record(s.imageId);
  const final = isUsable(rec) ? rec.final : null;
  const same = mainSlots.find((t) => t.imageId === s.imageId);
  const near =
    same ??
    mainSlots.find((t) => {
      const a = x.image(t.imageId);
      return (
        !!a &&
        !!img &&
        !x.different.has(pairKey(t.imageId, s.imageId)) &&
        samePicture(a, img) &&
        t.imageId !== s.imageId
      );
    });
  const d = x.layer(s.imageId);
  const diff = d?.status === "ok" ? d.diff : null;
  const mainRec = near ? x.record(near.imageId) : undefined;
  const kind: LineKind = same
    ? "identical"
    : near && d?.status !== "different-screen"
      ? diff
        ? "new-text"
        : "not-compared"
      : "different";
  const head = diff?.texts.find((t) => t.localText && t.localText === diff.headline);
  return {
    position: s.position,
    mainPosition: kind === "different" ? null : (near?.position ?? null),
    kind,
    imageId: s.imageId,
    thumb: img?.thumb ?? null,
    mainThumb: near ? (x.image(near.imageId)?.thumb ?? null) : null,
    mainHeadline: isUsable(mainRec) && kind !== "different" ? mainRec.final.headline : "",
    localHeadline: final?.headline ?? "",
    backTranslation: head?.backTranslation ?? "",
    text: textLanguage(final, x.main.hl, m.hl),
    band: diff && diff.band.change !== "none" ? diff.band.change : "",
    swapped:
      diff && diff.elements.change !== "none" ? diff.elements.notes || diff.elements.change : "",
  };
}

function rowFor(
  x: LocalisationInput,
  g: { appId: string; name: string; ours: boolean },
  m: MarketRef,
): LocalRow {
  const deck = x.decks.find((d) => d.appId === g.appId && d.gl === m.gl);
  const mainSlots = x.slots(g.appId, x.main.gl, x.main.hl);
  const empty = {
    appId: g.appId,
    game: g.name,
    ours: g.ours,
    gl: m.gl,
    country: m.label,
    images: 0,
    mainImages: mainSlots.length,
    identical: 0,
    newText: 0,
    notCompared: 0,
    different: 0,
    moved: 0,
    keptText: 0,
    translated: 0,
    bandChanged: 0,
    swapped: 0,
    orderNote: "",
    lines: [],
  };
  if (deck?.state !== "ok")
    return { ...empty, state: (deck?.state ?? "not-downloaded") as LocalRow["state"] };
  const lines = x
    .slots(g.appId, m.gl, m.hl)
    .filter((s) => deck.positions.includes(s.position))
    .map((s) => line(x, m, s, mainSlots));
  const count = (f: (l: LocalLine) => boolean) => lines.filter(f).length;
  return {
    ...empty,
    state: mainSlots.length ? "ok" : "no-main",
    images: lines.length,
    identical: count((l) => l.kind === "identical"),
    newText: count((l) => l.kind === "new-text"),
    notCompared: count((l) => l.kind === "not-compared"),
    different: count((l) => l.kind === "different"),
    moved: count((l) => l.mainPosition !== null && l.mainPosition !== l.position),
    keptText: count((l) => l.text === "main"),
    translated: count((l) => l.text === "local" || l.text === "mixed"),
    bandChanged: count((l) => !!l.band),
    swapped: count((l) => !!l.swapped),
    orderNote: mainSlots.length ? orderNote(lines, mainSlots.length) : "",
    lines,
  };
}

/** The localisation part of a report of countries other than the main one (null otherwise). */
export function localisation(x: LocalisationInput): LocalisationData | null {
  const abroad = x.markets.filter((m) => !(m.gl === x.main.gl && m.hl === x.main.hl));
  if (!abroad.length) return null;
  const rows = abroad.flatMap((m) => x.games.map((g) => rowFor(x, g, m)));
  const habits = abroad.map((m) => habitsOf(rows, m, x.main));
  let across: LocalisationData["across"] = null;
  if (abroad.length > 1) {
    const everywhere = x.games.filter(
      (g) =>
        !g.ours &&
        abroad.every((m) =>
          rows.some((r) => r.appId === g.appId && r.gl === m.gl && r.state === "ok"),
        ),
    );
    const note =
      everywhere.length < 2
        ? `Fewer than 2 competitors have a page in every compared country, so there is no cross-country figure.`
        : `Over the ${everywhere.length} competitors with a page in ${abroad.map((m) => countryName(m.label)).join(", ")}, each against ${theCountry(x.main.label)}.`;
    across = {
      competitors: everywhere.map((g) => g.name),
      note,
      habits:
        everywhere.length < 2
          ? []
          : (Object.keys(HABITS) as HabitId[]).map((id) => ({
              id,
              label: HABITS[id].label,
              perCountry: abroad.map((m) => {
                const rs = rows.filter(
                  (r) => r.gl === m.gl && everywhere.some((g) => g.appId === r.appId),
                );
                return { gl: m.gl, n: rs.filter(does[id]).length, of: rs.length };
              }),
            })),
    };
  }
  return { main: x.main, rows, habits, across };
}
