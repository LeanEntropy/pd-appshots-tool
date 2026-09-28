import { FULL_SCREEN_ART, TAGS } from "./categories.ts";
import { artMessage, lines, showsLogo } from "./image-tags.ts";
import type { Labeler } from "./labels.ts";
import type { AddFit } from "./pattern-fit.ts";
import { basisOf } from "./pattern-fit-parts.ts";
import { type DeckEntry, type Patterns, typeKey } from "./patterns.ts";

/**
 * The tag patterns (after the screen type): what the art at a position says and whether it
 * shows the game logo, compared only where our image has the same type ("compare by type first,
 * then by message"), and where the logo sits across the whole deck.
 */
const logo = (e: DeckEntry) => showsLogo(e.final, e.name);
const hasLine = (e: DeckEntry) => lines(e.final, e.name).length > 0;
const message = (e: DeckEntry) => artMessage(e.final, e.name);
const tagName = (k: string) => (TAGS[k]?.label ?? k).toLowerCase();

export function tagFits(
  theirs: readonly DeckEntry[],
  ours: readonly DeckEntry[],
  p: Patterns,
  g: number,
  label: Labeler,
  add: AddFit,
): void {
  const art = label(FULL_SCREEN_ART).toLowerCase();
  for (const at of p.perPosition) {
    if (at.n < 2 || at.top?.key !== FULL_SCREEN_ART || at.types[1]?.share === at.top.share)
      continue;
    const mine = ours.find((e) => e.position === at.position);
    if (!mine || typeKey(mine.final) !== FULL_SCREEN_ART) continue;
    const here = theirs.filter(
      (e) => e.position === at.position && typeKey(e.final) === FULL_SCREEN_ART,
    );
    const m = here.length;
    if (m < 2) continue;
    const where = at.position === 1 ? "Opening art" : `Image ${at.position} art`;
    const of = `competitors' ${art} at image ${at.position}`;

    // The line: counted with event or offer lines, which are reported but never copied, so a
    // share that needs them to reach "pattern" stays a partial pattern.
    const withLine = here.filter(hasLine);
    const events = withLine.filter((e) => message(e) === "event_offer").length;
    const lineWins = withLine.length * 2 >= m;
    const lineHits = lineWins ? withLine : here.filter((e) => !hasLine(e));
    const oursLine = hasLine(mine);
    add({
      basis: {
        ...basisOf(lineHits, lineHits.length, m, "games", [at.position]),
        ours: oursLine === lineWins ? [] : [at.position],
      },
      id: `position-${at.position}-message`,
      group: "order",
      share: lineHits.length / m,
      cap: lineWins && (withLine.length - events) * 5 < m * 4 ? "partial" : undefined,
      categories: [FULL_SCREEN_ART, message(mine), ...lineHits.map(message)],
      text: lineWins
        ? `${where} carries a line beyond the logo`
        : `${where} carries no line beyond the logo`,
      evidence: `${lineHits.length} of ${m} ${of}${lineWins && events ? ` (${events} of them ${tagName("event_offer")} lines: reported, not to copy)` : ""}`,
      fits: oursLine === lineWins,
      reason: `ours: ${tagName(message(mine))}`,
    });

    const withLogo = here.filter(logo);
    const logoWins = withLogo.length * 2 >= m;
    const logoHits = logoWins ? withLogo : here.filter((e) => !logo(e));
    add({
      basis: {
        ...basisOf(logoHits, logoHits.length, m, "games", [at.position]),
        ours: logo(mine) === logoWins ? [] : [at.position],
      },
      id: `position-${at.position}-logo`,
      group: "order",
      share: logoHits.length / m,
      categories: [FULL_SCREEN_ART, "logo"],
      text: logoWins ? `${where} shows the game logo` : `${where} has no game logo`,
      evidence: `${logoHits.length} of ${m} ${of}`,
      fits: logo(mine) === logoWins,
      reason: logo(mine) ? "ours shows the logo" : "ours has no logo",
    });
  }

  // The logo across the deck: seen without scrolling, and on most images.
  const games = [...new Set(theirs.map((e) => e.appId))];
  if (g < 2 || !ours.length) return;
  const deck = (id: string) => theirs.filter((e) => e.appId === id);
  const firstThree = games.filter((id) => deck(id).some((e) => e.position <= 3 && logo(e)));
  const oursFirst = ours.some((e) => e.position <= 3 && logo(e));
  add({
    basis: {
      ...basisOf(
        theirs.filter((e) => e.position <= 3 && logo(e)),
        firstThree.length,
        g,
        "games",
        [1, 2, 3],
      ),
      ours: oursFirst ? [] : [1],
    },
    id: "logo-first-3",
    group: "layer",
    share: firstThree.length / g,
    categories: ["logo"],
    text: "The game logo appears in the first 3 images",
    evidence: `${firstThree.length} of ${g} competitors`,
    fits: oursFirst,
    reason: oursFirst
      ? `ours too (image ${ours.filter((e) => e.position <= 3 && logo(e)).map((e) => e.position)[0]})`
      : "ours has no logo in the first 3 images",
  });
  const most = games.filter((id) => deck(id).filter(logo).length * 2 > deck(id).length);
  const oursMost = ours.filter(logo).length * 2 > ours.length;
  add({
    basis: {
      ...basisOf(theirs.filter(logo), most.length, g, "games", []),
      ours: oursMost ? [] : ours.filter((e) => !logo(e)).map((e) => e.position),
    },
    id: "logo-most",
    group: "layer",
    share: most.length / g,
    categories: ["logo"],
    text: "The game logo on most images",
    evidence: `${most.length} of ${g} competitors`,
    fits: oursMost,
    reason: `ours: ${ours.filter(logo).length} of ${ours.length} images`,
  });
}
