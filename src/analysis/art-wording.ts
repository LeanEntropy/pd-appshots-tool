/**
 * User rule (2026-09-28): never claim an image is not from the game ("no in-game screenshot",
 * "no gameplay capture", "In-game capture: none"...). Any art screen can be the game's own title,
 * loading or splash screen. Describe what is visible instead.
 *
 * New wording comes from the labels and prompts. Text written before the rule (saved analyses,
 * model notes, recommendations, reports) is reworded here for display, by code only: no AI call
 * and no re-analysis.
 */
export const ART_SCREEN = "full-screen art (title / loading style)";
export const ART_SCREEN_LABEL = "Full-screen art (title / loading style)";
const MAY = "art screen, may be shown in the game";

const RULES: [RegExp, string][] = [
  [/\bmarketing image, no screenshot\b/gi, ART_SCREEN],
  [/\bart only,? \(?no (?:in-game )?screenshot\)?/gi, ART_SCREEN],
  [
    /\bpure (?:marketing |promotional )?art with no (?:in-game )?(?:screenshot|capture)(?: in it)?/gi,
    ART_SCREEN,
  ],
  [/\bmarketing images with no (?:in-game )?screenshots?\b/gi, "full-screen art images"],
  [/\bmarketing image with no (?:in-game )?screenshot\b/gi, "full-screen art image"],
  [/\bcontains? no in-game (?:UI )?(?:or )?capture\b/gi, "is full-screen art"],
  [
    /\bNo in-game (?:UI )?(?:or )?(?:capture|screenshot)s?(?: is visible)?/g,
    `Art screen (may be shown in the game)`,
  ],
  [
    /\b(?:with )?no in-game (?:UI )?(?:or )?(?:capture|screenshot)s?(?: is visible| in it)?/gi,
    `(${MAY})`,
  ],
  [/\b(?:with )?no gameplay (?:capture|screenshot)s?\b/gi, `(${MAY})`],
  [/\bno capture, /gi, "full-screen art, "],
  [
    /\bIn-game capture: none\b/gi,
    "Art screen: title / loading / splash style (may be shown in the game)",
  ],
  [/\b0% (?:of the image )?(?:is )?in-game capture\b/gi, ART_SCREEN],
  [/\bnot (?:taken )?from the game\b/gi, "possibly shown in the game"],
  [/\bwith no screenshot\b/gi, "as full-screen art"],
];

/** Rewords one text to the rule; text without those claims comes back unchanged. */
export function artWording(text: string): string {
  let out = text;
  // A match that starts a sentence keeps its capital letter.
  const keepCase = (m: string, to: string) =>
    /^[A-Z]/.test(m) && /^[a-z]/.test(to) ? to.charAt(0).toUpperCase() + to.slice(1) : to;
  for (const [re, to] of RULES) out = out.replace(re, (m) => keepCase(m, to));
  return out;
}

/** Every string inside a JSON-like value, reworded (objects and arrays are copied). */
export function artWordingDeep<T>(value: T): T {
  if (typeof value === "string") return artWording(value) as T;
  if (Array.isArray(value)) return value.map((v) => artWordingDeep(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = artWordingDeep(v);
    return out as T;
  }
  return value;
}
