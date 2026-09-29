import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { citeNumberer } from "../../src/kb/cite.ts";
import { assemble, type Kb, type KbContent } from "../../src/kb/release.ts";
import type { KbRun } from "../../src/kb/run.ts";
import { EntrySchema, SourceSchema } from "../../src/kb/schema.ts";
import { kbFiles } from "../../src/storage/kb-files.ts";

export const TODAY = "2026-09-29";
export const TAGS = [
  "screenshots",
  "first_images",
  "order",
  "captions",
  "orientation",
  "policy_graphics",
  "ranking_claims",
  "deck_length",
  "experiments",
  "test_duration",
  "localisation",
  "script",
  "regulation",
  "roguelike",
  "genre_convention",
  "legibility",
  "typography",
  "lingo",
];
const GP_META = "https://support.google.com/googleplay/android-developer/answer/9898842";
const GP_ASSETS = "https://support.google.com/googleplay/android-developer/answer/9866151";

const src = (
  id: string,
  type: string,
  url: string,
  origin: string,
  extra: Record<string, unknown> = {},
) =>
  SourceSchema.parse({
    id,
    title: `Title ${id}`,
    publisher: `Pub ${id}`,
    url,
    type,
    published: "2025-06",
    accessed: TODAY,
    fetched: true,
    evidenceOrigin: origin,
    ...extra,
  });

export const SOURCES = [
  src("g1", "official", GP_META, "google"),
  src("g2", "official", GP_ASSETS, "google"),
  src("a1", "official", "https://developer.apple.com/app-store/product-page/", "apple"),
  src("v1", "vendor", "https://splitmetrics.example/a", "splitmetrics"),
  src("v2", "vendor", "https://apptweak.example/b", "apptweak"),
  src("v3", "vendor", "https://storemaven.example/c", "storemaven"),
  src("d1", "independent_data", "https://sensortower.example/d", "sensortower"),
  src("d2", "press", "https://news.example/e", "splitmetrics"),
  src("p1", "independent_data", "https://data-ai.example/f", "data.ai", {
    parentOrg: "sensortower",
  }),
  src("c1", "press", "https://press.example/g", "study-x", { commissionedBy: "apptweak" }),
  src("u1", "community", "https://forum.example/h", "unknown:repeated stat"),
  src("u2", "community", "https://blog.example/i", "unknown:another blog"),
  src("jp1", "independent_data", "https://famitsu.example/j", "famitsu"),
  src("s1", "vendor", "https://snippet.example/k", "snippet-org", { fetched: false }),
];

const sup = (sourceId: string, fetched = true) => ({
  sourceId,
  excerpt: `Excerpt from ${sourceId}`,
  excerptType: "paraphrase",
  fetched,
});
type Over = Record<string, unknown>;
export const entry = (
  id: string,
  kind: string,
  support: string[],
  tags: string[],
  over: Over = {},
) =>
  EntrySchema.parse({
    id,
    kind,
    claim: `Claim of ${id}.`,
    scope: {
      store: ["google_play"],
      genre: ["all_games"],
      countries: ["global"],
      position: ["all"],
      asset: ["screenshots"],
    },
    tags,
    support: support.map((s) => sup(s)),
    reviewBy: "2027-06-01",
    ...over,
  });

const enforced = (url: string) => ({
  ruleClass: "enforced_rule",
  enforcement: {
    consequence: "listing rejected or removed",
    exactWording: "Do not use ranking claims.",
    policyUrl: url,
  },
});

