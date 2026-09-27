import type { Labeler } from "./labels.ts";
import type { Count, Patterns } from "./patterns.ts";
import type { Interpretation, Recommendations, Review } from "./synthesis-schema.ts";

export const IMG = "../../images/";
export const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const pct = (n: number) => `${Math.round(n * 100)}%`;
const words = (s: string) => s.replace(/_/g, " ");
const list = (cs: readonly Count[], n = 4, name: (k: string) => string = words) =>
  cs
    .slice(0, n)
    .map((c) => `${name(c.key)} ${pct(c.share)}`)
    .join(", ") || "none";

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
    out.push(
      `### Position ${p.position}: ${label(p.screenType)}${p.subtype ? ` / ${label(p.subtype)}` : ""}`,
      "",
      `- **Source:** ${p.source}`,
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
  out.push(
    `Computed from ${p.images} screenshots of ${p.games.length} games. Deck length: ${p.deckLength.min} to ${p.deckLength.max} (median ${p.deckLength.median}).`,
    "",
    "### Order: screen type per position",
    "",
    "| Position | Screenshots | Most used screen types | Marketing layer | Layout |",
    "|---|---|---|---|---|",
    ...p.perPosition.map(
      (x) =>
        `| ${x.position} | ${x.n} | ${list(x.types, 3, label)} | ${pct(x.layerShare)} | ${list(x.proportions, 2)} |`,
    ),
    "",
    "### Screen types used",
    "",
    "| Screen type | Games using it | Screenshots | Positions |",
    "|---|---|---|---|",
    ...p.screenTypes.map(
      (t) =>
        `| ${label(t.key)} | ${t.games} (${pct(t.gameShare)}) | ${t.images} | ${t.positions.join(", ")} |`,
    ),
    "",
    "### Format and layers",
    "",
    `- Image orientation (from the pixel size): ${list(p.orientation.canvas)}. In-game capture orientation: ${list(p.orientation.capture)}.`,
    `- Composition: ${list(p.composition, 4, label)}. In-game captures per image: ${list(p.capturesPerImage, 4)}.`,
    `- Portrait in-game screenshot shown inside a landscape marketing image: ${p.portraitInLandscape.n} images (${pct(p.portraitInLandscape.share)}).`,
    `- Image orientation per country: ${p.orientation.byCountry.map((c) => `${c.market.toUpperCase()} ${list(c.mix, 3)}`).join("; ")}.`,
    `- Marketing layer present: ${pct(p.marketingLayer.share)} (${p.marketingLayer.perGame.map((g) => `${g.name} ${pct(g.share)}`).join(", ")}).`,
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
        `| ${label(t.key)} | ${t.n} | ${pct(t.layerShare)} | ${list(t.maskColours, 3)} | ${list(t.maskShapes, 2)} | ${list(t.textColours, 3)} | ${list(t.textPositions, 2)} | ${list(t.elementKinds, 3)} |`,
    ),
    "",
  );
  return out;
}
