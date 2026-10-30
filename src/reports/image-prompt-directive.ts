import type { PromptSlot } from "./image-prompt-types.ts";

const bullet = (s: string) => `- ${s}`;

/** The copy or drop directive: the top priority, over the recommended spec where they differ. */
export function directivePart(slot: PromptSlot): string[] {
  const d = slot.directive;
  if (!d) return [];
  return [
    `## TOP PRIORITY: ${d.kind === "drop" ? "drop our current image and replace it" : "copy the competitors' pattern"}`,
    bullet(d.text),
    "What SHOULD be there:",
    ...d.details.map(bullet),
    ...(d.screenshotLayer
      ? []
      : [
          bullet(
            "Screenshot layer: none. A completely new image: the whole image is the marketing layer, built from our own logo and art. Do not rebuild or reuse our title screen.",
          ),
        ]),
    bullet("Where the recommended spec below differs from this, this directive wins."),
    "",
  ];
}
