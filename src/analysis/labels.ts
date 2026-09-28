import type { Taxonomy } from "../config/load.ts";
import { definitionOf } from "./categories.ts";

/** Display name for a screen type or subtype code. */
export type Labeler = (code: string) => string;

/** "board_dice" -> "Board dice": the fallback when the taxonomy has no display name. */
export function humanise(code: string): string {
  const s = code.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Display names: the report's defined screen categories and tags first (categories.ts), then the
 * taxonomy (type labels and subtype labels), humanised otherwise.
 */
export function labeler(t?: Pick<Taxonomy, "screenTypes" | "subtypeLabels">): Labeler {
  const m = new Map<string, string>(Object.entries(t?.subtypeLabels ?? {}));
  for (const s of t?.screenTypes ?? []) m.set(s.id, s.label);
  return (code) => definitionOf(code)?.label ?? m.get(code) ?? humanise(code);
}

export const plainLabel: Labeler = labeler();

/** "Gameplay / Battle". */
export function screenName(label: Labeler, type: string, subtype: string): string {
  return subtype ? `${label(type)} / ${label(subtype)}` : label(type);
}
