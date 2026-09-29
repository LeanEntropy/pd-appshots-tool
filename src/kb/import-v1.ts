import { sha256 } from "../util/hash.ts";

/**
 * The older seed format (kb/seed-v1: sources inside each entry, trust typed by the researcher,
 * no evidence origins, regions as markets). Converted conservatively: typed trust is ignored,
 * every source's provenance is "unknown" until a reviewer sets it (so all of them together count
 * as one origin), no official rule class is guessed, and a region is not turned into countries.
 */
type Raw = Record<string, unknown>;

const TAG_RENAMES: Record<string, string> = {
  first_impression: "first_images",
  cpp_csl: "custom_listing",
  social: "social_proof",
  ranking: "ranking_claims",
  price: "price_text",
  lootbox: "loot_box_disclosure",
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown) => arr(v).filter((x): x is string => typeof x === "string");

export interface Converted {
  entry: Raw | null;
  sources: Raw[];
  reasons: string[];
}

const PUBLISHED = /^(\d{4}(-\d{2}(-\d{2})?)?|unknown)$/;

/** One v1 entry as a v2-shaped entry plus its sources (validated afterwards like any entry). */
export function convertV1(e: Raw, knownTags: ReadonlySet<string>): Converted {
  const reasons: string[] = [];
  const id = `v1-${str(e.id).toLowerCase()}`;
  const scope = (e.scope ?? {}) as Raw;
  const markets = strs(scope.market);
  const regions = markets.filter((m) => m !== "global" && !/^[A-Z]{2}$/.test(m));
  if (regions.length)
    reasons.push(
      `the market is a region (${regions.join(", ")}), not a country list; list the countries its evidence covers`,
    );
  const sources: Raw[] = [];
  const support: Raw[] = [];
  for (const s of arr(e.sources) as Raw[]) {
    const url = str(s.url);
    const sid = `v1s-${sha256(url || str(s.title)).slice(0, 10)}`;
    const derived = str(s.derived_from);
    const published = PUBLISHED.test(str(s.published)) ? str(s.published) : "unknown";
    sources.push({
      id: sid,
      title: str(s.title) || url,
      publisher: str(s.publisher) || "unknown",
      url,
      type: str(s.source_type),
      published,
      accessed: str(s.accessed) || "2026-09-29",
      fetched: s.fetched === true,
      evidenceOrigin: `unknown:not reviewed (${str(s.publisher) || "unknown"})`,
      note: [str(s.note), derived ? `Repeats: ${derived}.` : ""]
        .filter(Boolean)
        .join(" ")
        .slice(0, 1000),
    });
    support.push({
      sourceId: sid,
      excerpt: (str(s.note) || "(no note)").slice(0, 600),
      excerptType: "paraphrase",
      fetched: s.fetched === true,
      checkedBy: "seed v1 (not re-checked)",
    });
  }
  const tags = [
    ...new Set(
      strs(e.tags)
        .map((t) => TAG_RENAMES[t] ?? t)
        .filter((t) => knownTags.has(t)),
    ),
  ];
  if (!tags.length) reasons.push("none of its tags is on the tag list");
  const notes = [
    str(e.specifics) ? `Specifics: ${str(e.specifics)}` : "",
    arr(e.counter_evidence).length
      ? `Counter-evidence: ${(arr(e.counter_evidence) as Raw[]).map((c) => `${str(c.note)} ${str(c.url)}`.trim()).join(" | ")}`
      : "",
    str(e.confidence) ? `Researcher confidence: ${str(e.confidence)}.` : "",
    "Older seed format: the sources' provenance is not reviewed yet.",
  ];
  const entry: Raw = {
    id,
    kind: str(e.kind),
    claim: str(e.claim),
    scope: {
      store: strs(scope.store),
      genre: strs(scope.genre),
      countries: markets,
      position: strs(scope.position).length ? strs(scope.position) : ["all"],
      asset: [],
    },
    tags,
    support,
    reviewBy: str(e.kind) === "ab_case" ? "" : str(e.review_by),
    addedBy: "seed v1",
    useFor: str(e.use_for).slice(0, 400),
    researcherNote: notes.filter(Boolean).join(" ").slice(0, 1000),
  };
  return { entry: reasons.length ? null : entry, sources, reasons };
}

/** Is this parsed file in the older format? (entries carry their sources inline) */
export function isV1File(json: unknown): boolean {
  const entries = arr((json as Raw | null)?.entries);
  return entries.length > 0 && Array.isArray((entries[0] as Raw).sources);
}
