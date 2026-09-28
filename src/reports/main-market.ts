import type { LoadedConfig } from "../config/load.ts";
import { settingsOf } from "../settings/access.ts";
import type { MarketRef } from "./types.ts";

/**
 * The project's main country as the reports store it: the Settings page's value
 * (settingsOf(config).mainMarket, itself core/targets mainMarket), reduced to a MarketRef.
 */
export function mainMarketRef(loaded: LoadedConfig): MarketRef {
  const m = settingsOf(loaded.config).mainMarket;
  return { gl: m.gl, hl: m.hl, label: m.label };
}

/** "United States (English)" -> "United States, English", for names like "Pilot (United States, English)". */
export function marketName(m: MarketRef): string {
  return m.label.replace(/\s*\(([^)]+)\)\s*$/, ", $1");
}
