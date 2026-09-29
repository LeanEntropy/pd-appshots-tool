import he from "he";
import type { KbFiles } from "../storage/kb-files.ts";
import { entryHash, officialSources } from "./official.ts";
import { loadKb } from "./release.ts";
import { syncOfficial } from "./review.ts";
import { dateProblem, REFRESH_FILE, type RefreshLog, readRefresh } from "./source-date.ts";

/**
 * `npm run kb -- refresh-official` (free, no AI): re-fetches every official page behind an
 * official entry (plain GET, one at a time, with a pause), records the date in
 * kb/official-refresh.json and marks entries whose page is gone or moved, or whose quoted wording
 * is no longer on it, as changed (one-by-one list). The rest are verified today and approved
 * automatically again (D4, official.ts). A page that cannot be reached is not verified. Every
 * undated source is fetched too, so the date rule (source-date.ts) can count it: live, and the
 * date its page states.
 */
export interface Page {
  status: number;
  url: string;
  text: string;
}
export type Fetcher = (url: string) => Promise<Page>;

type PageState = {
  status: "ok" | "gone" | "moved" | "error";
  http: number;
  final: string;
  norm: string;
  date: string;
};

export interface RefreshSummary {
  pages: number;
  byStatus: Record<PageState["status"], number>;
  checked: number;
  changed: { id: string; problems: string[] }[];
  unreachable: string[];
  current: number;
  needsCheck: number;
  /** Undated sources checked, and how many of them count now. */
  undated: number;
  undatedKept: number;
}

const httpFetch: Fetcher = async (url) => {
  const r = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; pd-appstore-tool knowledge-base refresh)",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  return { status: r.status, url: r.url || url, text: r.ok ? await r.text() : "" };
};

