import type { Cite } from "./cite.ts";
import type { Kb } from "./release.ts";
import type { Selection } from "./retrieve.ts";
import type { Store } from "./schema.ts";
import type { Preset } from "./steps.ts";

/**
 * The knowledge base of one report while it is written (only when the Settings switch is on):
 * the pinned release, the project's genres, the budget preset, the store and country, the shared
 * rules block, and the token cap from the report's cost cap (decision D6). Each step's selection
 * is logged, so the report can say what was used and what was left out.
 */
export interface KbRun {
  kb: Kb;
  /** The pinned release's content hash (the snapshot a report can be rebuilt from). */
  hash: string;
  preset: Preset;
  genres: string[];
  store: Store;
  /** The country of the synthesis steps (two letters, upper case); null = global only. */
  market: string | null;
  rules: string;
  /** Knowledge tokens this report may add in total (from the cost cap); 0 = no cap. */
  capTokens: number;
  used: { tokens: number };
  log: Selection[];
  /** Citation numbers shared by the whole report (the same entry keeps its [n]). */
  cite: (entryIds: readonly string[]) => Cite[];
}

/** The same run for another country (country advice, the main country inside a report). */
export const forCountry = (run: KbRun, gl: string): KbRun => ({ ...run, market: gl.toUpperCase() });

/** A call context narrowed to one country (unchanged when the knowledge base is off). */
export const ctxForCountry = <C extends { kb?: KbRun }>(ctx: C, gl: string): C =>
  ctx.kb ? { ...ctx, kb: forCountry(ctx.kb, gl) } : ctx;
