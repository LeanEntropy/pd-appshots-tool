import type { Kb } from "./release.ts";
import { countedSources, platformOf } from "./trust.ts";

/**
 * Citation marks (user rule, 2026-09-29): sources never appear as text. A marker such as [1]
 * shows a tooltip with ONLY the source link(s), opening in a new tab: no trust level, dates,
 * publishers or anything else. Numbers run in order of first use across the report.
 */
export interface Cite {
  n: number;
  links: string[];
}

/** http(s) links only; anything else is never rendered. */
export const safeLink = (u: string) => {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch {
    return null;
  }
};

/** The links behind one entry: its counted sources, and the policy page of an enforced rule. */
export function linksOf(kb: Kb, entryId: string): string[] {
  const e = kb.byId.get(entryId);
  if (!e) return [];
  const urls = [
    ...(e.enforcement ? [e.enforcement.policyUrl] : []),
    ...countedSources(e, kb.sourceById)
      .sort((a, b) => Number(!!platformOf(b.url)) - Number(!!platformOf(a.url)))
      .map((s) => s.url),
  ];
  return [...new Set(urls.map(safeLink).filter((u): u is string => !!u))];
}

/** Numbers citations across a report: the same entry keeps its number everywhere. */
export function citeNumberer(kb: Kb) {
  const numbers = new Map<string, number>();
  return (entryIds: readonly string[]): Cite[] =>
    entryIds.flatMap((id) => {
      const links = linksOf(kb, id);
      if (!links.length) return [];
      let n = numbers.get(id);
      if (n === undefined) {
        n = numbers.size + 1;
        numbers.set(id, n);
      }
      return [{ n, links }];
    });
}

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The marker's HTML (server side; view/kb-cite.ts has the page's own copy): a superscript [n]
 * whose tooltip holds only the links, each opening in a new tab.
 */
export function citeHtml(c: Cite): string {
  const links = c.links
    .map(safeLink)
    .filter((u): u is string => !!u)
    .map(
      (u) => `<a href="${escHtml(u)}" target="_blank" rel="noopener noreferrer">${escHtml(u)}</a>`,
    )
    .join("");
  return links
    ? `<sup class="kb-cite" tabindex="0">[${c.n}]<span class="kb-cite-tip" role="tooltip">${links}</span></sup>`
    : "";
}
