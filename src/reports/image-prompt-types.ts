import type { PositionVerdict } from "../analysis/ours-vs-position.ts";

/** The facts an image prompt is built from (image-prompt.ts), all gathered by code. */
export interface PromptPlace {
  game: string;
  storeName: string;
  country: string;
  /** English name of the page language, e.g. "Japanese". */
  language: string;
  english: boolean;
  deckLength: number;
}

/** One image as the saved analysis and layout describe it (all by code). */
export interface ImageFacts {
  name: string;
  screen: string;
  orientation: string;
  size: string;
  /** In-game screenshot + layer / art + layer / plain screenshot / promotional banner ... */
  structure: string;
  layout: string;
  layer: boolean | null;
  logo: boolean | null;
  headline: string;
  headlineEn: string;
  /** Size and place, e.g. "huge, at the bottom" (counted across competitors). */
  headlineStyle: string;
  /** Font and colour, e.g. "heavy rounded sans, outlined, yellow #f7f704" (examples only). */
  headlineFont: string;
  band: string;
  cutOut: string;
  focus: string;
  focusMatch: string;
  description: string;
}

export interface OursFacts extends ImageFacts {
  verdict: string;
  issues: string[];
}

export interface SpecText {
  role: string;
  text: string;
  style: string;
}

/** The recommended spec for the position (the report's recommendation, local text when given). */
export interface SlotSpec {
  screen: string;
  screenType: string;
  source: string;
  orientation: string;
  whatToCapture: string;
  action: string;
  atmosphere: string;
  mainColours: string;
  layerPresent: boolean;
  layout: string;
  mask: string;
  texts: SpecText[];
  elements: string[];
  logo: { show: boolean; why: string } | null;
  why: string;
  /** The country's own line (country advice), when the report wrote one. */
  local: { headline: string; english: string; subline: string; band: string; notes: string } | null;
}

export interface PromptSlot {
  position: number;
  competitors: ImageFacts[];
  ours: OursFacts | null;
  spec: SlotSpec | null;
  /** A copy or drop directive by code (directives.ts): the top priority of this position. */
  directive?: PositionVerdict["directive"] | null;
}
