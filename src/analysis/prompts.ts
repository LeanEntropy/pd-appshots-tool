import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Taxonomy } from "../config/load.ts";
import { ensureDir } from "../util/fsx.ts";
import { sha256 } from "../util/hash.ts";

/**
 * Prompt contract versions: part of every analysis key and plan fingerprint, so a new contract
 * version means re-analysis. Changing what a prompt asks for requires a new contract version.
 */
export const PROMPT_VERSIONS = {
  fullAnalysis: "full-analysis.v4",
  adjudicate: "adjudicate.v3",
  // 2026-09-29: one "Title screen / full-screen art" category, the game-logo and art-message
  // tags, counts not percentages, event lines never copied, and a logo decision per recommended
  // image (a new recommendation field). Text steps only: the per-image prompts (and so every
  // analysis key) are unchanged.
  patterns: "patterns.v4",
  recommend: "recommend.v4",
  recommendReview: "recommend-review.v3",
  abTests: "ab-tests.v2",
} as const;
export type PromptName = keyof typeof PROMPT_VERSIONS;

/**
 * The file each prompt is rendered from (prompts/analysis/<file>.md; a changed file gets a new
 * name). A wording-only revision that keeps the output contract gets a new file under the same
 * contract version, so existing analyses and approvals stay valid. The 2026-09-28 revision only
 * forbids claiming that an art screen is not from the game. full-analysis.v6 (2026-09-29) removes
 * the title vs feature contradiction with the taxonomy (the game's logo decides; a publisher's
 * logo does not count), wording only, so no analysis is redone.
 */
export const PROMPT_FILES: Record<PromptName, string> = {
  fullAnalysis: "full-analysis.v6",
  adjudicate: "adjudicate.v4",
  patterns: "patterns.v5",
  recommend: "recommend.v5",
  recommendReview: "recommend-review.v4",
  abTests: "ab-tests.v2",
};

/** The one voice block of every synthesis prompt (plan-reports 3B.1), as {{VOICE}}. */
export const VOICE_FILE = "voice-cmo.v1";

export interface RenderedPrompt {
  text: string;
  hash: string;
  /** File holding the rendered text (for Claude's --system-prompt-file). */
  file: string;
}

export function taxonomyText(t: Taxonomy): { list: string; definitions: string } {
  const list = t.screenTypes
    .map((s) => `- ${s.id} (${s.label}): ${s.subtypes.join(", ") || "(explain in notes)"}`)
    .join("\n");
  const definitions =
    Object.entries(t.definitions)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join("\n") || "- none";
  return { list, definitions };
}

/** Renders a versioned prompt with the taxonomy and stores it by content hash. */
export function renderPrompt(
  root: string,
  objectsDir: string,
  name: PromptName,
  taxonomy: Taxonomy,
): RenderedPrompt {
  const template = readFileSync(
    join(root, "prompts", "analysis", `${PROMPT_FILES[name]}.md`),
    "utf8",
  );
  const tx = taxonomyText(taxonomy);
  const voice = template.includes("{{VOICE}}")
    ? readFileSync(join(root, "prompts", "analysis", `${VOICE_FILE}.md`), "utf8").trim()
    : "";
  const text = template
    .replace("{{TAXONOMY}}", tx.list)
    .replace("{{DEFINITIONS}}", tx.definitions)
    .replace("{{VOICE}}", voice);
  const hash = sha256(text);
  const dir = join(objectsDir, "prompts");
  ensureDir(dir);
  const file = join(dir, `${hash}.md`);
  if (!existsSync(file)) writeFileSync(file, text);
  return { text, hash, file };
}