export function entries() {
  return [
    entry(
      "gp-enf-1",
      "store_fact",
      ["g1"],
      ["policy_graphics", "ranking_claims", "screenshots"],
      enforced(GP_META),
    ),
    entry("gp-count", "store_fact", ["g2"], ["screenshots", "deck_length"], enforced(GP_ASSETS)),
    entry("gp-guid-1", "store_fact", ["g2"], ["orientation", "first_images"], {
      ruleClass: "official_guidance",
    }),
    entry("exp-fact", "store_fact", ["g1"], ["experiments", "test_duration"], {
      ruleClass: "store_behaviour",
    }),
    entry("h-corr", "heuristic", ["v1", "d1"], ["captions", "first_images"], {
      contradicts: ["h-counter"],
    }),
    entry("h-counter", "heuristic", ["v2", "jp1"], ["captions"]),
    entry("h-est", "heuristic", ["v1", "v2", "d1"], ["order", "first_images"]),
    entry("h-unv", "heuristic", ["v1"], ["orientation"]),
    entry("h-vendor3", "heuristic", ["v1", "v2", "v3"], ["legibility"]),
    entry("jp-note", "market_note", ["jp1", "d1"], ["localisation", "script"], {
      scope: {
        store: ["google_play"],
        genre: ["all_games"],
        countries: ["JP"],
        position: ["all"],
        asset: [],
      },
    }),
    entry("jp-reg", "market_note", ["jp1"], ["regulation"], {
      scope: {
        store: ["google_play"],
        genre: ["all_games"],
        countries: ["JP"],
        position: ["all"],
        asset: [],
      },
    }),
    entry("gn-rogue", "genre_note", ["v1", "d1"], ["roguelike", "genre_convention"], {
      scope: {
        store: ["google_play"],
        genre: ["roguelike"],
        countries: ["global"],
        position: ["all"],
        asset: [],
      },
    }),
    entry("ab-1", "ab_case", ["v1", "d1", "jp1"], ["experiments"], { reviewBy: "" }),
  ];
}

export const DIMS = {
  version: 1,
  map: {
    "^position-[123]": ["first_images"],
    "^variable:order$": ["order"],
    "^layer$": ["captions"],
    "^advice:words$": ["lingo", "localisation"],
  },
};

export function content(over: Partial<KbContent> = {}): KbContent {
  return {
    meta: { version: 1, date: TODAY, contentHash: "", counts: {}, changelog: [] },
    entries: entries(),
    sources: SOURCES,
    tags: TAGS,
    checks: [
      {
        id: "gp-claims",
        kind: "banned_text",
        store: "google_play",
        entryIds: [],
        policyUrls: [GP_META],
        patterns: ["\\bno\\.?\\s?1\\b", "\\bdownload\\s+now\\b"],
        message: "no ranking claims or calls to action",
        confirmedBy: "test",
        note: "",
      },
      {
        id: "gp-count",
        kind: "deck_length",
        store: "google_play",
        entryIds: ["gp-count"],
        policyUrls: [],
        min: 2,
        max: 8,
        message: "2 to 8 screenshots",
        confirmedBy: "test",
        note: "",
      },
    ],
    dimensionTags: DIMS,
    ...over,
  };
}

export const fixtureKb = (over: Partial<KbContent> = {}): Kb => assemble(content(over), TODAY);

export function run(kb: Kb, over: Partial<KbRun> = {}): KbRun {
  return {
    kb,
    hash: kb.hash,
    preset: "normal",
    genres: ["roguelike"],
    store: "google_play",
    market: "US",
    rules: "KB RULES BLOCK",
    capUsd: 0,
    used: { tokens: 0, usd: 0 },
    log: [],
    cite: citeNumberer(kb),
    ...over,
  };
}

/** A temporary kb/ folder with the tag list, dimension map and checks (no entries). */
export function tempKbDir() {
  const root = mkdtempSync(join(tmpdir(), "kb-"));
  const files = kbFiles(root);
  const c = content();
  files.putJson("tags.json", { version: 1, tags: c.tags });
  files.putJson("dimension-tags.json", c.dimensionTags);
  files.putJson("checks.json", { checks: c.checks });
  files.putJson("release.json", {
    version: 0,
    date: "",
    contentHash: "",
    counts: {},
    changelog: [],
  });
  return { root, files };
}
