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

/** Check results in plain words, one per kind of problem (the answer's own wording dropped). */
const CHECKS: [RegExp, string][] = [
  [
    /lists a marketing (character|creature)/,
    "a character in the analysis was not marked as a cut-out",
  ],
  [/lists a marketing item/, "no cut-out or badge covered an item in the analysis"],
  [/lists a marketing logo/, "the logo was not marked"],
  [/headline text \d+/, "a headline had no box"],
  [
    /capture \d+ has no in-game element|must name its capture|capture \d+ does not exist/,
    "a screenshot area had no box",
  ],
  [/marketing layer is (absent|present)/, "the marketing layer did not match the analysis"],
  [/Too big|must be [SM]1 to [SM]8/i, "more than 8 boxes in one layer"],
  [/textRef|carry their own text|point at a text/, "a text was not linked correctly"],
];

function checkSummary(problems: readonly string[]): string {
  const said = new Set<string>();
  for (const p of problems) {
    const hit = CHECKS.find(([re]) => re.test(p));
    said.add(hit ? hit[1] : "the answer was malformed");
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
