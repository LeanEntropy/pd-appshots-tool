import { z } from "zod";

/**
 * The knowledge base's files (docs/plan-knowledge-base.md section 2 and the user decisions of
 * 2026-09-29). One entry is ONE atomic claim with every source that supports exactly that claim
 * at that scope. Trust is never typed: code counts independent evidence origins (trust.ts).
 */
export const KINDS = [
  "store_fact",
  "heuristic",
  "market_note",
  "genre_note",
  "ab_case",
  "glossary",
] as const;
export type Kind = (typeof KINDS)[number];

/**
 * D1: official platform material is split into enforced rules (breaking them gets the upload
 * refused or the listing rejected: never recommended against), official guidance (may be
 * overridden when evidence says it helps, said plainly) and store behaviour (how the store works).
 */
export const RULE_CLASSES = [
  "enforced_rule",
  "official_guidance",
  "store_behaviour",
  "none",
] as const;
export type RuleClass = (typeof RULE_CLASSES)[number];

export const SOURCE_TYPES = [
  "official",
  "independent_data",
  "vendor",
  "vendor_case_study",
  "press",
  "talk",
  "community",
  "law",
] as const;

/** Stores a claim can be about (ONE Store: South Korea's local store, for market notes). */
export const STORES = ["google_play", "app_store", "one_store"] as const;
export type Store = (typeof STORES)[number];

export const GENRES = [
  "all_games",
  "roguelike",
  "rpg",
  "idle",
  "survivor_like",
  "casual",
  "strategy",
  "puzzle",
  "apps_general",
] as const;

