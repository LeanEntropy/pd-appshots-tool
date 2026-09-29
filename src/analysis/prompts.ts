import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Taxonomy } from "../config/load.ts";
import type { Config } from "../config/schema.ts";
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
 * logo does not count), wording only, so no analysis is redone. full-analysis.v8 (lean: v9,
 * 2026-09-29) adds the text-reading rules (one entry per visually separate block, exact spaces
 * and punctuation, game UI text is not marketing text): the answer shape is unchanged, so saved
 * analyses stay current and only new analyses read text with the new rules.
 */
export const PROMPT_FILES: Record<PromptName, string> = {
  fullAnalysis: "full-analysis.v8",
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

/**
 * The prompts of the country reports (plan-reports 2.4, 3, 3A), each a contract version and its
 * file. Kept apart from PROMPT_VERSIONS on purpose: those are part of the Pilot's and the Full
 * check's fingerprints, and a new report step must not make their AI parts look out of date.
 */
export const REPORT_PROMPTS = {
  layerDiff: "layer-diff.v1",
  countryAdvice: "country-advice.v1",
  countryAdviceReview: "country-advice-review.v1",
  conceptMap: "concept-map.v1",
} as const;
export type ReportPromptName = keyof typeof REPORT_PROMPTS;

/** Renders a prompt of the country reports (REPORT_PROMPTS), like renderPrompt. */
export function renderReportPrompt(
  root: string,
  objectsDir: string,
  name: ReportPromptName,
  taxonomy: Taxonomy,
): RenderedPrompt {
  return renderFile(root, objectsDir, REPORT_PROMPTS[name], taxonomy);
}

/**
 * The lean full-analysis prompt (plan-analysis-speed item 5): its own contract version, kept
 * apart from PROMPT_VERSIONS so plans and reports made with today's prompt keep their keys.
 */
export const LEAN_FULL_ANALYSIS = {
  version: "full-analysis.v5",
  file: "full-analysis.v9",
} as const;

/**
 * The layout block (plan-layout-wireframes 2.4), added after the producer's full-analysis prompt
 * when layout capture is on. The second opinion never gets it. It changes the rendered text (so
 * the answer-cache key), never the analysis key: the layout is saved in its own file.
 */
export const LAYOUT_BLOCK_FILE = "layout-block.v1";

/** The full-analysis prompt of either answer shape, with the layout block when asked. */
export function renderAnalysisPrompt(
  root: string,
  objectsDir: string,
  taxonomy: Taxonomy,
  lean: boolean,
  layout = false,
): RenderedPrompt {
  const file = lean ? LEAN_FULL_ANALYSIS.file : PROMPT_FILES.fullAnalysis;
  return renderFile(root, objectsDir, file, taxonomy, layout ? LAYOUT_BLOCK_FILE : null);
}

/** The producer's prompt with the layout block when layout capture is on (Settings), else null. */
export function layoutPromptFor(
  root: string,
  objectsDir: string,
  taxonomy: Taxonomy,
  config: Config,
): RenderedPrompt | null {
  const s = config.options.speed;
  return s.layoutCapture
    ? renderAnalysisPrompt(root, objectsDir, taxonomy, s.leanAnswer, true)
    : null;
}

/** Renders a versioned prompt with the taxonomy and stores it by content hash. */
export function renderPrompt(
  root: string,
  objectsDir: string,
  name: PromptName,
  taxonomy: Taxonomy,
): RenderedPrompt {
  return renderFile(root, objectsDir, PROMPT_FILES[name], taxonomy);
}

function renderFile(
  root: string,
  objectsDir: string,
  fileName: string,
  taxonomy: Taxonomy,
  block: string | null = null,
): RenderedPrompt {
  const read = (name: string) =>
    readFileSync(join(root, "prompts", "analysis", `${name}.md`), "utf8");
  const template = block
    ? `${read(fileName).trimEnd()}\n\n${read(block).trim()}\n`
    : read(fileName);
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
