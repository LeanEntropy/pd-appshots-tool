import type { KbFiles } from "../storage/kb-files.ts";
import { stableHash } from "../util/hash.ts";
import { type Kb, loadKb } from "./release.ts";
import { ApprovalsSchema, type Decision, type Entry } from "./schema.ts";
import { type Computed, isTrusted, TRUST_LABEL } from "./trust.ts";

/**
 * The generated review list (decision D8) with the approval rule of decision D4: every entry that
 * could drive a recommendation (2+ independent sources or official, an enforced rule, a policy or
 * regulation) is approved one by one; unverified entries are approved in bulk and can only ever
 * become labelled test ideas. Decisions are saved in kb/approvals.json (in the repo), per entry
 * and content: an entry that changes on a re-import asks again.
 */
const POLICY_TAGS = new Set([
  "regulation",
  "advertising_law",
  "loot_box_disclosure",
  "age_rating",
  "policy_graphics",
  "policy_metadata",
]);

export const entryHash = (e: Entry) => stableHash(e);

export function needsOneByOne(e: Entry, c: Computed): boolean {
  return (
    isTrusted(c.trust) || e.ruleClass === "enforced_rule" || e.tags.some((t) => POLICY_TAGS.has(t))
  );
}

export type ReviewStatus = "pending" | "approved" | "rejected" | "changed";

export interface ReviewItem {
  id: string;
  kind: Entry["kind"];
  claim: string;
  appliesWhen: string;
  facts: Entry["facts"];
  countries: string[];
  stores: string[];
  genres: string[];
  ruleClass: Entry["ruleClass"];
  enforcement: Entry["enforcement"];
  trust: Computed["trust"];
  trustLabel: string;
  origins: number;
  vendorOnly: boolean;
  contested: boolean;
  stale: boolean;
  sources: {
    title: string;
    publisher: string;
    url: string;
    type: string;
    published: string;
    origin: string;
    excerpt: string;
    counted: boolean;
    /** A researcher's snapshot of store listings; the tool's own data replaces it. */
    snapshot: boolean;
  }[];
  counter: { title: string; url: string; excerpt: string }[];
  note: string;
  group: "one" | "bulk";
  status: ReviewStatus;
  hash: string;
}

export interface ReviewList {
  one: ReviewItem[];
  bulk: ReviewItem[];
  counts: { pending: number; approved: number; rejected: number; changed: number };
  problems: string[];
}

export function readApprovals(files: KbFiles): Decision[] {
  const r = ApprovalsSchema.safeParse(files.getJson("approvals.json") ?? { decisions: [] });
  return r.success ? r.data.decisions : [];
}

function item(kb: Kb, e: Entry, decisions: ReadonlyMap<string, Decision>): ReviewItem | null {
  const c = kb.computed.get(e.id);
  if (!c) return null;
  const hash = entryHash(e);
  const d = decisions.get(e.id);
  const status: ReviewStatus = !d ? "pending" : d.contentHash !== hash ? "changed" : d.decision;
  const src = (id: string) => kb.sourceById.get(id);
  return {
    id: e.id,
    kind: e.kind,
    claim: e.claim,
    appliesWhen: e.appliesWhen,
    facts: e.facts,
    countries: e.scope.countries,
    stores: e.scope.store,
    genres: e.scope.genre,
    ruleClass: e.ruleClass,
    enforcement: e.enforcement,
    trust: c.trust,
    trustLabel: TRUST_LABEL[c.trust],
    origins: c.origins,
    vendorOnly: c.vendorOnly,
    contested: c.contested,
    stale: c.stale,
    sources: e.support.map((s) => {
      const x = src(s.sourceId);
      return {
        title: x?.title ?? s.sourceId,
        publisher: x?.publisher ?? "",
        url: x?.url ?? "",
        type: x?.type ?? "",
        published: x?.published ?? "",
        origin: x?.evidenceOrigin ?? "",
        excerpt: s.excerpt,
        counted: !!x && x.fetched && s.fetched,
        snapshot: !!x?.replaceableByToolData,
      };
    }),
    counter: e.counterSupport.map((s) => ({
      title: src(s.sourceId)?.title ?? s.sourceId,
      url: src(s.sourceId)?.url ?? "",
      excerpt: s.excerpt,
    })),
    note: e.researcherNote,
    group: needsOneByOne(e, c) ? "one" : "bulk",
    status,
    hash,
  };
}

/** The review list of the inbox, trusted and policy entries first. */
export function reviewList(files: KbFiles, today: string): ReviewList {
  const kb = loadKb(files, "inbox", today);
  const decisions = new Map(readApprovals(files).map((d) => [d.entryId, d]));
  const rank = { official: 0, established: 1, corroborated: 2, unverified: 3 } as const;
  const items = kb.entries
    .map((e) => item(kb, e, decisions))
    .filter((x): x is ReviewItem => !!x)
    .sort((a, b) => rank[a.trust] - rank[b.trust] || a.id.localeCompare(b.id));
  const counts = { pending: 0, approved: 0, rejected: 0, changed: 0 };
  for (const i of items) counts[i.status]++;
  return {
    one: items.filter((i) => i.group === "one"),
    bulk: items.filter((i) => i.group === "bulk"),
    counts,
    problems: kb.problems,
  };
}

function save(files: KbFiles, next: Decision[]): void {
  files.putJson("approvals.json", {
    decisions: [...next].sort((a, b) => a.entryId.localeCompare(b.entryId)),
  });
}

/** Approve or reject one entry (the list's buttons). Bulk entries may be decided one by one too. */
export function decide(
  files: KbFiles,
  today: string,
  entryId: string,
  decision: Decision["decision"],
  by: string,
  note = "",
): { ok: true; item: ReviewItem } | { ok: false; problem: string } {
  const list = reviewList(files, today);
  const found = [...list.one, ...list.bulk].find((i) => i.id === entryId);
  if (!found)
    return { ok: false, problem: "This entry is no longer in the review list. Reload the page." };
  const d: Decision = {
    entryId,
    contentHash: found.hash,
    decision,
    how: "one",
    by,
    at: new Date().toISOString(),
    note,
  };
  save(files, [...readApprovals(files).filter((x) => x.entryId !== entryId), d]);
  return { ok: true, item: { ...found, status: decision } };
}

/** D4: approve every undecided unverified (bulk) entry at once; returns how many. */
export function approveBulk(files: KbFiles, today: string, by: string): number {
  const list = reviewList(files, today);
  const todo = list.bulk.filter((i) => i.status === "pending" || i.status === "changed");
  if (!todo.length) return 0;
  const at = new Date().toISOString();
  const ids = new Set(todo.map((i) => i.id));
  save(files, [
    ...readApprovals(files).filter((x) => !ids.has(x.entryId)),
    ...todo.map(
      (i): Decision => ({
        entryId: i.id,
        contentHash: i.hash,
        decision: "approved",
        how: "bulk",
        by,
        at,
        note: "",
      }),
    ),
  ]);
  return todo.length;
}
