import { isFirm, LEVEL_WORD } from "./directives.ts";
import type { EngineResult } from "./engine.ts";
import { evidenceText } from "./strength.ts";

/**
 * The skeleton contract for the AI text steps (recommend.v7, recommend-review.v6, ab-tests.v4,
 * patterns.v7): the target deck and its directives as HARD INPUT, with their evidence ids. The AI
 * words, specifies and localises them, and may object; it cannot change them (D8: objections are
 * shown only, never applied).
 */
export function engineFacts(e: EngineResult | null | undefined): string {
  if (!e) return "";
  const directives = e.directives
    .filter((d) => d.kind !== "KEEP")
    .map((d) => ({
      id: d.id,
      kind: d.kind,
      level: LEVEL_WORD[d.level],
      positions: d.positions,
      evidence: `${evidenceText(d.evidence)}${d.evidence.games.length ? ` (${d.evidence.games.join(", ")})` : ""}`,
      n: d.evidence.n,
      of: d.evidence.M,
      text: d.text,
      ...(d.spec ? { spec: d.spec.fields.map((f) => `${f.label}: ${f.value}`) } : {}),
      ...(d.replacement
        ? { replacement: d.replacement.fields.map((f) => `${f.label}: ${f.value}`) }
        : {}),
    }));
  const skeleton = e.skeleton.map((s) => ({
    position: s.position,
    kind: s.kindLabel,
    orientation: s.canvas,
    size: s.size,
    source: s.source,
    logo: s.logo ? "yes" : "no",
    theme: s.themes.join("; ") || "keep its current line unless a directive says otherwise",
    action: s.action,
    fromOurPosition: s.from ?? 0,
    directives: s.directiveIds,
    ...(s.spec ? { spec: s.spec.fields.map((f) => `${f.label}: ${f.value} (${f.agree})`) } : {}),
  }));
  return [
    `TARGET DECK (skeleton), computed by code: HARD INPUT. Recommend exactly ${e.skeleton.length} positions, one per slot, with each slot's kind, orientation, production source, logo and position. "new marketing art" is art built from our logo and assets (never a capture or a recapture of our title screen); "new capture" is a screen to capture from our game: a screen not captured yet is a capture note, never a reason to drop a slot. (JSON):\n${JSON.stringify(skeleton)}`,
    `DIRECTIVES, computed by code, highest rank first: every "why" and every count you write cites these ids and their exact "n of M"; never write a count that is not here. "Do" and "Do (provisional)" must be followed; "A/B test" and "Consider" are test ideas only; "Needs review" means only we show it: never praise it as a differentiator. Leaders: ${e.leaders.note} (JSON):\n${JSON.stringify(directives)}`,
    `Verdict, computed by code: ${e.verdict.word} (${e.verdict.reasons.join("; ")}). Firm directives: ${e.directives.filter(isFirm).length}.`,
    "",
  ].join("\n\n");
}
