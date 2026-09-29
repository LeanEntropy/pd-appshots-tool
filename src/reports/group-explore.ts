import { EXPLORE_DIMS, MAIN_DIMS, pageValues } from "./group-dims.ts";
import { type GroupData, shares } from "./group-findings.ts";
import type { GroupSection } from "./group-types.ts";
import { countryName } from "./names.ts";

/**
 * The exploratory table of a group (plan-cross-country 3.3): deck length, order, composition and
 * what title art says, per country, with their numbers. Shown only, never a recommendation or an
 * A/B test on its own. Plus the similarity hint (never forms a group).
 */
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2) : 0;
};

export function exploratory(
  x: GroupData,
  gls: readonly string[],
  labels: Record<string, string>,
): GroupSection["exploratory"] {
  const pages = [...(x.main ? [x.main] : []), ...x.pages.filter((p) => gls.includes(p.gl))];
  const plain = (v: string) =>
    v
      .split(" > ")
      .map((k) => labels[k] ?? k.replace(/_/g, " "))
      .join(" > ");
  return EXPLORE_DIMS.map((d) => ({
    label: d.label,
    definition: d.definition,
    perCountry: pages.map((p) => {
      const comp = x.competitors.flatMap((c) => {
        const g = p.games.find((y) => y.appId === c.appId);
        return g ? [pageValues(g)] : [];
      });
      const ours = p.games.find((g) => g.ours);
      const o = ours ? pageValues(ours) : null;
      if (d.id === "deckLength")
        return {
          label: p.label,
          value: `median ${median(comp.map((v) => v.deckLength))}${o ? `; ours ${o.deckLength}` : ""}`,
        };
      const vals = comp.map((v) => v[d.id]).filter((v): v is string => !!v);
      const counts = new Map<string, number>();
      for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
      const top = [...counts].sort((a, b) => b[1] - a[1])[0];
      const own = o?.[d.id];
      return {
        label: p.label,
        value: top
          ? `${plain(top[0])} (${top[1]} of ${vals.length})${own ? `; ours ${plain(own)}` : ""}`
          : "not known",
      };
    }),
  }));
}

/** "Thailand's competitors look more like their United States pages ... (4 of 5 main dimensions)". */
export function similarityHint(x: GroupData): string | null {
  if (!x.main || x.pages.length < 3) return null;
  const share = (p: { yes: number; of: number }) => (p.of ? p.yes / p.of : 0);
  let best: { name: string; k: number } | null = null;
  for (const p of x.pages) {
    let k = 0;
    for (const d of MAIN_DIMS) {
      const per = shares(x, [x.main, ...x.pages], d.id);
      const me = per.find((q) => q.gl === p.gl);
      const main = per.find((q) => q.isMain);
      const rest = per.filter((q) => !q.isMain && q.gl !== p.gl);
      if (!me || !main || !rest.length) continue;
      const avg = rest.reduce((n, q) => n + share(q), 0) / rest.length;
      if (Math.abs(share(me) - share(main)) < Math.abs(share(me) - avg)) k++;
    }
    if (k >= 4 && (!best || k > best.k)) best = { name: countryName(p.label), k };
  }
  return best
    ? `${best.name}'s competitors look more like their ${countryName(x.main.label)} pages than the other compared countries' (on ${best.k} of ${MAIN_DIMS.length} main dimensions). A hint only: groups are never formed from it.`
    : null;
}
