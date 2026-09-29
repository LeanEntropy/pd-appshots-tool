import type { Kb } from "./release.ts";
import { renderEntry } from "./render.ts";
import type { Entry, Store } from "./schema.ts";
import {
  budgetOf,
  type Facet,
  facetOf,
  type KbStep,
  type Preset,
  STEP_SPECS,
  tokensOf,
} from "./steps.ts";
import { type Computed, isTrusted } from "./trust.ts";

/**
 * Retrieval by code (plan 4.1): eligibility, query tags from the step's computed facts, additive
 * ranking within a facet, a balanced fill with minimum and maximum shares, unverified entries at
 * most a third of the budget, counter-claims always travelling with their entry, and mandatory
 * material (enforced rules, the country's regulation) in a reserved part. When mandatory material
 * does not fit, the selection is blocked with the reason (nothing is dropped silently).
 */
export interface KbQuery {
  step: KbStep;
  store: Store;
  /** The step's country (two letters, upper case), or null for global material only. */
  country: string | null;
  genres: readonly string[];
  /** Keys of the computed facts (pattern ids, gap kinds, "variable:order" ...). */
  facts: readonly string[];
  preset: Preset;
}

export interface Picked {
  entry: Entry;
  computed: Computed;
  handle: string;
  facet: Facet;
  score: number;
  mandatory: boolean;
  /** Country-specific material goes with the call; the rest is the step's stable core. */
  perCall: boolean;
  tokens: number;
  text: string;
}

export interface Selection {
  step: KbStep;
  releaseHash: string;
  picked: Picked[];
  leftOut: { id: string; reason: string }[];
  tokens: number;
  budget: number;
  queryTags: string[];
  blocked: string | null;
}

const TRUST_SCORE = { official: 3, established: 3, corroborated: 2, unverified: 1 } as const;

/** Tags for a set of computed facts, from kb/dimension-tags.json (keys are regular expressions). */
export function tagsForFacts(kb: Kb, facts: readonly string[]): string[] {
  const out = new Set<string>();
  for (const [pattern, tags] of Object.entries(kb.dimensionTags.map)) {
    let re: RegExp;
    try {
      re = new RegExp(pattern);
    } catch {
      continue;
    }
    if (facts.some((f) => re.test(f))) for (const t of tags) out.add(t);
  }
  return [...out];
}

export function eligible(e: Entry, c: Computed | undefined, q: KbQuery): c is Computed {
  if (!c || e.retired || c.origins < 1) return false;
  if (!e.scope.store.includes(q.store)) return false;
  const countries = e.scope.countries;
  if (!countries.includes("global") && !(q.country && countries.includes(q.country))) return false;
  return e.scope.genre.includes("all_games") || e.scope.genre.some((g) => q.genres.includes(g));
}

