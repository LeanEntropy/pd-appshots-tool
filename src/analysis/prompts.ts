import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Taxonomy } from "../config/load.ts";
import { ensureDir } from "../util/fsx.ts";
import { sha256 } from "../util/hash.ts";

/** Prompt files in prompts/analysis/. Changing a file requires a new version name. */
export const PROMPT_VERSIONS = {
  fullAnalysis: "full-analysis.v3",
  adjudicate: "adjudicate.v3",
  patterns: "patterns.v1",
  recommend: "recommend.v1",
  recommendReview: "recommend-review.v1",
} as const;
export type PromptName = keyof typeof PROMPT_VERSIONS;

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
    join(root, "prompts", "analysis", `${PROMPT_VERSIONS[name]}.md`),
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
