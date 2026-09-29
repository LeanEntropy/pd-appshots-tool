import { join } from "node:path";
import { loadConfig } from "../../src/config/load.ts";
import type { Config } from "../../src/config/schema.ts";

const REPO = join(import.meta.dirname, "..", "..");

/** The Rogue Legend config with the knowledge-base switch set. */
export function baseConfig(enabled: boolean): Config {
  const { config } = loadConfig(join(REPO, "configs", "rogue-legend.json"));
  return {
    ...config,
    options: { ...config.options, knowledge: { ...config.options.knowledge, enabled } },
  };
}
