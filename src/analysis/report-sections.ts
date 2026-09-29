import { categoryOfType, definitionOf } from "./categories.ts";
import type { Labeler } from "./labels.ts";
import type { Count, Patterns } from "./patterns.ts";
import type { SortingPart } from "./report-sorting.ts";
import {
  type Interpretation,
  logoOf,
  type Recommendations,
  type Review,
} from "./synthesis-schema.ts";

export const IMG = "../../images/";
export const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const words = (s: string) => s.replace(/_/g, " ");
/** "gameplay 12, metagame 8": counts, never percentages (user rule). */
const list = (cs: readonly Count[], n = 4, name: (k: string) => string = words) =>
  cs
    .slice(0, n)
    .map((c) => `${name(c.key)} ${c.n}`)
    .join(", ") || "none";
/** "12 of 40" from a share of a known total. */
const of = (share: number, total: number) => `${Math.round(share * total)} of ${total}`;

/** "How we sort images": the intro and one row per category and tag, with an example. */
export function sortingMarkdown(s: SortingPart | undefined): string[] {
  if (!s) return [];
  const thumb = (e: SortingPart["items"][number]["example"]) =>
    e?.thumb
      ? `[![${e.name} ${e.position}](${IMG}${e.thumb})](${IMG}${e.file ?? e.thumb}) ${cell(e.name)} #${e.position}`
      : "";
  return [
    "### How we sort images",
    "",
    ...s.intro,
    "",
    "| Name | What it is | What sets it apart | Example |",
    "|---|---|---|---|",
    ...s.items.map(
      (i) =>
        `| **${cell(i.label)}** (${i.kind}) | ${cell(i.definition)} | ${cell(i.unlike)} | ${thumb(i.example)} |`,
    ),
    "",
  ];
}

/** "Title screen / full-screen art: one full picture ..." for a category or tag code. */
export function defineLine(code: string): string {
  const d = definitionOf(code);
  return d ? `${d.label}: ${d.definition}` : "";
}

export function recommendationSection(
  r: Recommendations,
  review: Review | null,
  revised: boolean,
  label: Labeler,
  examples: (position: number) => string = () => "",
): string[] {
  const out = ["## Recommendations", "", r.rationale, ""];
  for (const p of [...r.positions].sort((a, b) => a.position - b.position)) {
    const s = p.screenshot;
    const m = p.marketingLayer;
    const logo = logoOf(p);
    const what = defineLine(categoryOfType(p.screenType));
    out.push(
      `### Position ${p.position}: ${label(p.screenType)}${p.subtype ? ` / ${label(p.subtype)}` : ""}`,
      "",
      ...(what ? [`_${what}_`, ""] : []),
      `- **Source:** ${p.source}`,
      ...(logo ? [`- **Game logo:** ${logo.show ? "yes" : "no"}. ${logo.why}`] : []),
      `- **Screenshot to capture:** ${s.whatToCapture} (${s.orientation})`,
      `- **Action:** ${s.action}. **Atmosphere:** ${s.atmosphere}. **Main colours:** ${s.mainColours}`,
    );
    if (!m.present) out.push("- **Marketing layer:** none");
    else {
      const b = m.backgroundMask;
      out.push(
        `- **Layout:** ${m.proportion}`,
        `- **Background mask:** ${b.shape}, ${b.colour}, ${b.location}`,
        "",
        "| Text | Role | Colour | Outline | Font style | Size | Position |",
        "|---|---|---|---|---|---|---|",
        ...m.texts.map(
          (t) =>
            `| ${cell(t.text)} | ${t.role} | ${cell(t.colour)} | ${cell(t.strokeColour)} | ${cell(t.fontStyle)} | ${t.size} | ${words(t.position)} |`,
        ),
        "",
        ...m.elements.map(
          (e) => `- **Extra element:** ${e.what}, at ${e.position}, pose ${e.pose}, ${e.colour}`,
        ),
      );
    }
    out.push(`- **Why:** ${p.why}`);
    const ex = examples(p.position);
    out.push(...(ex ? [`- **Competitor examples:** ${ex}`] : []), "");
  }
  if (review) {
    out.push(
      `### Cross-check of the recommendations`,
      "",
      `Verdict: ${review.verdict === "ok" ? "no major problems" : "changes requested"}${revised ? " (the recommendations above were revised after this review)" : ""}.`,
      "",
      ...review.findings.map(
        (f) =>
          `- ${f.severity === "major" ? "**Major**" : "Minor"}, ${f.position ? `position ${f.position}` : "whole deck"}: ${f.issue} Suggestion: ${f.suggestion}`,
      ),
      "",
    );
  }
  return out;
}

