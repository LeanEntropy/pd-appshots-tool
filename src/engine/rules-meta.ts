import { brandOf } from "../analysis/brand.ts";
import { allKeys, phrases } from "../analysis/keywords.ts";
import { appLevel, localised } from "./rules-meta-app.ts";
import {
  chars,
  LIMITS,
  levelFor,
  type MetaDirective,
  type MetaGroup,
  type MetaInput,
  type MetaResult,
  tagsOf,
} from "./rules-meta-types.ts";
import { evidenceOf, evidenceText, type Game } from "./strength.ts";
import { type Theme, themeLabel, themesOf } from "./themes.ts";

export * from "./rules-meta-types.ts";

function perMarket(x: MetaInput, m: { gl: string; hl: string; label: string }): MetaDirective[] {
  const ours = x.text(x.ours.appId, m.gl, m.hl);
  const theirs = x.competitors.flatMap((g) => {
    const o = x.text(g.appId, m.gl, m.hl);
    return o ? [{ g, o }] : [];
  });
  if (!ours || theirs.length < 2) return [];
  const games = theirs.map((t) => t.g);
  const out: MetaDirective[] = [];
  // Words in exactly one competitor's brand (e.g. "vita", "blast"): names, never terms to copy.
  const brandCount = new Map<string, number>();
  for (const t of theirs)
    for (const k of new Set(phrases(brandOf(t.o.title ?? ""), m.hl).keys()))
      if (!k.includes(" ")) brandCount.set(k, (brandCount.get(k) ?? 0) + 1);
  const brandWords = new Set([...brandCount].filter(([, n]) => n === 1).map(([k]) => k));
  const tagWords = new Set(
    theirs.flatMap((t) => tagsOf(t.o)).flatMap((n) => [...phrases(n, m.hl).keys()]),
  );
  const count = (texts: { g: Game; t: string }[], skip: (k: string) => boolean) => {
    const by = new Map<string, Game[]>();
    for (const { g, t } of texts)
      for (const [k] of phrases(t, m.hl))
        if (!skip(k) && k.split(" ").length <= 2) by.set(k, [...(by.get(k) ?? []), g]);
    return [...by].map(([k, gs]) => ({
      k,
      e: evidenceOf([...new Map(gs.map((g) => [g.appId, g])).values()], games, x.leaders),
    }));
  };
  // Title: majority terms missing from our title.
  const ourTitle = ours.title ?? "";
  const have = new Set(phrases(ourTitle, m.hl).keys());
  const titleTerms = count(
    theirs.map((t) => ({ g: t.g, t: t.o.title ?? "" })),
    (k) => brandWords.has(k),
  )
    .filter((r) => r.e.n >= 2 && r.e.n * 2 > r.e.M)
    .sort((a, b) => b.e.n - a.e.n);
  const missing = titleTerms.filter((r) => !have.has(r.k));
  const len = chars(ourTitle);
  if (missing[0])
    out.push({
      id: "",
      field: "title",
      level: levelFor(missing[0].e),
      candidate: false,
      evidence: missing[0].e,
      title: `Title: add "${missing[0].k}"`,
      text: `Title "${ourTitle}" (${len} of ${LIMITS.title}) lacks "${missing.map((r) => r.k).join('", "')}" (${evidenceText(missing[0].e)} carry it).${len + missing[0].k.length + 1 > LIMITS.title ? " It does not fit as is: shorten the rest first." : ""}`,
      values: missing.map((r) => r.k),
      notes: [],
    });
  else if (titleTerms[0])
    out.push({
      id: "",
      field: "title",
      level: "keep",
      candidate: false,
      evidence: titleTerms[0].e,
      title: "Title: keep",
      text: `Title "${ourTitle}" (${len} of ${LIMITS.title}) already carries the core term "${titleTerms[0].k}" (${evidenceText(titleTerms[0].e)}).`,
      values: [],
      notes: [],
    });
  // Short description: majority themes missing from ours.
  const ourShort = ours.shortDescription ?? "";
  const ourThemes = new Set(themesOf(ourShort));
  const themeRows = [...new Set(theirs.flatMap((t) => themesOf(t.o.shortDescription ?? "")))]
    .filter((t) => t !== "mechanic" && !ourThemes.has(t))
    .map((t) => ({
      t,
      e: evidenceOf(
        theirs.filter((x) => themesOf(x.o.shortDescription ?? "").includes(t)).map((x) => x.g),
        games,
        x.leaders,
      ),
    }))
    .filter((r) => r.e.n * 2 > r.e.M)
    .sort((a, b) => b.e.n - a.e.n);
  const room = LIMITS.short - chars(ourShort);
  if (themeRows[0])
    out.push({
      id: "",
      field: "short",
      level: levelFor(themeRows[0].e),
      candidate: false,
      evidence: themeRows[0].e,
      title: `Short description: add ${themeRows.map((r) => themeLabel(r.t as Theme)).join(", ")}`,
      text: `Short description (${chars(ourShort)} of ${LIMITS.short} characters, ${room} left): add ${themeRows.map((r) => `"${themeLabel(r.t as Theme)}" (${evidenceText(r.e)})`).join(", ")}. Keep what it already says (${[...ourThemes].map((t) => themeLabel(t)).join(", ") || "no theme"}); the length is counted by code.`,
      values: themeRows.map((r) => themeLabel(r.t as Theme)),
      notes: [],
    });
  // Long description: majority terms missing from our whole text (tag names and brands left out).
  // A single word counts only when it is a theme or the competitors also put it in a title or
  // short description: generic words ("download", "find") are not search terms.
  const ourKeys = allKeys(ours, m.hl);
  const upfront = new Set(
    theirs.flatMap((t) => [
      ...phrases(`${t.o.title ?? ""}\n${t.o.shortDescription ?? ""}`, m.hl).keys(),
    ]),
  );
  const meaningful = (k: string) => k.includes(" ") || themesOf(k).length > 0 || upfront.has(k);
  const terms = count(
    theirs.map((t) => ({ g: t.g, t: t.o.description ?? "" })),
    (k) => brandWords.has(k) || tagWords.has(k) || k.split(" ").some((w) => brandWords.has(w)),
  )
    .filter((r) => r.e.n >= 2 && r.e.n * 2 > r.e.M && !ourKeys.has(r.k) && meaningful(r.k))
    .sort(
      (a, b) =>
        b.e.n - a.e.n || b.k.split(" ").length - a.k.split(" ").length || a.k.localeCompare(b.k),
    )
    .slice(0, 8);
  if (terms[0])
    out.push({
      id: "",
      field: "description",
      level: levelFor(terms[0].e),
      candidate: false,
      evidence: terms[0].e,
      title: "Long description: add the missing terms",
      text: `Long description: add ${terms.map((r) => `"${r.k}" (${r.e.n} of ${r.e.M})`).join(", ")}, in natural sentences (no repetition or keyword lists).`,
      values: terms.map((r) => r.k),
      notes: [],
    });
  return out;
}

export function metaRules(x: MetaInput): MetaResult {
  const base =
    x.markets.find((m) => m.hl.startsWith("en") && x.text(x.ours.appId, m.gl, m.hl)) ??
    x.markets[0];
  const app = base ? appLevel(x, base) : [];
  const groups: MetaGroup[] = [];
  for (const m of x.markets) {
    const ds = [...(base ? localised(x, app, base, m) : []), ...perMarket(x, m)];
    if (!ds.length) continue;
    const sig = JSON.stringify(ds.map((d) => d.text));
    const g = groups.find(
      (y) => y.hl === m.hl && JSON.stringify(y.directives.map((d) => d.text)) === sig,
    );
    if (g) g.markets.push(m.label);
    else groups.push({ hl: m.hl, label: "", markets: [m.label], directives: ds });
  }
  for (const g of groups) g.label = g.markets.join(", ");
  let n = 0;
  for (const d of [...app, ...groups.flatMap((g) => g.directives)]) d.id = `M${++n}`;
  return {
    appLevel: app,
    groups,
    notes: base ? [`Tags and category read from ${base.label}; counted once per game.`] : [],
  };
}
