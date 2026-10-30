import {
  categoryOf,
  definitionOf,
  hasDefinition,
  isArtCategory,
  LAYER_TAGS,
  PROMO_BANNER,
} from "./categories.ts";
import { colourFamily } from "./colours.ts";
import { coreLoop, defined, kindOf, uses } from "./directive-kinds.ts";
import { artMessage, lines, showsLogo } from "./image-tags.ts";
import { type Labeler, screenName } from "./labels.ts";
import { layerStructure } from "./layer-structure.ts";
import { counts, type DeckEntry, type Patterns, proportion } from "./patterns.ts";

/**
 * Firm directives by code (user, 2026-10-30): "COPY THE PATTERN" and "DROP IT".
 *
 * Copy: at one position, all competitors or a clear majority of at least 2 (more than half, one
 * clear leader) share the category, the orientation or the layer structure, and ours differs.
 * Drop: no competitor uses our screen kind (category, plus the subtype for game screens, e.g.
 * Gameplay / Victory) anywhere in its analysed images; it always names a replacement.
 * Our core loop is never dropped: a Gameplay screen that shows play itself (anything but a victory
 * or defeat screen) and that no competitor shows is ours alone, so it is kept and said so.
 * Each directive carries what SHOULD be there, from the competitors' own images. The project
 * marks no market leaders, so every competitor counts the same.
 */
export interface PatternSpec {
  category: string;
  screen: string;
  games: string[];
  n: number;
  of: number;
  /** Where the spec comes from: this position, or the competitors' decks overall. */
  from: "position" | "decks";
  orientation: string;
  size: string;
  layerStructure: string;
  /** False for art and banners: the whole image is the marketing layer. */
  screenshotLayer: boolean;
  details: string[];
}

export interface Directive {
  kind: "copy" | "drop";
  position: number;
  imageId: string;
  /** Copy: the attributes where ours differs from the dominant pattern. */
  differs: string[];
  /** Our screen kind that no competitor uses (also set on a copy when it applies). */
  dropped: { screen: string; headline: string } | null;
  spec: PatternSpec;
  /** The firm directive, as said in "How ours compares" and the bottom line. */
  text: string;
}

/** One image per game at a position (the first, when a deck repeats). */
function perGame(theirs: readonly DeckEntry[], position: number): DeckEntry[] {
  const seen = new Set<string>();
  return theirs.filter((e) => e.position === position && !seen.has(e.appId) && !!seen.add(e.appId));
}

/** The value shared by all, or by a clear majority of at least 2, of `xs`. */
function dominant(xs: readonly (string | null | undefined)[]): string | null {
  const c = counts(
    xs.map((x) => x ?? null),
    xs.length,
  );
  const top = c[0];
  if (!top || top.n < 2 || top.n * 2 <= xs.length || top.n === c[1]?.n) return null;
  return top.key;
}

const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const layerName = (k: string) => lc(LAYER_TAGS[k]?.label ?? k);
const join = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
const topOf = (xs: readonly (string | null | undefined)[], k = 2) =>
  counts(xs.map((x) => x || null)).slice(0, k);

function who(games: readonly string[], of: number): string {
  const n = games.length;
  const names = `(${join(games)})`;
  if (n === 1) return `${games[0]}`;
  if (n === of) return n === 2 ? `both competitors ${names}` : `all ${n} competitors ${names}`;
  return `${n} of ${of} competitors ${names}`;
}

