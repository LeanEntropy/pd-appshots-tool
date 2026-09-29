/**
 * The "Google Play vs App Store" report (plan-app-store 7.2): its inputs, read by code from the
 * decks and the analyses, and the saved report (stores-report.json). Everything here is computed
 * by code; no model writes any of it.
 */

/** What an analysis says about one image (null fields: not analysed). */
export interface Reading {
  /** Taxonomy id of the screen type. */
  screenType: string;
  /** Plain name of the screen, e.g. "Gameplay: battle". */
  screen: string;
  headline: string;
  /** Every text block of the marketing layer, in reading order. */
  texts: string[];
  /** The game's logo is on the image. */
  logo: boolean;
  /** Title art, key art or splash only (App Store Guideline 2.3.3 cares). */
  art: boolean;
}

export interface StoreSlot {
  position: number;
  imageId: string;
  thumb: string | null;
  width: number;
  height: number;
  orientation: string;
  phash: string;
  reading: Reading | null;
}

export interface AppleSlotIn extends StoreSlot {
  /** From the fetch: the same file as a library image, or the same picture as a Play one. */
  sameAs?: string;
}

export type DeckState = "ok" | "not-sold" | "none";

export interface PairInput {
  appId: string;
  name: string;
  ours: boolean;
  gl: string;
  country: string;
  play: { state: DeckState; slots: StoreSlot[] };
  apple: { state: DeckState; slots: AppleSlotIn[] };
}

/** How an App Store image relates to the same game's Google Play images in that country. */
export type Mark = "same-file" | "same-picture" | "same-screen" | "probably-same" | "new";

export const MARK_NAMES: Record<Mark, string> = {
  "same-file": "same file",
  "same-picture": "same picture",
  "same-screen": "same screen, new text or shape",
  "probably-same": "probably the same screen (not checked)",
  new: "new picture",
};

export interface Row {
  /** Position N of each store (row N = Google Play #N | App Store #N). */
  n: number;
  play: StoreSlot | null;
  apple: (StoreSlot & { mark: Mark; playPosition: number | null }) | null;
  /** Both analysed and both show a headline: whether its words changed. */
  text: "same" | "changed" | null;
}

export interface PairResult {
  appId: string;
  name: string;
  ours: boolean;
  gl: string;
  country: string;
  state: { play: DeckState; apple: DeckState };
  count: { play: number; apple: number };
  rows: Row[];
  /** App Store images per mark. */
  marks: Record<Mark, number>;
  /** Share of App Store images proven to reuse a Google Play screen (not "probably"). */
  reuseShare: number;
  /** Share of App Store images with no Google Play candidate at all. */
  newShare: number;
  /** Images that are probably a Google Play screen, not checked yet (answer Same screen). */
  unconfirmed: number;
  order: "same" | "reordered" | "not-comparable";
  orientation: { play: string; apple: string };
  /** App Store images in a taller or other shape than their Play counterpart. */
  reshaped: number;
  text: { compared: number; changed: number };
  /** Title-art-only images among positions 1 to 3, per store (null: not analysed). */
  leadArt: { play: number | null; apple: number | null };
  /** App Store images that break Guideline 2.3.3 (title art only). */
  appleArt: number[];
}

export interface StorePattern {
  id: string;
  country: string;
  gl: string;
  statement: string;
  n: number;
  of: number;
  /** At least 3 games and at least half of those compared: a pattern, else a statistic. */
  pattern: boolean;
  games: string[];
  /** Our game against it: fits, different, or not comparable. */
  ours: "fits" | "different" | "n/a";
  oursNote: string;
}

export interface StoreRec {
  store: "play" | "appstore";
  priority: number;
  title: string;
  why: string;
  action: string;
  /** An enforced App Store rule behind it (e.g. "Guideline 2.3.3"). */
  rule: string | null;
  /** The action can reuse the other store's asset (a reshape) or needs a new image. */
  asset: "reuse" | "new" | "none";
}

export interface StoreTest {
  store: "play" | "appstore";
  title: string;
  hypothesis: string;
  evidence: string;
  control: string;
  treatments: string[];
  metric: string;
  setup: { line: string; notes: string[] };
}

export interface StoresReport {
  kind: "stores";
  version: 1;
  generatedAt: string;
  countries: { gl: string; label: string }[];
  summary: { verdict: string; points: string[]; actions: string[] };
  pairs: PairResult[];
  patterns: StorePattern[];
  recommendations: StoreRec[];
  tests: StoreTest[];
  /** Plain notes on what the data cannot show (folded, once). */
  caveats: string[];
  leftOut: string[];
}
