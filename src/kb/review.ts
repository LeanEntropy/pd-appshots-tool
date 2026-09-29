import type { KbFiles } from "../storage/kb-files.ts";
import { applyOfficial, entryHash, type OfficialState, officialStates } from "./official.ts";
import { type Kb, loadKb } from "./release.ts";
import { ApprovalsSchema, type Decision, type Entry } from "./schema.ts";
import { readRefresh } from "./source-date.ts";
import { type Computed, isTrusted, TRUST_LABEL } from "./trust.ts";

/**
 * The generated review list (decision D8) with the approval rule of decision D4: every entry that
 * could drive a recommendation (2+ independent sources or official, an enforced rule, a policy or
 * regulation) is approved one by one; unverified entries are approved in bulk and can only ever
 * become labelled test ideas. Current official entries (Google Play's or Apple's own pages) are
 * approved automatically and listed apart, for reference (official.ts); an official entry whose
 * page changed goes to the one-by-one list. Decisions are saved in kb/approvals.json (in the repo),
 * per entry and content: an entry that changes on a re-import asks again.
 */
const POLICY_TAGS = new Set([
  "regulation",
  "advertising_law",
  "loot_box_disclosure",
  "age_rating",
  "policy_graphics",
  "policy_metadata",
]);

export { entryHash };

export function needsOneByOne(e: Entry, c: Computed): boolean {
  return (
    isTrusted(c.trust) || e.ruleClass === "enforced_rule" || e.tags.some((t) => POLICY_TAGS.has(t))
  );
}

export type ReviewStatus = "pending" | "approved" | "rejected" | "changed" | "needs_check";

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
  group: "auto" | "one" | "bulk";
  status: ReviewStatus;
  /** How the decision was made ("" = not decided). */
  how: Decision["how"] | "";
  decidedAt: string;
  /** Official entries only: current, needs a freshness check, or changed at the last refresh. */
  official: OfficialState | null;
  /** Linked counter-claims not decided yet: the entry is held back from a release until they are. */
  waitsFor: string[];
  hash: string;
}

export interface ReviewList {
  /** Current official entries, approved automatically, and those needing a freshness check. */
  auto: ReviewItem[];
  one: ReviewItem[];
  bulk: ReviewItem[];
  counts: {
    pending: number;
    approved: number;
    rejected: number;
    changed: number;
    needs_check: number;
  };
  problems: string[];
}

export function readApprovals(files: KbFiles): Decision[] {
  const r = ApprovalsSchema.safeParse(files.getJson("approvals.json") ?? { decisions: [] });
  return r.success ? r.data.decisions : [];
}

interface Ctx {
  kb: Kb;
  decisions: ReadonlyMap<string, Decision>;
  states: ReadonlyMap<string, OfficialState>;
  links: ReadonlyMap<string, ReadonlySet<string>>;
}

function decidedOk(ctx: Ctx, id: string): boolean {
  const d = ctx.decisions.get(id);
  const e = ctx.kb.byId.get(id);
  if (!d || !e) return false;
  return d.decision === "rejected" || d.contentHash === entryHash(e);
}

function item(ctx: Ctx, e: Entry): ReviewItem | null {
  const { kb } = ctx;
  const c = kb.computed.get(e.id);
  if (!c) return null;
  const hash = entryHash(e);
  const d = ctx.decisions.get(e.id);
  const official = ctx.states.get(e.id) ?? null;
  let status: ReviewStatus = official?.state === "needs_check" ? "needs_check" : "pending";
  if (d) status = d.contentHash !== hash ? "changed" : d.decision;
  let group: ReviewItem["group"] = needsOneByOne(e, c) ? "one" : "bulk";
  if (official) group = official.state === "changed" ? "one" : "auto";
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
    group,
    status,
    how: d?.how ?? "",
    decidedAt: d?.at ?? "",
    official,
    waitsFor: [...(ctx.links.get(e.id) ?? [])].filter((x) => !decidedOk(ctx, x)).sort(),
    hash,
  };
}

/** The decisions with D4 applied to the inbox (what the list shows and a release uses). */
function effective(files: KbFiles, today: string) {
  const kb = loadKb(files, "inbox", today);
  const states = officialStates(kb, readRefresh(files), today);
  const saved = readApprovals(files);
  return { kb, states, saved, decisions: applyOfficial(kb, saved, states, today) };
}

/**
 * Writes the automatic approvals of current official entries (and withdraws those that are no
 * longer current) to kb/approvals.json; run on import, release and refresh. Returns the decisions
 * and how many official entries are in each state.
 */
export function syncOfficial(
  files: KbFiles,
  today: string,
  write = true,
): { decisions: Decision[]; current: number; needsCheck: number; changed: number } {
  const { states, saved, decisions } = effective(files, today);
  if (write && JSON.stringify(sortDecisions(saved)) !== JSON.stringify(sortDecisions(decisions)))
    save(files, decisions);
  const n = (s: OfficialState["state"]) => [...states.values()].filter((x) => x.state === s).length;
  return { decisions, current: n("current"), needsCheck: n("needs_check"), changed: n("changed") };
}

/** The review list of the inbox, trusted and policy entries first. */
export function reviewList(files: KbFiles, today: string): ReviewList {
  const { kb, states, decisions } = effective(files, today);
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => links.set(a, (links.get(a) ?? new Set()).add(b));
  for (const e of kb.entries)
    for (const x of e.contradicts) {
      link(e.id, x);
      link(x, e.id);
    }
  const ctx: Ctx = { kb, decisions: new Map(decisions.map((d) => [d.entryId, d])), states, links };
  const rank = { official: 0, established: 1, corroborated: 2, unverified: 3 } as const;
  const items = kb.entries
    .map((e) => item(ctx, e))
    .filter((x): x is ReviewItem => !!x)
    .sort((a, b) => rank[a.trust] - rank[b.trust] || a.id.localeCompare(b.id));
  const counts = { pending: 0, approved: 0, rejected: 0, changed: 0, needs_check: 0 };
  for (const i of items) counts[i.status]++;
  return {
    auto: items.filter((i) => i.group === "auto"),
    one: items.filter((i) => i.group === "one"),
    bulk: items.filter((i) => i.group === "bulk"),
    counts,
    problems: kb.problems,
  };
}

const sortDecisions = (list: readonly Decision[]) =>
  [...list].sort((a, b) => a.entryId.localeCompare(b.entryId));

function save(files: KbFiles, next: Decision[]): void {
  files.putJson("approvals.json", { decisions: sortDecisions(next) });
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
  const found = [...list.auto, ...list.one, ...list.bulk].find((i) => i.id === entryId);
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
  const rest = syncOfficial(files, today, false).decisions.filter((x) => x.entryId !== entryId);
  save(files, [...rest, d]);
  return { ok: true, item: { ...found, status: decision, how: "one", decidedAt: d.at } };
}

/** D4: approve every undecided unverified (bulk) entry at once; returns how many. */
export function approveBulk(files: KbFiles, today: string, by: string): number {
  const list = reviewList(files, today);
  const todo = list.bulk.filter((i) => i.status === "pending" || i.status === "changed");
  if (!todo.length) return 0;
  const at = new Date().toISOString();
  const ids = new Set(todo.map((i) => i.id));
  save(files, [
    ...syncOfficial(files, today, false).decisions.filter((x) => !ids.has(x.entryId)),
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
