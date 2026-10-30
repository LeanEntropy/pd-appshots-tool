import { layerStructure } from "../analysis/layer-structure.ts";
import type { DeckEntry } from "../analysis/patterns.ts";
import { dominantBy, type EngineCtx, gameOf, kindKey, MIN_GAMES, perGame } from "./context.ts";
import { type Directive, levelOf, rankOf, type ShotKind } from "./directives.ts";
import { DEFINED, KIND_LABEL, kindOf } from "./kinds.ts";
import { specFrom } from "./spec.ts";
import { evidenceOf, evidenceText, isDirective, type Strength, strengthOf } from "./strength.ts";

/**
 * Position rules (plan 5.3-1, 6, 7, 9, 10): COPY the kind the competitors show at an image
 * position, ORIENT to their orientation there, RE-LAYER their layer structure, RECAPTURE when a
 * measured attribute differs, else KEEP with the fact behind it (or "no evidence either way").
 * New slots past the end of our deck get ORIENT when their orientation differs from ours.
 */
type Draft = Omit<Directive, "id">;

function make(
  kind: ShotKind,
  p: number,
  s: Strength,
  ev: Directive["evidence"],
  title: string,
  text: string,
  extra: Partial<Draft> = {},
): Draft {
  return {
    kind,
    level: levelOf(s, isDirective(s, p)),
    positions: [p],
    strength: s,
    evidence: ev,
    title,
    text,
    rank: rankOf(kind, s, [p]),
    notes: [],
    ...extra,
  };
}

