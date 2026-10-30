import { counts, type DeckEntry } from "../analysis/patterns.ts";
import { type EngineCtx, kindKey, perGame } from "./context.ts";
import { byRank, type Directive, isFirm } from "./directives.ts";
import type { Kind } from "./kinds.ts";
import { type GameMarket, type Leaders, leadersOf } from "./leaders.ts";
import { deckRules, lengthTarget, MAX_SLOTS } from "./rules-deck.ts";
import { messageRules } from "./rules-message.ts";
import { type MetaInput, type MetaResult, metaRules } from "./rules-meta.ts";
import { positionRules } from "./rules-position.ts";
import { buildSkeleton, resolveConflicts, type Slot } from "./skeleton.ts";
import type { Claim } from "./validate.ts";

/**
 * The recommendation engine (docs/plan-recommendation-engine.md): code turns the facts into a
 * ranked list of directives and a target deck skeleton; the AI only words, specifies and
 * localises them and may object (shown only, never applied: D8). Core principle (user,
 * 2026-10-30): top apps do better than ours, so the store page should look MORE like the leaders.
 */
export const ENGINE_VERSION = "engine.v1";

export type EngineVerdict = "very different" | "slightly different" | "on par" | "optimised";

export interface EngineResult {
  version: string;
  leaders: Leaders;
  directives: Directive[];
  skeleton: Slot[];
  verdict: { word: EngineVerdict; reasons: string[] };
  /** Store listing directives per country and language (absent without store text). */
  meta: MetaResult | null;
  notes: string[];
  /** The counts the AI may quote (validate.ts). */
  claims: Claim[];
}

export interface EngineInput {
  theirs: readonly DeckEntry[];
  ours: readonly DeckEntry[];
  decks: readonly { appId: string; name: string; deckLength: number }[];
  ourDeckLength: number;
  /** Installs and chart rank of the analysed competitors (leaders, D1). */
  market: readonly GameMarket[];
  meta?: Omit<MetaInput, "leaders"> & { market: readonly GameMarket[] };
}

/** The verdict from the screenshot directives only (plan 5.3); metadata and tests never count. */
export function verdictOf(ds: readonly Directive[], ourLength: number, target: number) {
  const firm = ds.filter(isFirm);
  const reasons: string[] = [];
  const early = firm.filter(
    (d) => ["COPY", "DROP", "ORIENT"].includes(d.kind) && d.positions.some((p) => p <= 3),
  );
  const drops = firm.filter((d) => d.kind === "DROP");
  if (early.length) reasons.push(`${early.map((d) => d.title).join("; ")}`);
  if (target - ourLength >= 3)
    reasons.push(`the deck is ${ourLength} images; the target is ${target}`);
  if (drops.length >= 2) reasons.push(`${drops.length} images to drop`);
  if (reasons.length) return { word: "very different" as const, reasons };
  const sum = firm.reduce((n, d) => n + d.rank, 0);
  if (firm.length && sum >= 1.5)
    return { word: "slightly different" as const, reasons: firm.slice(0, 3).map((d) => d.title) };
  if (firm.length || ds.some((d) => d.level === "test"))
    return {
      word: "on par" as const,
      reasons: [...firm, ...ds.filter((d) => d.level === "test")].slice(0, 3).map((d) => d.title),
    };
  return {
    word: "optimised" as const,
    reasons: ["no change is backed by the competitors' evidence"],
  };
}

export function runEngine(x: EngineInput): EngineResult {
  const leaders = leadersOf(x.market);
  const games = [
    ...new Map(x.theirs.map((e) => [e.appId, { appId: e.appId, name: e.name }])).values(),
  ];
  const ctx: EngineCtx = {
    theirs: x.theirs,
    ours: x.ours,
    games,
    deckLengths: new Map(
      x.decks
        .filter((d) => games.some((g) => g.appId === d.appId))
        .map((d) => [d.appId, d.deckLength]),
    ),
    ourDeckLength: x.ourDeckLength,
    leaders,
    ourCanvas: counts(x.ours.map((e) => e.canvas))[0]?.key ?? "portrait",
  };
  const lengthFires = (t: number) =>
    x.ourDeckLength <= t - 2 || x.ourDeckLength < Math.min(...ctx.deckLengths.values());
  const t0 = lengthTarget(ctx);
  const target = ctx.deckLengths.size
    ? lengthFires(t0)
      ? t0
      : Math.min(8, x.ourDeckLength)
    : x.ourDeckLength;
  const drafts = [...positionRules(ctx, target), ...deckRules(ctx), ...messageRules(ctx)];
  // An ADD whose kind a COPY or the deck builder already brings in is the same change: once.
  const copied = new Set(drafts.filter((d) => d.kind === "COPY").map((d) => d.spec?.kind));
  // Anything only we show is never a plain KEEP (user, 2026-10-30): its review replaces the keep.
  // A position with a firm change or a review is never also a "keep".
  const reviewed = new Set(
    drafts
      .filter((d) => d.kind === "REVIEW" || (d.kind !== "KEEP" && isFirm(d)))
      .map((d) => d.positions[0]),
  );
  const kept = drafts.filter(
    (d) =>
      !(d.kind === "ADD" && copied.has(d.spec?.kind)) &&
      !(d.kind === "KEEP" && reviewed.has(d.positions[0])),
  );
  const directives: Directive[] = kept
    .map((d) => ({ ...d, id: "" }))
    .sort(byRank)
    .map((d, i) => ({ ...d, id: `D${i + 1}` }));
  resolveConflicts(directives);
  const skeleton = buildSkeleton(ctx, directives, target);
  const notes = [leaders.note];
  if (games.length < 2) notes.push("Fewer than 2 competitors analysed: no directive is possible.");
  const meta = x.meta ? metaRules({ ...x.meta, leaders: leadersOf(x.meta.market) }) : null;
  return {
    version: ENGINE_VERSION,
    leaders,
    directives,
    skeleton,
    verdict: verdictOf(directives, x.ourDeckLength, target),
    meta,
    notes,
    claims: claimsOf(ctx, directives),
  };
}

/** Every count the AI may quote (validate.ts): per position, per kind, and each directive's. */
function claimsOf(ctx: EngineCtx, ds: readonly Directive[]): Claim[] {
  const out: Claim[] = [];
  for (let p = 1; p <= MAX_SLOTS; p++) {
    const at = perGame(ctx.theirs, p);
    for (const c of counts(at.map(kindKey)))
      out.push({ n: c.n, M: at.length, position: p, kind: c.key as Kind });
    for (const c of counts(at.map((e) => e.canvas)))
      out.push({ n: c.n, M: at.length, position: p, canvas: true });
  }
  const M = ctx.games.length;
  for (const k of new Set(ctx.theirs.map(kindKey)))
    out.push({
      n: new Set(ctx.theirs.filter((e) => kindKey(e) === k).map((e) => e.appId)).size,
      M,
      kind: k,
    });
  for (const d of ds)
    out.push({
      n: d.evidence.n,
      M: d.evidence.M,
      ...(d.positions[0] ? { position: d.positions[0] } : {}),
      ...(d.spec ? { kind: d.spec.kind } : {}),
    });
  return out;
}
