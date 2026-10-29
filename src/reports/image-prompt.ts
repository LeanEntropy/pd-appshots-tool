import type { StoreRules } from "./image-prompt-rules.ts";
import type {
  ImageFacts,
  OursFacts,
  PromptPlace,
  PromptSlot,
  SlotSpec,
} from "./image-prompt-types.ts";

export type { ImageFacts, OursFacts, PromptPlace, PromptSlot, SlotSpec };

/**
 * "Write an image prompt" (user, 2026-10-30): a prompt that tells Claude how to make the best
 * store image for one position, built by code from data the report already has (free, no AI
 * call, the same answer every time). Plain headings and bullets, so it pastes well into Claude.
 */
const bullet = (s: string) => `- ${s}`;
/** A bullet only when the value is known (a spec written from a country line has gaps). */
const opt = (label: string, v: string) => (v.trim() ? bullet(`${label}${v.trim()}`) : "");
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * "5 of 8: portrait; 3 of 8: landscape", most first. Counts are out of the images where the value
 * is known; when that is fewer than all of them, the line says so ("known for 3 of 8").
 */
export function countLine(values: readonly string[], total = values.length): string {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  const known = [...n.values()].reduce((a, b) => a + b, 0);
  const line = [...n]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, c]) => `${c} of ${known}: ${k}`)
    .join("; ");
  return line && known < total ? `${line} (known for ${known} of ${total})` : line;
}

function competitorPart(slot: PromptSlot): string[] {
  const cs = slot.competitors;
  if (!cs.length)
    return [
      "## What competitors show at this position",
      bullet("No competitor has an analysed image here."),
    ];
  const n = cs.length;
  const yes = (xs: (boolean | null)[]) => xs.filter((x) => x === true).length;
  const lines = [
    `## What competitors show at position ${slot.position} (${n} games)`,
    bullet(
      `Screen type: ${countLine(
        cs.map((c) => c.screen),
        n,
      )}`,
    ),
    bullet(
      `Focus (what the screenshot highlights): ${
        countLine(
          cs.map((c) => c.focus.split(":")[0] ?? ""),
          n,
        ) || "not analysed yet"
      }`,
    ),
    bullet(
      `Layer structure: ${countLine(
        cs.map((c) => c.structure),
        n,
      )}`,
    ),
    bullet(
      `Layout: ${countLine(
        cs.map((c) => c.layout),
        n,
      )}`,
    ),
    bullet(
      `Image orientation: ${countLine(
        cs.map((c) => c.orientation),
        n,
      )}`,
    ),
    bullet(
      `Marketing layer: ${yes(cs.map((c) => c.layer))} of ${n}. Game logo on the image: ${yes(cs.map((c) => c.logo))} of ${n}.`,
    ),
  ];
  const heads = cs.filter((c) => c.headline);
  if (heads.length) {
    const avg = Math.round(
      heads.reduce((s, c) => s + words(c.headlineEn || c.headline), 0) / heads.length,
    );
    lines.push(
      bullet(
        `Headline: ${heads.length} of ${n} have one, about ${avg} words on average. Size and place: ${countLine(
          heads.map((c) => c.headlineStyle),
          heads.length,
        )}`,
      ),
    );
  }
  const bands = cs.filter((c) => c.band);
  if (bands.length)
    lines.push(
      bullet(
        `Bands and masks: ${countLine(
          bands.map((c) => c.band),
          bands.length,
        )}`,
      ),
    );
  const cuts = cs.filter((c) => c.cutOut).length;
  if (cuts) lines.push(bullet(`Cut-out character over the scene: ${cuts} of ${n}`));
  lines.push("", "Examples (from their analyses):");
  for (const c of examples(cs)) lines.push(bullet(describe(c)));
  return lines;
}

