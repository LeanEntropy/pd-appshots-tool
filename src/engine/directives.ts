import type { Kind, Source } from "./kinds.ts";
import { type Evidence, STRENGTH_WEIGHT, type Strength } from "./strength.ts";

/**
 * The engine's output types and rank (plan 5.3). Every directive carries its evidence (n of M
 * unique games, the leaders among them, which games and images) and, for COPY and every DROP
 * replacement, a full target spec built by code from the competitors' exemplars.
 */
export type ShotKind =
  | "COPY"
  | "DROP"
  | "ADD"
  | "LENGTH"
  | "REORDER"
  | "ORIENT"
  | "RELAYER"
  | "MESSAGE"
  | "RECAPTURE"
  | "KEEP"
  | "REVIEW";

/**
 * directive: do it; provisional: do it, confirm with the Full check (2 games, not both leaders);
 * test: an A/B test idea only; consider: one game only; keep: no change, with the fact behind it;
 * review: needs a person's look (something only we show, or a flagged classification).
 */
export type Level = "directive" | "provisional" | "test" | "consider" | "keep" | "review";

/** One field of a spec, with where it comes from and how many exemplars agree. */
export interface SpecField {
  label: string;
  value: string;
  from: "pixels" | "code" | "analysis" | "not measured";
  agree: string;
  required: boolean;
}

export interface SlotSpec {
  kind: Kind;
  kindLabel: string;
  canvas: string;
  size: string;
  source: Source;
  logo: boolean;
  themes: string[];
  exemplars: { game: string; position: number; imageId: string }[];
  /** "Promotional banner, landscape 1920x1080, marketing art, logo" */
  headline: string;
  fields: SpecField[];
}

export interface Directive {
  id: string;
  kind: ShotKind;
  level: Level;
  /** Our positions it is about (a new slot's position for ADD/ORIENT); empty = the whole deck. */
  positions: number[];
  strength: Strength;
  evidence: Evidence;
  /** Short line, e.g. "Image 1: copy the competitors' promotional banner". */
  title: string;
  /** The full directive in plain words, with its evidence. */
  text: string;
  /** What should be there (COPY, ADD, ORIENT, RECAPTURE, MESSAGE). */
  spec?: SlotSpec;
  /** What replaces a DROP (always with a full spec), assigned by the deck builder. */
  replacement?: SlotSpec;
  /** For a MESSAGE: the themes to add, or the line to replace. */
  themes?: string[];
  rank: number;
  notes: string[];
}

export const positionWeight = (p: number | undefined) =>
  p === 1 ? 3 : p === 2 ? 2 : p === 3 ? 1.5 : 1;

const KIND_WEIGHT: Record<ShotKind, number> = {
  COPY: 1,
  DROP: 1,
  LENGTH: 1,
  ADD: 0.9,
  ORIENT: 0.9,
  REORDER: 0.7,
  MESSAGE: 0.8,
  RECAPTURE: 0.8,
  RELAYER: 0.5,
  KEEP: 0,
  REVIEW: 0,
};

export function rankOf(kind: ShotKind, strength: Strength, positions: readonly number[]): number {
  const p = positions.length ? Math.min(...positions) : undefined;
  return Math.round(positionWeight(p) * STRENGTH_WEIGHT[strength] * KIND_WEIGHT[kind] * 100) / 100;
}

/** The level a strength gives a change (KEEP and REVIEW are set by the rules themselves). */
export function levelOf(s: Strength, directive: boolean): Level {
  if (s === "consider") return "consider";
  if (!directive) return "test";
  return s === "provisional" ? "provisional" : "directive";
}

/** A change the deck must make (directive or provisional). */
export const isFirm = (d: Pick<Directive, "level">) =>
  d.level === "directive" || d.level === "provisional";

export const LEVEL_WORD: Record<Level, string> = {
  directive: "Do",
  provisional: "Do (provisional)",
  test: "A/B test",
  consider: "Consider",
  keep: "Keep",
  review: "Needs review",
};

/** Sorted by rank (highest first), then position. */
export function byRank(a: Directive, b: Directive): number {
  return (
    b.rank - a.rank ||
    Math.min(99, ...a.positions) - Math.min(99, ...b.positions) ||
    a.kind.localeCompare(b.kind)
  );
}
