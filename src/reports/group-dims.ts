import type { GameOrder, OrderRow } from "../analysis/report-data.ts";

/**
 * The dimensions compared across countries (plan-cross-country 3.3, fixed and versioned), read by
 * code from each game's saved position table in one country (its "page"). The 5 main dimensions
 * are yes/no questions that can drive a recommendation; the exploratory ones are shown only.
 * A value is null (unknown) where the positions it needs are not analysed: never counted as "no".
 */
export const DIMS_VERSION = "group-dims.v1";

export type MainDim = "landscape" | "titleArt" | "inset" | "largeLayer" | "logo";
export type ExploreDim = "deckLength" | "order" | "compositionMix" | "artMessage";

export const MAIN_DIMS: {
  id: MainDim;
  label: string;
  /** The question, answered yes or no per page. */
  question: string;
  /** What a "yes" page does, as a verb phrase ("open with title art"). */
  does: string;
  definition: string;
}[] = [
  {
    id: "landscape",
    label: "Landscape image",
    question: "Uses a landscape (wide) image anywhere in the set",
    does: "use a landscape image",
    definition:
      "An image wider than it is tall, measured from the pixels of every image. Portrait images are taller than wide.",
  },
  {
    id: "titleArt",
    label: "Opens with title art",
    question: "Image 1 is a title screen / full-screen art",
    does: "open with title art",
    definition:
      "Image 1 is one full-screen artwork (title, loading or key art style) rather than a screenshot of play or menus.",
  },
  {
    id: "inset",
    label: "Screenshot inside marketing art",
    question: "One of images 1 to 3 shows a screenshot set inside marketing art",
    does: "set a screenshot inside marketing art in images 1 to 3",
    definition:
      "The in-game screenshot sits framed or inset inside a designed background (one or several screenshots), instead of filling the image.",
  },
  {
    id: "largeLayer",
    label: "Large marketing layer",
    question:
      "Most screenshots in images 1 to 3 leave 20 % or more of the image to the marketing layer",
    does: "give the marketing layer a large share of images 1 to 3",
    definition:
      "The marketing layer (bands, headline, characters) covers 20 % or more of the image, so the screenshot fills less than 80 %. Title art is not counted.",
  },
  {
    id: "logo",
    label: "Logo early",
    question: "The game logo is on one of images 1 to 3",
    does: "show the game logo in images 1 to 3",
    definition: "The game's logo (its name as artwork) is visible on image 1, 2 or 3.",
  },
];

export const EXPLORE_DIMS: { id: ExploreDim; label: string; definition: string }[] = [
  {
    id: "deckLength",
    label: "Different images in the set",
    definition:
      "Images in the set, each screen counted once (the same screen uploaded twice, even with another headline, counts once).",
  },
  {
    id: "order",
    label: "Order of images 1 to 3",
    definition: "The kind of screen at images 1, 2 and 3.",
  },
  {
    id: "compositionMix",
    label: "Composition of images 1 to 3",
    definition:
      "How images 1 to 3 are built: full screenshot, screenshot in art, several, full-screen art.",
  },
  {
    id: "artMessage",
    label: "What the title art says",
    definition:
      "The message of title art in images 1 to 3: logo only, headline or benefit, event or offer, character showcase.",
  },
];

export type PageValues = Record<MainDim, boolean | null> & {
  deckLength: number;
  deckTotal: number;
  order: string | null;
  compositionMix: string | null;
  artMessage: string | null;
};

const ART = "full_screen_art";
const INSET = /inside marketing art|Several in-game screenshots/i;
const analysed = (r: OrderRow) => r.state !== "not analysed" && r.state !== "excluded";

/** The share of the image the screenshots cover, from the capture lines ("85% of the image"). */
export function captureShare(r: OrderRow): number | null {
  if (!r.captures.length) return null;
  return r.captures.reduce((n, c) => n + Number(/(\d+)% of the image/.exec(c)?.[1] ?? 0), 0);
}

/** Yes when any is yes, no when all are known no, else unknown. */
const anyOf = (xs: (boolean | null)[]): boolean | null =>
  xs.some((x) => x === true) ? true : xs.length && xs.every((x) => x === false) ? false : null;

export function pageValues(g: GameOrder): PageValues {
  const first3 = g.rows.filter((r) => r.position <= 3);
  const known3 = first3.length > 0 && first3.every(analysed);
  const r1 = g.rows.find((r) => r.position === 1);
  const inset = first3.map((r) => (analysed(r) ? INSET.test(r.composition) : null));
  const shots = first3.filter((r) => analysed(r) && r.category !== ART);
  const large = shots.map((r) => {
    const share = captureShare(r);
    return share === null ? null : share < 80;
  });
  const largeKnown = large.filter((x): x is boolean => x !== null);
  const art = first3.find((r) => r.category === ART && r.message);
  return {
    landscape: g.rows.length ? g.rows.some((r) => r.orientation === "landscape") : null,
    titleArt: r1 && analysed(r1) && r1.category !== undefined ? r1.category === ART : null,
    inset: known3 ? anyOf(inset) : null,
    largeLayer:
      known3 && largeKnown.length
        ? largeKnown.filter(Boolean).length * 2 > largeKnown.length
        : null,
    logo: known3 ? anyOf(first3.map((r) => r.logo ?? null)) : null,
    deckLength: g.rows.filter((r) => r.repeatOf === undefined).length,
    deckTotal: g.rows.length,
    order: known3 ? first3.map((r) => r.category ?? "?").join(" > ") : null,
    compositionMix: known3
      ? [...new Set(first3.map((r) => r.composition || "?"))].sort().join(" + ")
      : null,
    artMessage: known3
      ? (art?.message ?? (first3.some((r) => r.category === ART) ? null : "none"))
      : null,
  };
}