/** Up to 3 examples: the richest descriptions, one per game. */
function examples(cs: readonly ImageFacts[]): ImageFacts[] {
  const score = (c: ImageFacts) =>
    Number(!!c.headline) + Number(!!c.focus) + Number(!!c.description);
  return [...cs].sort((a, b) => score(b) - score(a)).slice(0, 3);
}

function describe(c: ImageFacts): string {
  const head = c.headline
    ? `headline "${c.headline}"${c.headlineEn && c.headlineEn !== c.headline ? ` ("${c.headlineEn}")` : ""}${c.headlineStyle ? `, ${c.headlineStyle}` : ""}${c.headlineFont ? `, ${c.headlineFont}` : ""}`
    : "no headline";
  return [
    `${c.name}: ${c.screen}, ${c.orientation}${c.structure ? `, ${c.structure}` : ""}.`,
    c.description ? `Shows: ${c.description}` : "",
    c.focus ? `Focus: ${c.focus}.` : "",
    `Marketing: ${c.layer ? [c.band, head, c.cutOut, c.logo ? "game logo" : ""].filter(Boolean).join("; ") : "none"}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function oursPart(o: OursFacts | null, position: number): string[] {
  if (!o) return ["## Our current image", bullet(`We have no image at position ${position} yet.`)];
  return [
    `## Our current image at position ${position}`,
    bullet(
      `${o.screen}, ${o.orientation}${o.size ? ` (${o.size})` : ""}, ${o.structure || "structure not analysed"}.`,
    ),
    o.description ? bullet(`Shows: ${o.description}`) : "",
    o.focus
      ? bullet(`Focus: ${o.focus}${o.focusMatch ? `. Headline vs focus: ${o.focusMatch}` : ""}`)
      : "",
    bullet(
      `Marketing: ${o.layer ? [o.band, o.headline ? `headline "${o.headline}"${o.headlineEn && o.headlineEn !== o.headline ? ` ("${o.headlineEn}")` : ""}` : "no headline", o.cutOut].filter(Boolean).join("; ") : "none"}. Game logo: ${o.logo ? "yes" : "no"}.`,
    ),
    bullet(`Compared with competitors: ${o.verdict || "not compared yet"}.`),
    ...(o.issues.length ? ["What to fix:", ...o.issues.map(bullet)] : []),
  ].filter(Boolean);
}

function headlineLines(s: SlotSpec, place: PromptPlace): string[] {
  const head = s.texts.find((t) => t.role === "headline") ?? s.texts[0];
  const out: string[] = [];
  if (s.local?.headline) {
    out.push(bullet(`Headline (${place.language}, exactly): "${s.local.headline}"`));
    out.push(bullet(`English meaning: "${s.local.english || head?.text || ""}"`));
    if (s.local.subline) out.push(bullet(`Second line (${place.language}): "${s.local.subline}"`));
    if (s.local.notes) out.push(bullet(`Wording notes: ${s.local.notes}`));
  } else if (head) {
    out.push(
      place.english
        ? bullet(`Headline (English, exactly): "${head.text}"`)
        : bullet(
            `Headline: write it in ${place.language} with the genre words local games use; English meaning: "${head.text}"`,
          ),
    );
  }
  for (const t of s.texts)
    if ((t !== head || !s.local?.headline) && t.style)
      out.push(
        bullet(`${t.role === "headline" ? "Headline style" : `${t.role} "${t.text}"`}: ${t.style}`),
      );
  return out;
}

