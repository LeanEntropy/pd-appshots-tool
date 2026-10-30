import type { Directive } from "./directives.ts";

/**
 * The directives as hard input for the AI text steps (synthesis.ts), followed by a blank line,
 * or "" when there are none.
 */
export function directiveFacts(directives: readonly Directive[] | undefined): string {
  if (!directives?.length) return "";
  return [
    `PATTERN DIRECTIVES, computed by code: HARD INPUT that the recommended order MUST follow (see the rules). Per position: copy = adopt the competitors' pattern there (same category, orientation and layer structure, built from our own assets); drop = no competitor uses our screen kind, replace it with the given spec. "should" is what SHOULD be there (JSON):\n${JSON.stringify(
      directives.map((d) => ({
        position: d.position,
        directive: d.kind,
        text: d.text,
        dropped: d.dropped,
        should: d.spec.details,
        competitors: d.spec.games,
        screenshotLayer: d.spec.screenshotLayer ? "yes" : "none",
      })),
    )}`,
    "",
  ].join("\n\n");
}
