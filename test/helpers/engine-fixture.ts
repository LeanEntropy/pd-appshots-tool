import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeckEntry } from "../../src/analysis/patterns.ts";
import { type EngineInput, type EngineResult, runEngine } from "../../src/engine/engine.ts";
import type { GameMarket } from "../../src/engine/leaders.ts";
import type { StoreOfficial } from "../../src/play/store-text.ts";

/**
 * The engine regression fixtures (plan-recommendation-engine section 8): saved analyses, decks,
 * installs and store text of Comfy Mahjong (Pilot, US; store text US, DE, FR) and Rogue Legend
 * (Full check, US), copied from the workspace on 2026-10-31. No images: pixel facts are in them.
 */
export interface Fixture {
  ours: DeckEntry[];
  competitors: DeckEntry[];
  decks: { appId: string; name: string; deckLength: number }[];
  ourDeckLength: number;
  market: GameMarket[];
  meta: {
    markets: { gl: string; hl: string; label: string }[];
    ours: { appId: string; name: string };
    competitors: { appId: string; name: string }[];
    market: GameMarket[];
    text: Record<string, StoreOfficial>;
  };
}

export function fixture(name: "comfy-us" | "rogue-us"): Fixture {
  const path = join(import.meta.dirname, "..", "fixtures", "engine", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

export function input(f: Fixture, withMeta = true): EngineInput {
  const ids = new Set(f.competitors.map((e) => e.appId));
  return {
    theirs: f.competitors,
    ours: f.ours,
    decks: f.decks,
    ourDeckLength: f.ourDeckLength,
    market: f.market.filter((g) => ids.has(g.appId)),
    ...(withMeta
      ? {
          meta: {
            markets: f.meta.markets,
            ours: f.meta.ours,
            competitors: f.meta.competitors,
            market: f.meta.market,
            text: (appId: string, gl: string, hl: string) =>
              f.meta.text[`${appId}|${gl}|${hl}`] ?? null,
          },
        }
      : {}),
  };
}

export const run = (f: Fixture, withMeta = true): EngineResult => runEngine(input(f, withMeta));

/** The firm directives of a kind at a position. */
export const at = (e: EngineResult, kind: string, p?: number) =>
  e.directives.filter((d) => d.kind === kind && (p === undefined || d.positions[0] === p));
