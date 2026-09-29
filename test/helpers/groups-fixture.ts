import type { GameOrder, OrderRow, ReportData } from "../../src/analysis/report-data.ts";
import type { AbTestCard, PlayContext } from "../../src/reports/ab-section.ts";
import type { CountryReport } from "../../src/reports/country-report-types.ts";
import type { CountryPages } from "../../src/reports/groups.ts";

/** Small hand-made pages for the cross-country tests (no project, no disk). */
export interface DeckFlags {
  titleArt?: boolean;
  logo?: boolean;
  landscape?: boolean;
  inset?: boolean;
  /** Image ids prefix: the same prefix in two countries means the same files. */
  ids?: string;
  images?: number;
  unknown?: boolean;
}

export function row(position: number, o: Partial<OrderRow> = {}): OrderRow {
  return {
    position,
    imageId: `img-${position}`,
    thumb: `thumb/img-${position}.webp`,
    file: null,
    screen: "Gameplay / Battle",
    screenType: "gameplay",
    category: "gameplay",
    logo: false,
    message: null,
    headline: "PLAY",
    orientation: "portrait",
    composition: "One in-game screenshot filling the image",
    captures: ["Gameplay / Battle, fills the image, 90% of the image"],
    layer: true,
    state: "analysed",
    note: "",
    ...o,
  };
}

export function deck(appId: string, name: string, f: DeckFlags = {}, ours = false): GameOrder {
  const n = f.images ?? 6;
  const ids = f.ids ?? `${appId}`;
  return {
    appId,
    name,
    ours,
    orderDate: "2026-09-27",
    rows: Array.from({ length: n }, (_, i) => {
      const p = i + 1;
      const first = p === 1;
      return row(p, {
        imageId: `${ids}-${p}`,
        thumb: `thumb/${ids}-${p}.webp`,
        category: first && f.titleArt ? "full_screen_art" : "gameplay",
        composition:
          first && f.titleArt
            ? "Full-screen art (title / loading style)"
            : p === 2 && f.inset
              ? "An in-game screenshot inside marketing art"
              : "One in-game screenshot filling the image",
        logo: !!(first && f.logo),
        orientation: p === 3 && f.landscape ? "landscape" : "portrait",
        state: f.unknown ? "not analysed" : "analysed",
      });
    }),
  };
}

export const pages = (gl: string, hl: string, label: string, games: GameOrder[]): CountryPages => ({
  gl,
  hl,
  label,
  games,
});

export function data(games: GameOrder[], abTests?: ReportData["abTests"]): ReportData {
  return {
    games,
    stage: "core",
    market: "",
    approved: true,
    coverage: { used: 0, total: 0, missing: [] },
    oursVs: null,
    ai: null,
    synthesis: { state: "missing", reason: "", howTo: "" },
    examples: {},
    recProblems: [],
    leftOut: [],
    labels: {},
    fit: null,
    patterns: null,
    ...(abTests ? { abTests } : {}),
  } as unknown as ReportData;
}

export function test_(o: Partial<AbTestCard> & Pick<AbTestCard, "title">): AbTestCard {
  return {
    priority: 1,
    source: "ai",
    hypothesis: "h",
    evidence: [],
    variable: "screenshot",
    variableName: "one screenshot",
    positions: [1],
    countries: [],
    variant: null,
    variantText: "",
    secondVariant: null,
    control: [],
    metric: { name: "installs", meaning: "" },
    guardrail: "",
    setup: {
      kind: "localised",
      languages: [],
      variants: 1,
      audiencePercent: 50,
      line: "old setup",
      notes: [],
    },
    impact: null,
    ...o,
  };
}

export function report(
  countries: CountryReport["countries"],
  o: Partial<CountryReport> = {},
): CountryReport {
  return {
    kind: "countries",
    version: 1,
    type: "compare",
    name: "Japan, South Korea vs 2 competitors",
    generatedAt: "2026-09-29T07:08:42.508Z",
    main: { gl: "us", hl: "en", label: "United States (English)" },
    base: { stage: "core", competitors: 2 },
    banners: [],
    missing: [],
    summary: {
      shortAnswer: "",
      verdicts: [],
      keyActions: [],
      dates: { generated: "", storeFrom: null, storeTo: null, analyses: null },
    },
    countries,
    localisation: null,
    terminology: [],
    crossTerms: [],
    advice: [],
    abTests: { tests: [], leftOut: [], gaps: 0, note: "" },
    sorting: null,
    ...o,
  };
}

export const PLAY: PlayContext = {
  reportMarkets: [],
  projectMarkets: [
    { gl: "us", hl: "en", label: "United States (English)" },
    { gl: "jp", hl: "ja", label: "Japan" },
    { gl: "kr", hl: "ko", label: "South Korea" },
    { gl: "tw", hl: "zh-TW", label: "Taiwan" },
    { gl: "hk", hl: "zh-TW", label: "Hong Kong (Traditional Chinese)" },
    { gl: "th", hl: "th", label: "Thailand" },
  ],
  traffic: {},
  preRegistration: false,
};