/** What SHOULD be there, from the competitors' images that show it. */
function specOf(
  es: readonly DeckEntry[],
  of: number,
  from: PatternSpec["from"],
  label: Labeler,
): PatternSpec {
  const first = es[0] as DeckEntry;
  const category = categoryOf(first.final);
  const subtype =
    topOf(
      es.map((e) => kindOf(e.final).subtype),
      1,
    )[0]?.key ?? "";
  const screen = screenName(label, category, isArtCategory(category) ? "" : subtype);
  const orientation =
    topOf(
      es.map((e) => e.canvas),
      1,
    )[0]?.key ?? first.canvas;
  const size =
    topOf(
      es.map((e) => e.size),
      1,
    )[0]?.key ?? "";
  const ratio =
    topOf(
      es.map((e) => e.ratio),
      1,
    )[0]?.key ?? "";
  const ls =
    topOf(
      es.map((e) => layerStructure(e.final)),
      1,
    )[0]?.key ?? "";
  const art = isArtCategory(category);
  const games = [...new Set(es.map((e) => e.name))];
  const n = es.length;
  const heads = es.flatMap((e) => lines(e.final, e.name).slice(0, 1));
  const texts = es.flatMap((e) =>
    e.final.marketingLayer.texts.filter((t) => t.role === "headline"),
  );
  const style = topOf(
    texts.map((t) => `${t.size}, at the ${t.position.replace(/_/g, " ")}`),
    1,
  );
  const font = texts[0] ? `${texts[0].fontStyle}, ${texts[0].colour}` : "";
  const msg =
    topOf(
      es.map((e) => artMessage(e.final, e.name)),
      1,
    )[0]?.key ?? "";
  const logo = es.filter((e) => showsLogo(e.final, e.name)).length;
  const focus = topOf(
    es.map((e) => e.focus),
    1,
  )[0];
  const people = es.flatMap((e) =>
    e.final.marketingLayer.elements
      .filter((x) => x.kind === "character" || x.kind === "creature" || x.kind === "item")
      .slice(0, 1)
      .map((x) => `${x.what}${x.pose && x.pose !== "n/a" ? ` (${x.pose})` : ""}`),
  );
  const colours = topOf(
    es.flatMap((e) =>
      [...e.final.marketingLayer.mainColours, ...e.final.screenshot.mainColours]
        .slice(0, 3)
        .map((c) => colourFamily(c.name, c.hex)),
    ),
    3,
  ).map((c) => c.key);
  const mood = [...new Set(es.map((e) => e.final.screenshot.atmosphere.trim()).filter(Boolean))];
  const details = [
    `Category: ${screen}`,
    `Orientation and size: ${orientation}${size ? `, ${size}` : ""}${ratio ? ` (${ratio})` : ""}`,
    `Layer structure: ${layerName(ls)}${art ? "; screenshot layer: none, the whole image is the marketing layer" : ""}`,
    `Layout: ${proportion(first.final)}`,
    heads.length
      ? `Headline: one short ${msg ? lc(definitionOf(msg)?.label ?? msg) : "line"}${style[0] ? `, ${style[0].key}` : ""}${font ? `, e.g. ${font}` : ""}; theirs: ${heads.map((h) => `"${h}"`).join(", ")} (write our own)`
      : "Headline: none",
    `Game logo: ${logo * 2 > n ? "yes" : "no"} (${logo} of ${n})`,
    ...(focus ? [`Focus: ${focus.key}`] : []),
    ...(people.length ? [`Characters or product art: ${people.join("; ")}`] : []),
    ...(colours.length ? [`Colours: mostly ${join(colours)}`] : []),
    ...(mood.length ? [`Mood: ${mood.slice(0, 2).join("; ")}`] : []),
  ];
  return {
    category,
    screen,
    games,
    n: games.length,
    of,
    from,
    orientation,
    size,
    layerStructure: ls,
    screenshotLayer: !art,
    details,
  };
}

/** "a landscape promotional banner (all marketing art, no separate layer)". */
const shape = (s: PatternSpec) =>
  `a ${s.orientation} ${s.screen.toLowerCase()} (${layerName(s.layerStructure)})`;

function build(s: PatternSpec): string {
  if (s.category === PROMO_BANNER)
    return `Create a similar ${s.orientation} promotional banner here: a completely new image built from our own logo and art; screenshot layer: none, the whole image is the marketing layer. Do not rebuild our title screen.`;
  if (!s.screenshotLayer) return `Create ${shape(s)} here, built from our own art and logo.`;
  return `Replace it with ${shape(s)}, captured from our own game.`;
}

const ESCAPE =
  "Deviate only for a stated reason (a store rule, or no source material at all), and then A/B test this change.";

