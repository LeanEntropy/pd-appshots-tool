import { US_MARKET } from "../config/countries.ts";
import type { LoadedConfig } from "../config/load.ts";
import { coreMarket } from "../core/targets.ts";
import type { MarketRef } from "./types.ts";

/**
 * The project's main country (plan-reports 0 and 5B). Until the Settings page stores it, it is
 * the core market, falling back to the United States (English). One accessor, so the setting
 * can back it later without touching the reports code.
 */
export function mainMarket(loaded: LoadedConfig): MarketRef {
  try {
    const m = coreMarket(loaded.config);
    return { gl: m.gl, hl: m.hl, label: m.label };
  } catch {
    return { ...US_MARKET };
  }
}

/** "United States (English)" -> "United States, English", for names like "Pilot (United States, English)". */
export function marketName(m: MarketRef): string {
  return m.label.replace(/\s*\(([^)]+)\)\s*$/, ", $1");
}
