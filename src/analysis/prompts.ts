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
  patterns: "patterns.v2",
  recommend: "recommend.v2",
  recommendReview: "recommend-review.v1",
} as const;
export type PromptName = keyof typeof PROMPT_VERSIONS;

/**
 * The file each prompt is rendered from (prompts/analysis/<file>.md; a changed file gets a new
 * name). A wording-only revision that keeps the output contract gets a new file under the same
 * contract version, so existing analyses and approvals stay valid. The 2026-09-28 revision only
 * forbids claiming that an art screen is not from the game.
 */
export const PROMPT_FILES: Record<PromptName, string> = {
  fullAnalysis: "full-analysis.v5",
  adjudicate: "adjudicate.v4",
  patterns: "patterns.v3",
  recommend: "recommend.v3",
  recommendReview: "recommend-review.v2",
};

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
  const text = template.replace("{{TAXONOMY}}", tx.list).replace("{{DEFINITIONS}}", tx.definitions);
  const hash = sha256(text);
  const dir = join(objectsDir, "prompts");
  ensureDir(dir);
  const file = join(dir, `${hash}.md`);
  if (!existsSync(file)) writeFileSync(file, text);
  return { text, hash, file };
}
