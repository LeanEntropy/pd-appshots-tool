import { colourFamily } from "../analysis/colours.ts";
import { counts, type DeckEntry, median } from "../analysis/patterns.ts";
import { type EngineCtx, firstPositions, gameOf, kindKey } from "./context.ts";
import { type Directive, levelOf, rankOf } from "./directives.ts";
import { categoryAndSubtype, DEFINED, KIND_LABEL, kindOf } from "./kinds.ts";
import { specFrom } from "./spec.ts";
import { dropStrength, evidenceOf, evidenceText, isDirective, strengthOf } from "./strength.ts";

/**
 * Deck rules (plan 5.3-2 to 5.3-5, 5.3-7): DROP a kind no competitor uses anywhere (our gameplay
 * screenshot is the only exemption, D3), REVIEW anything only we show, ADD a kind most use and we
 * lack, LENGTH to the competitors' median, REORDER into their band, RE-LAYER the colour family.
 * Anything only we show counts against us: it is never a plain KEEP (user, 2026-10-30).
 */
type Draft = Omit<Directive, "id">;

/** Largest deck the engine plans (the store shows 8 phone screenshots before scrolling far). */
export const MAX_SLOTS = 8;

export function lengthTarget(ctx: EngineCtx): number {
  const ls = [...ctx.deckLengths.values()];
  if (!ls.length) return ctx.ourDeckLength;
  return Math.min(MAX_SLOTS, Math.ceil(median(ls)));
}

const sameSub = (a: DeckEntry, cat: string, sub: string) => {
  const k = categoryAndSubtype(a.final);
  return k.category === cat && k.subtype === sub;
};

export function deckRules(ctx: EngineCtx): Draft[] {
  const out: Draft[] = [];
  const ev = (doers: readonly DeckEntry[]) =>
    evidenceOf(
      doers.map(gameOf),
      ctx.games,
      ctx.leaders,
      doers.map((e) => e.imageId),
    );
  const ourKinds = new Set(ctx.ours.map(kindKey));
  for (const o of ctx.ours) {
    const k = kindOf(o);
    const users = ctx.theirs.filter((x) => kindKey(x) === k.kind);
    const e = ev(users);
    const p = o.position;
    const name = KIND_LABEL[k.kind].toLowerCase();
    if (k.flags.length)
      out.push({
        kind: "REVIEW",
        level: "review",
        positions: [p],
        strength: "test",
        evidence: e,
        title: `Image ${p}: check the reading`,
        text: `Image ${p}: ${k.flags.join("; ")}. Check it before acting on it.`,
        rank: 0,
        notes: k.flags,
      });
    if (e.n === 0 && e.M >= 1 && DEFINED(k.kind)) {
      if (k.kind === "core_play") {
        out.push({
          kind: "REVIEW",
          level: "review",
          positions: [p],
          strength: "test",
          evidence: e,
          title: `Image ${p}: only we show this`,
          text: `Image ${p}: no competitor shows a gameplay screenshot like ours. It stays only because it is our gameplay screenshot; it still follows the leaders on position, orientation, headline, board density, interface clutter and the marketing layer.`,
          rank: 0,
          notes: ["D3: gameplay screenshot exemption"],
        });
        continue;
      }
      const s = dropStrength(e);
      out.push({
        kind: "DROP",
        level: levelOf(s, s !== "consider"),
        positions: [p],
        strength: s,
        evidence: e,
        title: `Image ${p}: drop the ${name}`,
        text: `Image ${p}: drop it. ${e.M === 1 ? "The one competitor" : `None of the ${e.M} competitors`} (${e.others.join(", ")}) show a ${name} anywhere in their decks${s === "provisional" ? " (provisional: confirm with the Full check, as not both games are leaders)" : ""}.`,
        rank: rankOf("DROP", s, [p]),
        notes: [],
      });
      continue;
    }
    // Only we show this exact screen (its subtype): needs review, never a plain keep.
    if (
      k.subtype &&
      !ctx.theirs.some((x) => sameSub(x, k.category, k.subtype)) &&
      ctx.games.length >= 2
    ) {
      const what = k.subtype.replace(/_/g, " ");
      out.push({
        kind: "REVIEW",
        level: "review",
        positions: [p],
        strength: "test",
        evidence: evidenceOf([], ctx.games, ctx.leaders),
        title: `Image ${p}: only we show a ${what} screen`,
        text:
          k.kind === "core_play"
            ? `Image ${p}: no competitor shows a ${what} screen. It stays only because it is our gameplay screenshot; it still follows the leaders on position, orientation, headline, board density, interface clutter and the marketing layer. A/B test it against the leaders' gameplay screenshot.`
            : `Image ${p}: no competitor shows a ${what} screen (${e.n} of ${e.M} show a ${name} of another kind). Anything only we show counts against us: keep it only with a specific stated reason, and A/B test it.`,
        rank: 0,
        notes: [],
      });
    }
  }
  // ADD: a kind most competitors use (leaders not against) that we lack.
  for (const kind of new Set(ctx.theirs.map(kindKey))) {
    if (ourKinds.has(kind) || !DEFINED(kind)) continue;
    const users = ctx.theirs.filter((x) => kindKey(x) === kind);
    const e = ev(users);
    const s = strengthOf(e);
    if (s === "test" || s === "consider") continue;
    const at = Math.round(median([...firstPositions(ctx.theirs, kind).values()]));
    const spec = specFrom(
      users.filter((x) => x.position === at).length
        ? users.filter((x) => x.position === at)
        : users,
      { kind },
    );
    out.push({
      kind: "ADD",
      level: levelOf(s, isDirective(s)),
      positions: [at],
      strength: s,
      evidence: e,
      title: `Add a ${KIND_LABEL[kind].toLowerCase()}`,
      text: `Add a ${KIND_LABEL[kind].toLowerCase()} (around image ${at}): ${evidenceText(e)} show one (${e.games.join(", ")}); we have none.`,
      spec,
      rank: rankOf("ADD", s, [at]),
      notes: [],
    });
  }
  // LENGTH: to the median of the competitors' deck lengths (rounded up, at most 8).
  const target = lengthTarget(ctx);
  const ls = [...ctx.deckLengths.entries()];
  const min = Math.min(...ls.map(([, n]) => n));
  if (ls.length && (ctx.ourDeckLength <= target - 2 || ctx.ourDeckLength < min)) {
    const doers = ctx.games.filter((g) => (ctx.deckLengths.get(g.appId) ?? 0) >= target);
    const e = evidenceOf(doers, ctx.games, ctx.leaders);
    const s = strengthOf(e);
    out.push({
      kind: "LENGTH",
      level: levelOf(s, true),
      positions: [],
      strength: s,
      evidence: e,
      title: `Grow the deck to ${target} images`,
      text: `Grow the deck from ${ctx.ourDeckLength} to ${target} images: ${evidenceText(e)} show ${target} or more (median ${median(ls.map(([, n]) => n))}). A screen we have not captured yet is a capture to make, never a reason to stop short.`,
      rank: rankOf("LENGTH", s, []),
      notes: [`target ${target}`],
    });
  } else if (ls.length && ctx.ourDeckLength > MAX_SLOTS) {
    out.push({
      kind: "LENGTH",
      level: "directive",
      positions: [],
      strength: "majority",
      evidence: evidenceOf([], ctx.games, ctx.leaders),
      title: `Trim the deck to ${MAX_SLOTS} images`,
      text: `Trim the deck to ${MAX_SLOTS} images, from the end, after the drops.`,
      rank: rankOf("LENGTH", "majority", []),
      notes: [`target ${MAX_SLOTS}`],
    });
  }
  // REORDER: a kind we have outside the band where the competitors put it.
  for (const o of ctx.ours) {
    const kind = kindKey(o);
    const firsts = firstPositions(ctx.theirs, kind);
    if (firsts.size < 2 || !DEFINED(kind) || kind === "core_play") continue;
    const ps = [...firsts.values()];
    const lo = Math.min(...ps);
    const hi = Math.max(...ps);
    if (o.position >= lo && o.position <= hi) continue;
    const to = Math.round(median(ps));
    const reach = ctx.games.filter(
      (g) => (ctx.deckLengths.get(g.appId) ?? 0) >= Math.max(o.position, to),
    ).length;
    if (reach * 2 <= ctx.games.length) continue;
    const e = ev(
      ctx.theirs.filter((x) => kindKey(x) === kind && firsts.get(x.appId) === x.position),
    );
    const s = strengthOf(e);
    out.push({
      kind: "REORDER",
      level: levelOf(s, isDirective(s, Math.min(o.position, to))),
      positions: [o.position, to],
      strength: s,
      evidence: e,
      title: `Move image ${o.position} to image ${to}`,
      text: `Move our ${KIND_LABEL[kind].toLowerCase()} from image ${o.position} to image ${to}: ${evidenceText(e)} show it first between image ${lo} and ${hi}.`,
      rank: rankOf("REORDER", s, [to]),
      notes: [],
    });
  }
  out.push(...colourRule(ctx));
  return out;
}