const COUNTRY = /^(global|[A-Z]{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PUBLISHED = /^(\d{4}(-\d{2}(-\d{2})?)?|unknown)$/;
const ID = /^[a-z0-9][a-z0-9-]{1,60}$/;
const text = (max: number) => z.string().trim().min(1).max(max);

export const SourceSchema = z.strictObject({
  id: z.string().regex(ID),
  title: text(300),
  publisher: text(200),
  url: z.url({ protocol: /^https?$/ }),
  type: z.enum(SOURCE_TYPES),
  published: z.string().regex(PUBLISHED),
  accessed: z.string().regex(DATE),
  /** The page itself was fetched and read (a search snippet does not count). */
  fetched: z.boolean(),
  /**
   * The study, dataset, experiment or authority the claim comes from. "unknown:<what>" when the
   * provenance of a repeated statistic is unknown (all unknown origins together count once).
   */
  evidenceOrigin: text(120),
  parentOrg: z.string().max(120).default(""),
  commissionedBy: z.string().max(120).default(""),
  /** Who confirmed the provenance fields (a person or "agent:<model> <prompt>"). */
  independenceReviewedBy: z.string().max(120).default(""),
  note: z.string().max(1000).default(""),
  /**
   * A researcher's own snapshot of store listings: the tool's own competitor data (downloaded and
   * analysed by code) replaces it wherever the tool has that data. Set at import (kb/import-rules.json).
   */
  replaceableByToolData: z.boolean().default(false),
});
export type Source = z.infer<typeof SourceSchema>;

export const SupportSchema = z.strictObject({
  sourceId: z.string().regex(ID),
  excerpt: text(600),
  excerptType: z.enum(["quote", "paraphrase"]),
  fetched: z.boolean(),
  checkedBy: z.string().max(120).default(""),
});
export type Support = z.infer<typeof SupportSchema>;

export const FactSchema = z.strictObject({
  value: z.union([z.number(), z.string().max(80)]),
  unit: z.string().max(80),
  of: z.string().max(200),
  context: z.string().max(200),
});

export const EnforcementSchema = z.strictObject({
  consequence: text(200),
  exactWording: text(600),
  policyUrl: z.url({ protocol: /^https?$/ }),
});

export const EntrySchema = z
  .strictObject({
    id: z.string().regex(ID),
    kind: z.enum(KINDS),
    claim: text(400),
    ruleClass: z.enum(RULE_CLASSES).default("none"),
    enforcement: EnforcementSchema.nullable().default(null),
    facts: z.array(FactSchema).max(10).default([]),
    appliesWhen: z.string().max(300).default(""),
    scope: z.strictObject({
      store: z.array(z.enum(STORES)).min(1),
      genre: z.array(z.enum(GENRES)).min(1),
      /** "global" or an explicit list of countries; a region is never a scope. */
      countries: z.array(z.string().regex(COUNTRY)).min(1),
      position: z.array(z.string().max(30)).min(1),
      asset: z.array(z.string().max(30)).default([]),
    }),
    tags: z.array(z.string().regex(/^[a-z_]{2,40}$/)).min(1),
    support: z.array(SupportSchema).min(1),
    /** Ids of counter-claim entries (each a full entry with its own sources). */
    contradicts: z.array(z.string().regex(ID)).default([]),
    /** Sources against this claim, kept for review until written up as a counter-claim entry. */
    counterSupport: z.array(SupportSchema).default([]),
    validFor: z.string().max(200).default(""),
    /** A published test's details (game, store, market, control, variant, metric, result ...). */
    abDetail: z.record(z.string(), z.string().max(600)).nullable().default(null),
    /** Past this date the entry is stale: never stated as current. Empty for A/B cases. */
    reviewBy: z.union([z.string().regex(DATE), z.literal("")]).default(""),
    addedBy: z.string().max(120).default(""),
    useFor: z.string().max(400).default(""),
    researcherNote: z.string().max(1000).default(""),
    retired: z.boolean().default(false),
  })
  .superRefine((e, ctx) => {
    if (e.ruleClass === "enforced_rule" && !e.enforcement)
      ctx.addIssue({
        code: "custom",
        path: ["enforcement"],
        message: "an enforced rule needs its consequence, exact wording and policy page",
      });
    if (e.ruleClass !== "none" && e.kind !== "store_fact")
      ctx.addIssue({
        code: "custom",
        path: ["ruleClass"],
        message: "only store facts carry an official rule class",
      });
    if (e.scope.countries.includes("global") && e.scope.countries.length > 1)
      ctx.addIssue({
        code: "custom",
        path: ["scope", "countries"],
        message: '"global" cannot be combined with countries',
      });
  });
export type Entry = z.infer<typeof EntrySchema>;

export const EntryFileSchema = z.strictObject({
  file: z.string().regex(/^[a-z0-9-]{1,60}$/),
  entries: z.array(EntrySchema),
});
export const SourceFileSchema = z.strictObject({ sources: z.array(SourceSchema) });

/** kb/tags.json: the fixed, versioned tag list. */
export const TagsSchema = z.strictObject({
  version: z.number().int().min(1),
  tags: z.array(z.string().regex(/^[a-z_]{2,40}$/)).min(1),
});

/**
 * kb/checks.json: machine checks of enforced rules. A check is active only when a person has
 * confirmed that its patterns match the policy's exact wording (confirmedBy) AND a released,
 * enforced, not retired entry backs it (by id, or by its policy page), so every rejection
 * traces to a policy the user approved.
 */
const checkBase = {
  id: z.string().regex(ID),
  store: z.enum(STORES),
  entryIds: z.array(z.string().regex(ID)).default([]),
  /** Policy pages (prefix match on an enforced entry's enforcement.policyUrl). */
  policyUrls: z.array(z.url({ protocol: /^https?$/ })).default([]),
  message: text(300),
  confirmedBy: z.string().max(120).default(""),
  note: z.string().max(600).default(""),
};
export const CheckSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...checkBase,
    kind: z.literal("banned_text"),
    /** Case-insensitive regular expressions (unicode) matched against every image text. */
    patterns: z.array(z.string().min(1).max(200)).min(1),
  }),
  z.strictObject({
    ...checkBase,
    kind: z.literal("deck_length"),
    min: z.number().int().min(0),
    max: z.number().int().min(1),
  }),
]);
export type EnforcedCheck = z.infer<typeof CheckSchema>;
export const ChecksSchema = z.strictObject({ checks: z.array(CheckSchema) });

/** kb/approvals.json: the user's decisions, per entry and content (a changed entry asks again). */
export const DecisionSchema = z.strictObject({
  entryId: z.string().regex(ID),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  decision: z.enum(["approved", "rejected"]),
  /** "one" = approved on its own; "bulk" = with the other unverified entries (D4). */
  how: z.enum(["one", "bulk"]),
  by: z.string().max(80),
  at: z.string().max(40),
  note: z.string().max(500).default(""),
});
export type Decision = z.infer<typeof DecisionSchema>;
export const ApprovalsSchema = z.strictObject({ decisions: z.array(DecisionSchema) });

/** kb/release.json: the release the tool reads (promotion step: promote.ts). */
export const ReleaseMetaSchema = z.strictObject({
  version: z.number().int().min(0),
  date: z.union([z.string().regex(DATE), z.literal("")]),
  contentHash: z.string().max(64),
  counts: z.record(z.string(), z.number().int()),
  changelog: z.array(
    z.strictObject({
      version: z.number().int(),
      date: z.string().regex(DATE),
      added: z.array(z.string()),
      changed: z.array(z.string()),
      removed: z.array(z.string()),
    }),
  ),
});
export type ReleaseMeta = z.infer<typeof ReleaseMetaSchema>;
