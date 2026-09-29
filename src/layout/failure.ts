/** Why one image's layout was not saved, in plain words (kept in the job and its run log). */
export type LayoutFailureKind = "checks" | "model" | "timeout" | "budget" | "other";

export interface LayoutFailure {
  imageId: string;
  game: string;
  where: string[];
  kind: LayoutFailureKind;
  /** One plain sentence for the user. */
  reason: string;
  /** The exact problems (the last answer's check results, or the model's error). */
  problems: string[];
  /** What this image's calls cost (failed attempts are paid too). */
  usd: number;
  calls: number;
  at: string;
}

const LIMIT = /spending limit/i;
const TIMEOUT = /timed? ?out|timeout|ETIMEDOUT|took too long/i;

/**
 * The hard check results in plain words, one per check (checks.ts layoutProblems; the
 * answer's own wording dropped). Disagreements with the main analysis are notes, never here.
 */
const CHECKS: [RegExp, string][] = [
  [/every element id must be unique/, "two boxes had the same id"],
  [
    /layout\.(inGame|marketing): Too big|must be [SM]1 to [SM]\d+/,
    "more boxes than one layer allows (16 in-game, 10 marketing)",
  ],
  [/has an empty box/, "a box was empty or entirely outside the picture"],
  [/tilt must be between/, "a box was tilted more than 45 degrees"],
  [/draw order must be/, "a box had a negative draw order"],
  [/has role "other" and needs a note/, 'a box of kind "other" had no description'],
  [/note must be at most/, "a box description was too long"],
  [
    /capture -?\d+ does not exist|the image has no captures/,
    "a box pointed at a screenshot area the analysis does not have",
  ],
  [/textRef -?\d+ does not exist/, "a box pointed at a marketing text the analysis does not have"],
  [/focal point must be inside/, "the focal point was outside the picture"],
  [/overlaySharePercent must be/, "the marketing share was not a percentage (0-100)"],
  [
    /(focus\.words|marketingCovers|reinforcement|focusMatch\.reason) must be at most/,
    "a focus text was too long",
  ],
  [/layout: missing/, "the answer had no layout"],
];

/** A schema problem ("img1 layout.marketing.2.box.x: Expected number"): the field it names. */
const FIELD = /layout\.([\w.]+): (.*)$/;

function checkSummary(problems: readonly string[]): string {
  const said = new Set<string>();
  for (const p of problems) {
    const hit = CHECKS.find(([re]) => re.test(p));
    const field = FIELD.exec(p);
    said.add(
      hit
        ? hit[1]
        : field
          ? `the field ${field[1]} did not follow the required format (${field[2]})`
          : `an unexpected check failed (${p.replace(/^img\d+ layout: /, "").slice(0, 80)})`,
    );
  }
  return [...said].slice(0, 3).join("; ");
}

/** The failure's kind and one plain sentence, from the problems the layout call returned. */
export function explainFailure(
  problems: readonly string[],
  model: string,
): { kind: LayoutFailureKind; reason: string } {
  const first = problems[0] ?? "";
  if (!first) return { kind: "other", reason: "No layout came back (no reason was given)." };
  if (LIMIT.test(first))
    return {
      kind: "budget",
      reason: "Stopped by the spending limit before an accepted layout came back.",
    };
  if (first.startsWith(`${model}: `)) {
    const msg = first.slice(model.length + 2).slice(0, 160);
    return TIMEOUT.test(msg)
      ? { kind: "timeout", reason: "The AI call took too long and was stopped." }
      : { kind: "model", reason: `The AI call failed: ${msg}` };
  }
  if (/no longer fits/.test(first))
    return { kind: "other", reason: "The saved layout no longer fits this image's analysis." };
  return {
    kind: "checks",
    reason: `The AI's layout failed the checks on every attempt: ${checkSummary(problems)}.`,
  };
}