/** The copy and drop directives of our deck, by position (see the file comment). */
export function directivesOf(
  theirs: readonly DeckEntry[],
  ours: readonly DeckEntry[],
  p: Patterns,
  label: Labeler,
): Directive[] {
  const games = new Set(theirs.map((e) => e.appId));
  const out: Directive[] = [];
  const usedByUs = new Set(ours.map((e) => categoryOf(e.final)));
  for (const e of [...ours].sort((a, b) => a.position - b.position)) {
    const at = perGame(theirs, e.position);
    const of = at.length;
    const cat = dominant(at.map((x) => defined(x.final)));
    const canvas = dominant(at.map((x) => x.canvas));
    const ls = dominant(at.map((x) => layerStructure(x.final)));
    const mine = kindOf(e.final);
    const myLs = layerStructure(e.final);
    const differs = [
      ...(cat && cat !== mine.category ? ["category"] : []),
      ...(canvas && canvas !== e.canvas ? ["orientation"] : []),
      ...(ls && ls !== myLs ? ["layer structure"] : []),
    ];
    const unused =
      games.size >= 2 &&
      hasDefinition(mine.category) &&
      !coreLoop(e) &&
      !theirs.some((x) => uses(x.final, mine));
    if (!differs.length && !unused) continue;
    const match = at.filter(
      (x) =>
        (!cat || categoryOf(x.final) === cat) &&
        (!canvas || x.canvas === canvas) &&
        (!ls || layerStructure(x.final) === ls),
    );
    let spec: PatternSpec;
    if (match.length >= 2) spec = specOf(match, of, "position", label);
    else {
      // Drop with no clear pattern here: the most common type at this position, else the most
      // common type we lack, else the most common type overall.
      const here = topOf(
        at.map((x) => defined(x.final)),
        1,
      )[0]?.key;
      const lack = p.screenTypes.find((t) => !usedByUs.has(t.key))?.key;
      const k = here ?? lack ?? p.screenTypes[0]?.key;
      const pool = here ? at : theirs;
      const es = pool.filter((x) => categoryOf(x.final) === k);
      if (!es.length) continue;
      spec = specOf(es, here ? of : games.size, here ? "position" : "decks", label);
    }
    const ourScreen = screenName(label, mine.category, mine.subtype);
    const headline = lines(e.final, e.name)[0] ?? "";
    const dropped = unused ? { screen: ourScreen, headline } : null;
    const where = spec.from === "position" ? `at image ${e.position}` : "in their decks";
    const move = headline
      ? ` Move its useful line "${headline}" to another image or to the store description.`
      : "";
    const text = differs.length
      ? `Copy the pattern: ${who(spec.games, spec.of)} use ${shape(spec)} at image ${e.position}; ours is a ${e.canvas} ${ourScreen.toLowerCase()} (${layerName(myLs)}). ${build(spec)}${dropped ? ` No competitor uses ${ourScreen.toLowerCase()} anywhere.${move}` : ""} ${ESCAPE}`
      : `Drop image ${e.position}: none of the ${games.size} competitors uses ${ourScreen.toLowerCase()} anywhere in their decks. Put ${shape(spec)} there instead, as ${who(spec.games, spec.of)} ${spec.games.length === 1 ? "shows" : "show"} ${where}. ${spec.screenshotLayer ? "Capture it from our own game." : build(spec)}${move} ${ESCAPE}`;
    out.push({
      kind: differs.length ? "copy" : "drop",
      position: e.position,
      imageId: e.imageId,
      differs,
      dropped,
      spec,
      text,
    });
  }
  return out;
}

/** Our core-loop screens no competitor shows (never dropped): a note per position. */
export function coreKept(
  theirs: readonly DeckEntry[],
  ours: readonly DeckEntry[],
  label: Labeler,
): Map<number, string> {
  const out = new Map<number, string>();
  if (new Set(theirs.map((e) => e.appId)).size < 2) return out;
  for (const e of ours) {
    const k = kindOf(e.final);
    if (!coreLoop(e) || theirs.some((x) => uses(x.final, k))) continue;
    const s = screenName(label, k.category, k.subtype);
    out.set(
      e.position,
      `${s}: no competitor shows it, but it is our own play (core loop), so it is kept, not dropped; A/B test its position and headline`,
    );
  }
  return out;
}