/** The main marketing-layer colour family per game, and ours (D5: same strength rules). */
function colourRule(ctx: EngineCtx): Draft[] {
  const fam = (es: readonly DeckEntry[]) =>
    counts(
      es
        .filter((e) => e.final.marketingLayer.present)
        .flatMap((e) => {
          const m = e.final.marketingLayer;
          const b = m.backgroundMasks[0];
          const c = b
            ? colourFamily(b.colourName, b.colourHex)
            : m.mainColours[0]
              ? colourFamily(m.mainColours[0].name, m.mainColours[0].hex)
              : null;
          return c ? [c] : [];
        }),
    )[0]?.key ?? null;
  const ours = fam(ctx.ours);
  if (!ours) return [];
  const per = ctx.games.map((g) => ({ g, c: fam(ctx.theirs.filter((e) => e.appId === g.appId)) }));
  const top = counts(per.map((x) => x.c))[0];
  if (!top || top.key === ours) return [];
  const doers = per.filter((x) => x.c === top.key).map((x) => x.g);
  const e = evidenceOf(
    doers,
    per.filter((x) => x.c).map((x) => x.g),
    ctx.leaders,
  );
  const s = strengthOf(e);
  return [
    {
      kind: "RELAYER",
      level: levelOf(s, isDirective(s)),
      positions: [],
      strength: s,
      evidence: e,
      title: `Marketing layer colour: ${top.key}`,
      text: `Marketing layer colour: ${evidenceText(e)} use mostly ${top.key} (${e.games.join(", ")}); ours is mostly ${ours}. Brand colour gets no exemption: follow the evidence.`,
      rank: rankOf("RELAYER", s, []),
      notes: [],
    },
  ];
}