export function select(kb: Kb, q: KbQuery): Selection {
  const spec = STEP_SPECS[q.step];
  const { budget, reserved } = budgetOf(q.step, q.preset);
  const known = new Set(kb.tags);
  const queryTags = [
    ...new Set([
      ...spec.baseTags,
      ...tagsForFacts(kb, q.facts),
      ...q.genres.filter((g) => known.has(g)),
    ]),
  ];
  const qt = new Set(queryTags);
  const facets = new Map(spec.facets.map((f) => [f.facet, f]));
  type Cand = {
    e: Entry;
    c: Computed;
    facet: Facet;
    score: number;
    match: number;
    mandatory: boolean;
  };
  const cands: Cand[] = [];
  for (const e of kb.entries) {
    const c = kb.computed.get(e.id);
    if (!eligible(e, c, q)) continue;
    const facet = facetOf(e);
    const match = e.tags.filter((t) => qt.has(t)).length;
    const mandatory =
      (spec.enforced && e.ruleClass === "enforced_rule" && !c.stale) ||
      (spec.regulation &&
        facet === "regulation" &&
        !!q.country &&
        e.scope.countries.includes(q.country));
    const specific =
      (e.scope.countries.includes("global") ? 0 : 1) +
      (e.scope.genre.includes("all_games") ? 0 : 1);
    const score = match + TRUST_SCORE[c.trust] + specific - (c.stale ? 1 : 0);
    cands.push({ e, c, facet, score, match, mandatory });
  }
  const order = (a: Cand, b: Cand) => b.score - a.score || a.e.id.localeCompare(b.e.id);
  // Counter-claim links go both ways, whichever entry names the other.
  const counterOf = new Map<string, string[]>();
  for (const e of kb.entries)
    for (const c of e.contradicts) {
      counterOf.set(e.id, [...(counterOf.get(e.id) ?? []), c]);
      counterOf.set(c, [...(counterOf.get(c) ?? []), e.id]);
    }
  const chosen = new Map<string, { cand: Cand; mandatory: boolean; tokens: number }>();
  const perFacet = new Map<Facet, number>();
  let total = 0;
  let weak = 0;
  const leftOut = new Map<string, string>();
  const size = (e: Entry, c: Computed) => tokensOf(renderEntry(e, c, "K00", kb));
  // An entry and the counter-claims it brings, as one unit.
  const unit = (x: Cand) => {
    const list = [
      x,
      ...(counterOf.get(x.e.id) ?? []).flatMap((id) => {
        const e = kb.byId.get(id);
        const c = kb.computed.get(id);
        // Only a counter-claim that applies here travels (never another store's or country's).
        return e && eligible(e, c, q) && !chosen.has(id)
          ? [{ e, c, facet: facetOf(e), score: 0, match: 0, mandatory: false }]
          : [];
      }),
    ];
    const tokens = list.reduce((a, y) => a + size(y.e, y.c), 0);
    const weakTokens = list
      .filter((y) => !isTrusted(y.c.trust) || y.c.contested)
      .reduce((a, y) => a + size(y.e, y.c), 0);
    return { list, tokens, weakTokens };
  };
  const take = (x: Cand, mandatory: boolean) => {
    const u = unit(x);
    for (const y of u.list)
      chosen.set(y.e.id, { cand: y, mandatory: mandatory && y === x, tokens: size(y.e, y.c) });
    total += u.tokens;
    weak += u.weakTokens;
    perFacet.set(x.facet, (perFacet.get(x.facet) ?? 0) + u.tokens);
  };
  const mandatory = cands.filter((x) => x.mandatory).sort(order);
  const need = mandatory.reduce((a, x) => a + (chosen.has(x.e.id) ? 0 : unit(x).tokens), 0);
  if (need > reserved)
    return {
      step: q.step,
      releaseHash: kb.hash,
      picked: [],
      leftOut: [],
      tokens: 0,
      budget,
      queryTags,
      blocked: `The ${spec.label.toLowerCase()} need ${need} tokens of store rules and regulation notes, more than the ${reserved} reserved for them. Raise the knowledge budget preset in Settings, or review those entries.`,
    };
  for (const x of mandatory) if (!chosen.has(x.e.id)) take(x, true);
  const fits = (x: Cand, facetCap: boolean) => {
    const u = unit(x);
    const f = facets.get(x.facet);
    if (total + u.tokens > budget) return "over the step's budget";
    if (weak + u.weakTokens > budget / 3)
      return "unverified entries are at most a third of the budget";
    if (facetCap && f && (perFacet.get(x.facet) ?? 0) + u.tokens > f.max * budget)
      return "its kind of material has its full share";
    return null;
  };
  const rest = cands.filter((x) => !x.mandatory && x.match > 0 && facets.has(x.facet)).sort(order);
  for (const x of cands)
    if (!x.mandatory && !(x.match > 0 && facets.has(x.facet)))
      leftOut.set(x.e.id, "not about this step's questions");
  // Phase A: each facet up to its minimum share; phase B: best score first within the maxima.
  for (const f of spec.facets)
    for (const x of rest.filter((y) => y.facet === f.facet)) {
      if ((perFacet.get(f.facet) ?? 0) >= f.min * budget) break;
      if (!chosen.has(x.e.id) && !fits(x, true)) take(x, false);
    }
  for (const x of rest) {
    if (chosen.has(x.e.id)) continue;
    const why = fits(x, true);
    if (why) leftOut.set(x.e.id, why);
    else take(x, false);
  }
  for (const id of chosen.keys()) leftOut.delete(id);
  const list = [...chosen.values()];
  const perCall = (e: Entry) => !e.scope.countries.includes("global");
  list.sort(
    (a, b) =>
      Number(perCall(a.cand.e)) - Number(perCall(b.cand.e)) ||
      Number(b.mandatory) - Number(a.mandatory) ||
      b.cand.score - a.cand.score ||
      a.cand.e.id.localeCompare(b.cand.e.id),
  );
  const picked: Picked[] = list.map((x, i) => {
    const handle = `K${i + 1}`;
    const text = renderEntry(x.cand.e, x.cand.c, handle, kb);
    return {
      entry: x.cand.e,
      computed: x.cand.c,
      handle,
      facet: x.cand.facet,
      score: x.cand.score,
      mandatory: x.mandatory,
      perCall: perCall(x.cand.e),
      tokens: tokensOf(text),
      text,
    };
  });
  return {
    step: q.step,
    releaseHash: kb.hash,
    picked,
    leftOut: [...leftOut].map(([id, reason]) => ({ id, reason })),
    tokens: picked.reduce((a, p) => a + p.tokens, 0),
    budget,
    queryTags,
    blocked: null,
  };
}