/** Letters and digits only, lower case: wording survives markup, quotes and spacing changes. */
export const normText = (s: string) =>
  he
    .decode(s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

export function pageText(html: string): string {
  return normText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

/**
 * Every part of a quote is still on the page: split at "..." and between sentences, since a quote
 * may join sentences from different places on the page.
 */
export function quoteOnPage(norm: string, quote: string): boolean {
  const parts = quote
    .split(/\.{3}|…|(?<=[.;!?])\s+/)
    .map(normText)
    .filter((p) => p.length >= 12);
  const all = parts.length ? parts : [normText(quote)];
  return all.every((p) => norm.includes(p));
}

const place = (u: string) => {
  try {
    const x = new URL(u);
    return `${x.hostname.toLowerCase()}${x.pathname.replace(/\/+$/, "")}`;
  } catch {
    return u;
  }
};

/** Google's help pages in English, whatever the country the request comes from. */
function requestUrl(url: string): string {
  const u = new URL(url);
  if (u.hostname === "support.google.com" && !u.searchParams.has("hl"))
    u.searchParams.set("hl", "en");
  return u.toString();
}

/**
 * The latest publication or update date the page states in its markup (meta tags, JSON-LD,
 * <time datetime>); "" when none. A copyright year in the footer does not count.
 */
export function pageDate(html: string): string {
  const found: string[] = [];
  const iso = /(\d{4}-\d{2}-\d{2})/;
  for (const m of html.matchAll(/"date(?:Published|Modified|Created)"\s*:\s*"([^"]+)"/g)) {
    const d = iso.exec(m[1] ?? "")?.[1];
    if (d) found.push(d);
  }
  const names =
    /(?:property|name|itemprop)\s*=\s*["'](?:article:(?:published|modified)_time|og:updated_time|date(?:published|modified)?|last-modified|dc\.date(?:\.\w+)?)["']/i;
  for (const m of html.matchAll(/<meta\b[^>]*>/gi))
    if (names.test(m[0])) {
      const d = iso.exec(/content\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1] ?? "")?.[1];
      if (d) found.push(d);
    }
  for (const m of html.matchAll(/<time\b[^>]*datetime\s*=\s*["']([^"']+)["']/gi)) {
    const d = iso.exec(m[1] ?? "")?.[1];
    if (d) found.push(d);
  }
  return (
    found
      .filter((d) => d >= "1995-01-01" && d <= "2100-01-01")
      .sort()
      .at(-1) ?? ""
  );
}

async function load(url: string, fetcher: Fetcher): Promise<PageState> {
  const fail = (status: PageState["status"], http: number, final: string): PageState => ({
    status,
    http,
    final,
    norm: "",
    date: "",
  });
  try {
    const p = await fetcher(requestUrl(url));
    if (p.status === 404 || p.status === 410) return fail("gone", p.status, p.url);
    if (p.status < 200 || p.status >= 300) return fail("error", p.status, p.url);
    if (place(p.url) !== place(url)) return fail("moved", p.status, p.url);
    return {
      status: "ok",
      http: p.status,
      final: p.url,
      norm: pageText(p.text),
      date: pageDate(p.text),
    };
  } catch (e) {
    return fail("error", 0, e instanceof Error ? e.message.slice(0, 200) : "");
  }
}

const short = (s: string) => (s.length > 90 ? `${s.slice(0, 87)}...` : s);

export async function refreshOfficial(
  files: KbFiles,
  today: string,
  opts: { fetcher?: Fetcher; delayMs?: number; progress?: (line: string) => void } = {},
): Promise<RefreshSummary> {
  const fetcher = opts.fetcher ?? httpFetch;
  const delayMs = opts.delayMs ?? 1500;
  // Everything imported (before the date rule), so undated sources can be checked.
  const raw = loadKb(files, "inbox", today, { raw: true });
  const rawOfficial = raw.entries.filter((e) => raw.computed.get(e.id)?.trust === "official");
  const toCheck = new Map<string, string>();
  for (const e of rawOfficial) {
    for (const s of officialSources(raw, e)) toCheck.set(s.id, s.url);
    if (e.enforcement) toCheck.set(`policy:${e.id}`, e.enforcement.policyUrl);
  }
  const undated = raw.sources.filter((s) => s.published === "unknown");
  for (const s of undated) toCheck.set(s.id, s.url);
  const pages = new Map<string, PageState>();
  for (const url of [...new Set(toCheck.values())].sort()) {
    if (pages.size && delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const p = await load(url, fetcher);
    pages.set(url, p);
    opts.progress?.(
      `  ${p.status.padEnd(5)} ${p.http || "-"} ${url}${p.status === "moved" ? ` -> ${p.final}` : ""}${p.date ? ` (dated ${p.date})` : ""}`,
    );
  }
  const log: RefreshLog = readRefresh(files);
  log.lastRun = today;
  for (const [id, url] of toCheck) {
    const p = pages.get(url);
    if (!p || id.startsWith("policy:")) continue;
    log.sources[id] = {
      url,
      checkedAt: today,
      status: p.status,
      httpStatus: p.http,
      finalUrl: p.final,
      verified: p.status === "ok" ? today : (log.sources[id]?.verified ?? ""),
      pageDate: p.date || (log.sources[id]?.pageDate ?? ""),
    };
  }
  files.putJson(REFRESH_FILE, log);
  // The official entries as the tool counts them (date rule applied with this refresh).
  const kb = loadKb(files, "inbox", today);
  const official = kb.entries.filter((e) => kb.computed.get(e.id)?.trust === "official");
  const byStatus = { ok: 0, gone: 0, moved: 0, error: 0 };
  for (const p of pages.values()) byStatus[p.status]++;
  const summary: RefreshSummary = {
    pages: pages.size,
    byStatus,
    checked: 0,
    changed: [],
    unreachable: [],
    current: 0,
    needsCheck: 0,
    undated: undated.length,
    undatedKept: undated.filter((s) => !dateProblem(s, log)).length,
  };
  for (const e of official) {
    const problems: string[] = [];
    let unreachable = false;
    const check = (url: string, quote: string | null) => {
      const p = pages.get(url);
      if (!p || p.status === "error") unreachable = true;
      else if (p.status === "gone") problems.push(`page gone (HTTP ${p.http}): ${url}`);
      else if (p.status === "moved") problems.push(`page moved: ${url} -> ${p.final}`);
      else if (quote !== null && !quoteOnPage(p.norm, quote))
        problems.push(`quoted wording no longer on ${url}: "${short(quote)}"`);
    };
    for (const s of e.support) {
      const src = officialSources(kb, e).find((x) => x.id === s.sourceId);
      if (src) check(src.url, s.excerptType === "quote" ? s.excerpt : null);
    }
    if (e.enforcement) check(e.enforcement.policyUrl, e.enforcement.exactWording);
    const unique = [...new Set(problems)];
    if (unique.length) summary.changed.push({ id: e.id, problems: unique });
    if (unreachable) summary.unreachable.push(e.id);
    if (unique.length || !unreachable) {
      log.entries[e.id] = { contentHash: entryHash(e), checkedAt: today, problems: unique };
      summary.checked++;
    }
  }
  files.putJson(REFRESH_FILE, log);
  const s = syncOfficial(files, today);
  summary.current = s.current;
  summary.needsCheck = s.needsCheck;
  return summary;
}
