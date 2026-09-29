import { type MarketRef, type PlaySetup, playSetup } from "../analysis/play-experiments.ts";
import { appleLangFor } from "../appstore/lang.ts";
import { lowestTraffic, type PpoSetup, ppoSetup } from "../appstore/ppo.ts";
import type { PlayContext } from "./ab-section.ts";

/**
 * Where an A/B test runs, by the report's store (plan-app-store 7.3): a Play store listing
 * experiment on Google Play, a Product Page Optimization test on the App Store (its localisations,
 * 1 or 2 treatments by traffic). Never a Play setup copied onto an App Store test.
 */
export function testSetup(
  play: PlayContext,
  markets: readonly MarketRef[],
  reportMarkets: readonly MarketRef[],
  second: boolean,
): PlaySetup | PpoSetup {
  const traffic = (gl: string) => play.traffic[gl] ?? "unknown";
  if (play.platform === "appstore")
    return ppoSetup(
      markets.map((m) => `${m.label} (${appleLangFor(m.gl, m.hl)})`),
      second ? 2 : 1,
      lowestTraffic(markets.map((m) => traffic(m.gl))),
    );
  return playSetup(markets, reportMarkets, play.projectMarkets, traffic, second);
}