const LOWER = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Directives for our image at position p (or a new slot p past our deck's end). */
function atPosition(ctx: EngineCtx, p: number, o: DeckEntry | undefined): Draft[] {
  const at = perGame(ctx.theirs, p);
  const games = at.map(gameOf);
  if (at.length < MIN_GAMES) {
    if (!o) return [];
    const ev = evidenceOf([], games, ctx.leaders);
    return [
      make(
        "KEEP",
        p,
        "test",
        ev,
        `Image ${p}: no evidence either way`,
        `Only ${at.length} competitor${at.length === 1 ? "" : "s"} reach image ${p}: too few to judge it.`,
        { level: "keep" },
      ),
    ];
  }
  const out: Draft[] = [];
  const kind = dominantBy(at, kindKey, ctx.leaders);
  const canvas = dominantBy(at, (e) => e.canvas, ctx.leaders);
  const ls = dominantBy(at, (e) => layerStructure(e.final), ctx.leaders);
  const ev = (doers: readonly DeckEntry[]) =>
    evidenceOf(
      doers.map(gameOf),
      games,
      ctx.leaders,
      doers.map((e) => e.imageId),
    );
  if (!o) {
    // A new slot: only its orientation is a position directive; the deck builder fills the rest.
    if (canvas && canvas.key !== ctx.ourCanvas) {
      const e = ev(canvas.doers);
      const s = strengthOf(e);
      const spec = specFrom(canvas.doers, { canvas: canvas.key });
      out.push(
        make(
          "ORIENT",
          p,
          s,
          e,
          `Image ${p}: ${canvas.key}`,
          `New image ${p}: make it ${canvas.key} (${spec.size}), as ${evidenceText(e)} do there (${e.games.join(", ")}).`,
          { spec },
        ),
      );
    }
    return out;
  }
  const mine = kindOf(o);
  if (kind && DEFINED(kind.key) && kind.key !== mine.kind) {
    const e = ev(kind.doers);
    const s = strengthOf(e);
    const doers = canvas ? kind.doers.filter((x) => x.canvas === canvas.key) : kind.doers;
    const spec = specFrom(doers.length >= 1 ? doers : kind.doers, { kind: kind.key });
    out.push(
      make(
        "COPY",
        p,
        s,
        e,
        `Image ${p}: ${LOWER(spec.kindLabel)}`,
        `Image ${p}: ${evidenceText(e)} show a ${spec.headline.toLowerCase()} here (${e.games.join(", ")}); ours is a ${o.canvas} ${LOWER(KIND_LABEL[mine.kind])}. Make a new one to this spec${spec.source === "marketing_art" ? ", built from our logo and art, not a screenshot" : ""}.`,
        { spec },
      ),
    );
    return out;
  }
  const sameKind = !!kind && kind.key === mine.kind;
  if (canvas && canvas.key !== o.canvas) {
    const e = ev(canvas.doers);
    const s = strengthOf(e);
    const spec = specFrom(
      canvas.doers.filter((x) => kindKey(x) === mine.kind).length
        ? canvas.doers.filter((x) => kindKey(x) === mine.kind)
        : canvas.doers,
      { kind: mine.kind, canvas: canvas.key },
    );
    out.push(
      make(
        "ORIENT",
        p,
        s,
        e,
        `Image ${p}: ${canvas.key}`,
        `Image ${p}: ${evidenceText(e)} use a ${canvas.key} image here (${e.games.join(", ")}); ours is ${o.canvas}. Rebuild it ${canvas.key} (${spec.size}).`,
        { spec },
      ),
    );
  }
  if (ls && ls.key !== layerStructure(o.final)) {
    const e = ev(ls.doers);
    const s = strengthOf(e);
    out.push(
      make(
        "RELAYER",
        p,
        s,
        e,
        `Image ${p}: layer structure`,
        `Image ${p}: ${evidenceText(e)} are built as "${ls.key.replace(/_/g, " ")}" here; ours is "${layerStructure(o.final).replace(/_/g, " ")}".`,
        { spec: specFrom(ls.doers) },
      ),
    );
  }
  if (sameKind && kind) {
    for (const [attr, label, value] of [
      ["boardDensity", "board density", (x: DeckEntry) => x.attrs?.boardDensity ?? null],
      [
        "hudVisible",
        "game interface",
        (x: DeckEntry) =>
          x.attrs?.hudVisible == null ? null : x.attrs.hudVisible ? "visible" : "hidden",
      ],
    ] as const) {
      const mineV = value(o);
      const theirs = kind.doers.filter((x) => value(x) !== null);
      const d = theirs.length >= MIN_GAMES ? dominantBy(theirs, value, ctx.leaders) : null;
      if (!d || mineV === null || d.key === mineV) continue;
      const e = evidenceOf(
        d.doers.map(gameOf),
        theirs.map(gameOf),
        ctx.leaders,
        d.doers.map((x) => x.imageId),
      );
      const s = strengthOf(e);
      out.push(
        make(
          "RECAPTURE",
          p,
          s,
          e,
          `Image ${p}: recapture (${label})`,
          `Image ${p}: ${evidenceText(e)} show ${label} "${d.key}" on this kind of screen; ours is "${mineV}". Recapture it.`,
          { spec: specFrom(d.doers, { kind: mine.kind }), notes: [`attribute: ${attr}`] },
        ),
      );
    }
  }
  if (!out.length) {
    const e = sameKind && kind ? ev(kind.doers) : evidenceOf([], games, ctx.leaders);
    const s = sameKind && kind ? strengthOf(e) : "test";
    const supported = sameKind && isDirective(s);
    out.push(
      make(
        "KEEP",
        p,
        s,
        e,
        `Image ${p}: keep`,
        supported
          ? `${KIND_LABEL[mine.kind]} at image ${p}: ${evidenceText(e)} show it here.`
          : `Image ${p}: no evidence either way (${kind?.tie ? "the competitors are split here" : "no clear pattern here"}).`,
        { level: "keep", rank: 0 },
      ),
    );
  }
  return out;
}

/** Position directives for our images and for new slots up to `upTo`. */
export function positionRules(ctx: EngineCtx, upTo: number): Draft[] {
  const out: Draft[] = [];
  const last = Math.max(upTo, ...ctx.ours.map((e) => e.position));
  for (let p = 1; p <= last; p++) {
    const o = ctx.ours.find((e) => e.position === p);
    if (!o && p > upTo) continue;
    out.push(...atPosition(ctx, p, o));
  }
  return out;
}
