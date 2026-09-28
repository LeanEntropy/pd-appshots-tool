import type { MarketRef } from "../analysis/play-experiments.ts";
import type { Config } from "../config/schema.ts";
import { type AbSectionInput, abEvidence, type PlayContext } from "./ab-section.ts";
/** The project's Play context for a report of these countries (traffic from the Settings page). */
export function playContextOf(config: Config, reportMarkets: MarketRef[]): PlayContext {
  return {
    reportMarkets,
    projectMarkets: config.markets.map((m) => ({ gl: m.gl, hl: m.hl, label: m.label })),
    traffic: { ...config.options.traffic },
    preRegistration: false,
  };
}

/** What the A/B tests call needs for a Pilot or Full check run (one country). */
export function abFactsFor(
  config: Config,
  market: MarketRef,
  x: Pick<AbSectionInput, "fit" | "ourDeckLength" | "deckLength">,
) {
  const play = playContextOf(config, [market]);
  return {
    ...abEvidence({ ...x, market, play }),
    market,
    traffic: play.traffic[market.gl] ?? "unknown (counted as low)",
  };
}