export function patternSection(
  p: Patterns,
  interp: Interpretation | null,
  label: Labeler,
): string[] {
  const out = ["## Patterns across competitors", ""];
  if (interp) {
    out.push(
      interp.summary,
      "",
      ...interp.keyPatterns.map((k) => `- **${k.pattern}** (${k.strength}): ${k.evidence}`),
      "",
    );
    out.push(`How our deck compares, in short: ${interp.oursSummary}`, "");
  }
  const t = p.tags;
  const logoAt = (n: number) => {
    const x = t?.logoPerPosition.find((l) => l.position === n);
    return x ? `${x.n} of ${x.of}` : "";
  };
  out.push(
    `Computed from ${p.images} screenshots of ${p.games.length} games. Deck length: ${p.deckLength.min} to ${p.deckLength.max} (median ${p.deckLength.median}).`,
    "",
    ...(p.repeats?.length
      ? [
          "Same screen uploaded twice (each screen counted once):",
          ...p.repeats.map((r) => `- ${r}`),
          "",
        ]
      : []),
    "### Order: screen type per position",
    "",
    "| Image | Competitors | Most used screen types | Marketing layer | Game logo | Layout |",
    "|---|---|---|---|---|---|",
    ...p.perPosition.map(
      (x) =>
        `| ${x.position} | ${x.n} | ${list(x.types, 3, label)} | ${of(x.layerShare, x.n)} | ${logoAt(x.position)} | ${list(x.proportions, 2)} |`,
    ),
    "",
    "### Screen types used",
    "",
    "| Screen type | Games using it | Images |",
    "|---|---|---|",
    ...p.screenTypes.map(
      (t) => `| ${label(t.key)} | ${t.games} of ${p.games.length} | ${t.images} |`,
    ),
    "",
    "### Format and layers",
    "",
    `- Image orientation (from the pixel size): ${list(p.orientation.canvas)}. In-game capture orientation: ${list(p.orientation.capture)}.`,
    `- Composition: ${list(p.composition, 4, label)}. Screenshot areas per image (0 = full-screen art): ${list(p.capturesPerImage, 4)}.`,
    `- Portrait in-game screenshot shown inside a landscape marketing image: ${p.portraitInLandscape.n} of ${p.images} images.`,
    `- Image orientation per country: ${p.orientation.byCountry.map((c) => `${c.market.toUpperCase()} ${list(c.mix, 3)}`).join("; ")}.`,
    `- Marketing layer present: ${of(p.marketingLayer.share, p.images)} images (${p.marketingLayer.perGame.map((g) => `${g.name} ${of(g.share, p.games.find((x) => x.name === g.name)?.analysed ?? 0)}`).join(", ")}).`,
    ...(t
      ? [
          `- Game logo on the image: ${t.logoPerGame.map((g) => `${g.name} ${g.n} of ${g.of}`).join(", ")}. In the first 3 images: ${t.logoPerGame.filter((g) => g.firstThree).length} of ${t.logoPerGame.length} competitors.`,
          `- Title screen / full-screen art: ${t.art.n} images, ${t.art.withLogo} with the game logo; their line: ${t.art.messages.map((m) => `${label(m.key).toLowerCase()} ${m.n}`).join(", ") || "none"}.`,
        ]
      : []),
    `- Layer vs screenshot: ${list(p.proportion, 5)}.`,
    `- Whole-image colours (measured from the pixels): ${list(p.colours.image, 6)}.`,
    `- In-game capture colours: ${list(p.colours.screenshot, 6)}.`,
    `- Marketing layer colours: ${list(p.colours.layer, 6)}. Mask colours: ${list(p.colours.masks, 6)}. Text colours: ${list(p.colours.texts, 6)}.`,
    `- Mask shapes: ${list(p.maskShapes)}. Mask locations: ${list(p.maskLocations)}. Text positions: ${list(p.textPositions)}. Extra elements: ${list(p.elementKinds)}.`,
    "",
    "### What goes with each screen type",
    "",
    "| Screen type | Screenshots | Layer | Mask colours | Mask shapes | Text colours | Text positions | Extra elements |",
    "|---|---|---|---|---|---|---|---|",
    ...p.byScreenType.map(
      (t) =>
        `| ${label(t.key)} | ${t.n} | ${of(t.layerShare, t.n)} | ${list(t.maskColours, 3)} | ${list(t.maskShapes, 2)} | ${list(t.textColours, 3)} | ${list(t.textPositions, 2)} | ${list(t.elementKinds, 3)} |`,
    ),
    "",
  );
  return out;
}