function specPart(s: SlotSpec | null, place: PromptPlace, position: number): string[] {
  if (!s)
    return [
      "## Recommended spec",
      bullet(
        "No recommendation is written for this position yet. Use the competitor summary above: match what most of them do, then make ours clearer and stronger.",
      ),
    ];
  const layer = s.layerPresent
    ? [
        opt("Layout: ", s.layout),
        opt("Band or mask: ", s.local?.band || s.mask),
        ...headlineLines(s, place),
        ...s.elements.map((e) => bullet(`Extra element: ${e}`)),
      ]
    : [bullet("No marketing layer: the clean in-game screen only.")];
  return [
    `## Recommended spec for position ${position}: ${s.screen}`,
    bullet(`Source: ${s.source}`),
    bullet(`Screen to capture from OUR game (${s.orientation}): ${s.whatToCapture}`),
    opt("What is happening: ", s.action),
    opt("Mood: ", s.atmosphere.replace(/[.\s]+$/, "")),
    opt("Main colours: ", s.mainColours),
    "Marketing layer (wireframe):",
    ...layer,
    bullet(
      `Game logo: ${s.logo ? `${s.logo.show ? "yes" : "no"}. ${s.logo.why}` : "follow the competitors' count above"}`,
    ),
    bullet(`Why: ${s.why}`),
    bullet(
      "The marketing layer must reinforce the screenshot's focus: the headline names what the screen shows, and the layer never hides that part.",
    ),
  ].filter(Boolean);
}

/** The full prompt for one position. */
export function imagePrompt(place: PromptPlace, slot: PromptSlot, rules: StoreRules): string {
  const s = slot.spec;
  const orientation = s?.orientation || slot.ours?.orientation || "portrait";
  const notes = rules.slotNotes(s?.screenType ?? "", slot.position);
  const lines = [
    `# Store image ${slot.position} of ${place.deckLength} for ${place.game}`,
    "",
    "## Your role and goal",
    bullet(
      `You are a senior mobile-game store artist. Make the brief for store page image ${slot.position} of ${place.game} on ${rules.name}, ${place.country} (page language: ${place.language}).`,
    ),
    bullet(
      "Goal: an image on par with or better than what the competitors below show at this position, so more page visitors install the game.",
    ),
    "",
    `## ${rules.name} hard requirements (never break these)`,
    ...rules.hard.map(bullet),
    "",
    "## Review risks (avoid)",
    ...rules.risks.map(bullet),
    ...notes.map(bullet),
    "",
    ...competitorPart(slot),
    "",
    ...oursPart(slot.ours, slot.position),
    "",
    ...specPart(s, place, slot.position),
    "",
    "## Truthful screenshot",
    bullet(
      `Use our real ${place.game} screenshot or our own game assets (characters, logo, art) as the base. Never invent gameplay, screens, characters or features the game does not have.`,
    ),
    bullet(
      "If the screen to capture is not in the material you have, ask for that capture instead of drawing it.",
    ),
    "",
    "## Output requirements",
    bullet(`Exact size: ${rules.size(orientation)}. ${rules.format}.`),
    bullet(
      "Safe areas: keep the headline, the logo and faces inside the middle 90% of the width and away from the top and bottom 5%.",
    ),
    bullet(
      "Legible at thumbnail size (about 25% scale): big, high-contrast headline with an outline or shadow.",
    ),
    bullet("Headline at most about 5 words."),
    "",
    "## Checklist before you finish",
    bullet("[ ] Exact pixel size and format"),
    bullet("[ ] Real in-game screen of our game, nothing invented"),
    bullet('[ ] No price, "Free", ranking, award or other store\'s badge'),
    bullet("[ ] Headline in the page language, 5 words or fewer, readable small"),
    bullet("[ ] Marketing layer reinforces the screenshot's focus"),
    bullet("[ ] As strong as or stronger than the competitor examples"),
    "",
    "Answer with: the layout as a short wireframe description, the exact texts, and then the finished image (or step-by-step instructions to make it from our assets).",
  ];
  return lines.join("\n");
}

/** Every position's prompt, one after the other ("Copy all prompts"). */
export function deckPrompts(
  place: PromptPlace,
  slots: readonly PromptSlot[],
  rules: StoreRules,
): string {
  const head = `Store images for ${place.game} on ${rules.name}, ${place.country}: ${slots.length} prompts, one per position. Make them as one set: same style, no two images with the same message.`;
  return [head, ...slots.map((s) => imagePrompt(place, s, rules))].join("\n\n---\n\n");
}
