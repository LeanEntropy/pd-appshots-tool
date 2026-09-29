import { exampleRow, MAIN_DIMS, pageValues } from "./group-dims.ts";
import { type GroupData, shares } from "./group-findings.ts";
import type { GroupFinding, Thumb } from "./group-types.ts";
import type { CountryPages } from "./groups.ts";
import { countryName } from "./names.ts";

/**
 * Kind 1, our pages differ between countries (plan-cross-country 3.5): a fact about us, no
 * competitor threshold, shown first because reusing our own images is the cheapest fix. On the 5
 * main dimensions and on the number of different images (the same screen twice counts once).
 */
const list = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
const pl = (n: number) => (n === 1 ? "page" : "pages");

function ourThumb(p: CountryPages, position: number): Thumb[] {
  const g = p.games.find((x) => x.ours);
  const r = g?.rows.find((x) => x.position === position);
  return r?.thumb && g
    ? [{ game: g.name, gl: p.gl, label: p.label, position, thumb: r.thumb, ours: true }]
    : [];
}

export function oursFindings(x: GroupData): GroupFinding[] {
  const all = [...(x.main ? [x.main] : []), ...x.pages];
  const out: GroupFinding[] = [];
  for (const d of MAIN_DIMS) {
    const per = shares(x, all, d.id);
    const yes = per.filter((p) => p.ours === true);
    const no = per.filter((p) => p.ours === false);
    if (!yes.length || !no.length) continue;
    const name = (ps: typeof per) => list(ps.map((p) => countryName(p.label)));
    const most = no.filter((p) => p.of && p.yes * 2 >= p.of);
    const yesPage = all.find((p) => p.gl === yes[0]?.gl);
    const noPage = all.find((p) => p.gl === no[0]?.gl);
    const ours = yesPage?.games.find((g) => g.ours);
    const at = (ours && exampleRow(ours, d.id)?.position) ?? 1;
    out.push({
      kind: "ours",
      dim: d.id,
      dimLabel: d.label,
      group: "",
      title: `Our pages differ: ${d.label.toLowerCase()}`,
      text: `Our ${name(yes)} ${pl(yes.length)} ${d.does}; our ${name(no)} ${pl(no.length)} do not.${most.length ? ` There, ${most.map((p) => `${p.yes} of ${p.of} competitors in ${countryName(p.label)}`).join(", ")} do, so reusing our own image is the cheapest fix.` : " Competitors there are split, so this alone is no reason to change."}`,
      strength: null,
      fewGames: false,
      counts: null,
      perCountry: per,
      weakest: null,
      examples: [
        ...(yesPage ? ourThumb(yesPage, at) : []),
        ...(noPage ? ourThumb(noPage, at) : []),
      ],
      sketch: null,
    });
  }
  const decks = all.flatMap((p) => {
    const g = p.games.find((y) => y.ours);
    if (!g) return [];
    const v = pageValues(g);
    return [{ p, total: v.deckTotal, distinct: v.deckLength }];
  });
  const kinds = new Map<string, typeof decks>();
  for (const dk of decks) {
    const k = `${dk.total}|${dk.distinct}`;
    kinds.set(k, [...(kinds.get(k) ?? []), dk]);
  }
  if (kinds.size > 1) {
    const words = [...kinds.values()].map((ds) => {
      const d0 = ds[0];
      if (!d0) return "";
      const twice = d0.total - d0.distinct;
      return `our ${list(ds.map((d) => countryName(d.p.label)))} ${pl(ds.length)} ${ds.length === 1 ? "shows" : "show"} ${d0.total} images${twice ? `, ${d0.distinct} different screens (${twice} shown twice)` : ""}`;
    });
    const repeat = decks.find((d) => d.total > d.distinct);
    out.push({
      kind: "ours",
      dim: "deckLength",
      dimLabel: "Different images in the set",
      group: "",
      title: "Our pages differ: number of images",
      text: `${words.join("; ").replace(/^o/, "O")}.${repeat ? " Showing each screen once, as on our other pages, is the cheapest fix." : ""}`,
      strength: null,
      fewGames: false,
      counts: null,
      perCountry: decks.map((d) => ({
        gl: d.p.gl,
        label: d.p.label,
        isMain: d.p === x.main,
        yes: d.distinct,
        of: d.total,
        games: [],
        ours: d.total === d.distinct,
      })),
      weakest: null,
      examples: [],
      sketch: null,
    });
  }
  return out;
}
