import { kbRulesText } from "../analysis/prompts.ts";
import type { Config } from "../config/schema.ts";
import type { Storage } from "../storage/index.ts";
import { kbFiles } from "../storage/kb-files.ts";
import { citeNumberer } from "./cite.ts";
import { capTokens } from "./cost.ts";
import { loadKb, pinRelease } from "./release.ts";
import type { KbRun } from "./run.ts";

export const today = () => new Date().toISOString().slice(0, 10);

/**
 * The knowledge base for one report, or undefined when the Settings switch is off (the default
 * until the evaluation passes), when no release has been made yet, or when the release has
 * problems (it is then not used at all, and the terminal says why). The release is pinned: an
 * immutable copy is stored in the shared library under its content hash.
 */
export function openKbRun(
  config: Config,
  root: string,
  storage: Storage,
  gl: string | null,
  date = today(),
): KbRun | undefined {
  const k = config.options.knowledge;
  if (!k.enabled) return undefined;
  const kb = loadKb(kbFiles(root), "release", date);
  if (kb.problems.length) {
    console.error(`Knowledge base not used: ${kb.problems.slice(0, 3).join("; ")}`);
    return undefined;
  }
  if (!kb.entries.length) return undefined;
  const hash = pinRelease(storage, kb);
  return {
    kb,
    hash,
    preset: k.preset,
    genres: Object.entries(k.genres)
      .filter(([, on]) => on)
      .map(([g]) => g),
    store: "google_play",
    market: gl ? gl.toUpperCase() : null,
    rules: kbRulesText(root),
    capTokens: capTokens(config),
    used: { tokens: 0 },
    log: [],
    cite: citeNumberer(kb),
  };
}
