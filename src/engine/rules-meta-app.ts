import type { StoreOfficial } from "../play/store-text.ts";
import {
  levelFor,
  type MetaDirective,
  type MetaInput,
  TAG_LIMIT,
  tagsOf,
} from "./rules-meta-types.ts";
import { evidenceOf, evidenceText, type Game, strengthOf } from "./strength.ts";

/** App-level store listing directives: tags (candidates, D9) and the category (D4). */
export function appLevel(x: MetaInput, base: { gl: string; hl: string }): MetaDirective[] {
  const out: MetaDirective[] = [];
  const ours = x.text(x.ours.appId, base.gl, base.hl);
  const theirs = x.competitors.flatMap((g) => {
    const o = x.text(g.appId, base.gl, base.hl);
    return o ? [{ g, o }] : [];
  });
  if (!ours || !theirs.length) return out;
  const games = theirs.map((t) => t.g);
  const ourTags = new Set(tagsOf(ours).map((t) => t.toLowerCase()));
  const all = [...new Set(theirs.flatMap((t) => tagsOf(t.o)))];
  const rows = all
    .map((tag) => {
      const e = evidenceOf(
        theirs.filter((t) => tagsOf(t.o).includes(tag)).map((t) => t.g),
        games,
        x.leaders,
      );
      return { tag, e, s: strengthOf(e) };
    })
    .filter((r) => !ourTags.has(r.tag.toLowerCase()) && r.e.n * 2 > r.e.M)
    .sort((a, b) => b.e.n - a.e.n || a.tag.localeCompare(b.tag));
  if (rows.length) {
    const free = Math.max(0, TAG_LIMIT - ourTags.size);
    const weakest = tagsOf(ours)
      .map((t) => ({ t, n: theirs.filter((x) => tagsOf(x.o).includes(t)).length }))
      .sort((a, b) => a.n - b.n);
    const add = rows.slice(0, Math.max(free, Math.min(rows.length, TAG_LIMIT)));
    const replace = free < add.length ? weakest.slice(0, add.length - free) : [];
    const top = add[0] as (typeof rows)[number];
    out.push({
      id: "",
      field: "tags",
      level: levelFor(top.e),
      candidate: true,
      evidence: top.e,
      title: `Tags: add ${add.map((r) => r.tag).join(", ")}`,
      text: `Tag candidates (until the Play Console tag limit is confirmed): ${add.map((r) => `${r.tag} (${evidenceText(r.e)})`).join("; ")}. ${ourTags.size ? `Ours: ${tagsOf(ours).join(", ")}.` : "Ours: none."}${replace.length ? ` Our slots are full: replace ${replace.map((r) => `${r.t} (${r.n} of ${games.length})`).join(", ")} first.` : ""} Tags are app-level: the same set shows translated in every country.`,
      values: add.map((r) => r.tag),
      notes: [`assumed tag limit ${TAG_LIMIT}`],
    });
  }
  const genre = (o: StoreOfficial) => o.genre.id ?? o.genre.name ?? "";
  const byGenre = new Map<string, Game[]>();
  for (const t of theirs) byGenre.set(genre(t.o), [...(byGenre.get(genre(t.o)) ?? []), t.g]);
  const [topGenre, doers] = [...byGenre].sort((a, b) => b[1].length - a[1].length)[0] ?? ["", []];
  const e = evidenceOf(doers, games, x.leaders);
  const leadersAgree = e.leaders.on && e.leaders.of > 0 && e.leaders.n === e.leaders.of;
  if (topGenre && topGenre !== genre(ours) && e.n * 2 > e.M && leadersAgree) {
    const name = theirs.find((t) => genre(t.o) === topGenre)?.o.genre.name ?? topGenre;
    out.push({
      id: "",
      field: "category",
      level: "directive",
      candidate: false,
      evidence: e,
      title: `Category: switch from ${ours.genre.name} to ${name}`,
      text: `Switch the category from ${ours.genre.name} to ${name}: ${evidenceText(e)} are in ${name} (${e.games.join(", ")}), including every leader. Record the date of the switch and watch rank and installs: a category switch cannot be A/B tested.`,
      values: [name],
      notes: ["D4: recommended, not testable"],
    });
  }
  return out;
}

/** The app-level tag and category directives in this market's language (same chip index). */
export function localised(
  x: MetaInput,
  app: readonly MetaDirective[],
  base: { gl: string; hl: string },
  m: { gl: string; hl: string },
): MetaDirective[] {
  if (m.hl === base.hl) return app.map((d) => ({ ...d }));
  return app.map((d) => {
    const values = d.values.map((v) => {
      for (const g of x.competitors) {
        const b = x.text(g.appId, base.gl, base.hl);
        const here = x.text(g.appId, m.gl, m.hl);
        if (!b || !here) continue;
        if (d.field === "category") {
          if (b.genre.name !== v) continue;
          return `${here.genre.name ?? v} (${v})`;
        }
        const i = tagsOf(b).indexOf(v);
        const local = i >= 0 ? tagsOf(here)[i] : undefined;
        if (local) return local === v ? v : `${local} (${v})`;
      }
      return v;
    });
    return { ...d, values, title: d.field === "tags" ? `Tags: add ${values.join(", ")}` : d.title };
  });
}
