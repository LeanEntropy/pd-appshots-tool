import type { Entry, Source, Store } from "./schema.ts";

/**
 * Trust is counted, never typed (user rule, 2026-09-29): no single source is trusted. Code counts
 * the independent evidence origins among an entry's support records; reviewers decide what the
 * origins are (source fields), code never guesses independence from URLs.
 *
 * - unverified: 1 origin (or none counted). Only a labelled test idea.
 * - corroborated: 2+ origins. May be stated as fact and back a recommendation with the data.
 * - established: 3+ origins, at least one official, independent-data or law source, not vendor only.
 * - official (decision D1): a store fact that states the platform's own spec, policy or behaviour,
 *   backed by a fetched official page of that platform. Trusted on its own.
 */
export const TRUST_LEVELS = ["unverified", "corroborated", "established", "official"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

export interface Computed {
  trust: TrustLevel;
  /** Independent evidence origins among the counted support. */
  origins: number;
  /** Every counted source is a vendor or a vendor's case study. */
  vendorOnly: boolean;
  /** A linked counter-claim is corroborated or better (set by computeAll). */
  contested: boolean;
  stale: boolean;
}

/** The platform an official page belongs to, from its host (officialness, not independence). */
export function platformOf(url: string): Store | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const on = (d: string) => host === d || host.endsWith(`.${d}`);
  if (
    [
      "play.google.com",
      "support.google.com",
      "developer.android.com",
      "android-developers.googleblog.com",
      "developers.google.com",
      "blog.google",
      "googleblog.com",
    ].some(on)
  )
    return "google_play";
  if (on("apple.com")) return "app_store";
  return null;
}

/** Union-find over origin names: one study, its parent organisation and its sponsor count once. */
function originGroups(sources: readonly Source[]): number {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k) ?? k;
    if (p === k) return k;
    const root = find(p);
    parent.set(k, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const norm = (s: string) => s.trim().toLowerCase();
  const roots: string[] = [];
  for (const s of sources) {
    // Unknown provenance: all of them together count once.
    const origin = norm(s.evidenceOrigin).startsWith("unknown")
      ? "unknown"
      : norm(s.evidenceOrigin);
    const key = `o:${origin}`;
    parent.set(key, parent.get(key) ?? key);
    if (s.parentOrg.trim()) union(key, `o:${norm(s.parentOrg)}`);
    if (s.commissionedBy.trim()) union(key, `o:${norm(s.commissionedBy)}`);
    roots.push(key);
  }
  return new Set(roots.map(find)).size;
}

const VENDOR = new Set(["vendor", "vendor_case_study"]);
const STRONG = new Set(["official", "independent_data", "law"]);

/** The sources whose support counts: fetched page and fetched support record, known source. */
export function countedSources(e: Entry, sources: ReadonlyMap<string, Source>): Source[] {
  const out = new Map<string, Source>();
  for (const s of e.support) {
    const src = sources.get(s.sourceId);
    if (src && s.fetched && src.fetched) out.set(src.id, src);
  }
  return [...out.values()];
}

/** D1: an official page of every store the entry is about backs this store fact. */
function isOfficial(e: Entry, counted: readonly Source[]): boolean {
  if (e.kind !== "store_fact" || e.ruleClass === "none") return false;
  const platforms = new Set(
    counted.filter((s) => s.type === "official").map((s) => platformOf(s.url)),
  );
  return e.scope.store.every((st) => platforms.has(st));
}

/** One entry's trust, before counter-claims are looked at. */
export function computeOne(
  e: Entry,
  sources: ReadonlyMap<string, Source>,
  today: string,
): Computed {
  const counted = countedSources(e, sources);
  const origins = counted.length ? originGroups(counted) : 0;
  const vendorOnly = counted.length > 0 && counted.every((s) => VENDOR.has(s.type));
  const stale = e.reviewBy !== "" && e.reviewBy < today;
  let trust: TrustLevel = "unverified";
  if (isOfficial(e, counted)) trust = "official";
  // A published test is one case by nature: it illustrates, it never establishes.
  else if (e.kind === "ab_case") trust = "unverified";
  else if (origins >= 3 && !vendorOnly && counted.some((s) => STRONG.has(s.type)))
    trust = "established";
  else if (origins >= 2) trust = "corroborated";
  return { trust, origins, vendorOnly, contested: false, stale };
}

const TRUSTED = new Set<TrustLevel>(["corroborated", "established", "official"]);
export const isTrusted = (t: TrustLevel) => TRUSTED.has(t);

/** Every entry's trust; an entry is contested when a linked counter-claim is corroborated+. */
export function computeAll(
  entries: readonly Entry[],
  sources: ReadonlyMap<string, Source>,
  today: string,
): Map<string, Computed> {
  const out = new Map(entries.map((e) => [e.id, computeOne(e, sources, today)]));
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string) => links.set(a, (links.get(a) ?? new Set()).add(b));
  for (const e of entries)
    for (const c of e.contradicts) {
      link(e.id, c);
      link(c, e.id);
    }
  for (const e of entries) {
    const c = out.get(e.id);
    if (!c) continue;
    const counters = [...(links.get(e.id) ?? [])].map((id) => out.get(id));
    c.contested = counters.some((x) => !!x && isTrusted(x.trust));
  }
  return out;
}

/** May this entry back a recommendation or be stated as fact? (D2, D4, freshness rule) */
export function canDrive(e: Entry, c: Computed): boolean {
  if (!isTrusted(c.trust) || c.contested) return false;
  // A stale store fact is never stated as current.
  if (c.stale && e.kind === "store_fact") return false;
  return true;
}

/** Plain names for the user (no codes). */
export const TRUST_LABEL: Record<TrustLevel, string> = {
  unverified: "Unverified (one source)",
  corroborated: "Corroborated (2+ independent sources)",
  established: "Established (3+ independent sources)",
  official: "Official platform rule or spec",
};
