import { lines } from "../analysis/image-tags.ts";
import type { DeckEntry } from "../analysis/patterns.ts";
import { type EngineCtx, gameOf } from "./context.ts";
import { type Directive, levelOf, rankOf } from "./directives.ts";
import { imageThemes } from "./spec.ts";
import { evidenceOf, evidenceText, isDirective, strengthOf } from "./strength.ts";
import { mechanicOnly, type Theme, themeLabel } from "./themes.ts";

/**
 * MESSAGE rules (plan 5.3-8): a headline theme most competitors' images carry and ours do not is
 * added; our lines that only name a play action (e.g. "MATCH & CLEAR") are replaced with a
 * benefit; our image whose headline does not match what it shows is reported. Image text and
 * store text are separate evidence lines (store text: rules-meta.ts).
 */
type Draft = Omit<Directive, "id">;

const gameThemes = (es: readonly DeckEntry[]): Set<Theme> =>
  new Set(es.flatMap(imageThemes).filter((t) => t !== "mechanic"));

export function messageRules(ctx: EngineCtx): Draft[] {
  const out: Draft[] = [];
  const per = ctx.games.map((g) => ({
    g,
    themes: gameThemes(ctx.theirs.filter((e) => e.appId === g.appId)),
  }));
  const ours = gameThemes(ctx.ours);
  const all = [...new Set(per.flatMap((x) => [...x.themes]))] as Theme[];
  for (const t of all) {
    if (ours.has(t)) continue;
    const doers = per.filter((x) => x.themes.has(t)).map((x) => x.g);
    const imgs = ctx.theirs.filter((e) => imageThemes(e).includes(t));
    const e = evidenceOf(
      doers,
      ctx.games,
      ctx.leaders,
      imgs.map((x) => x.imageId),
    );
    const s = strengthOf(e);
    // One game in many is noise, not a test idea.
    if (!isDirective(s) && (e.n < 2 || e.n * 4 < e.M) && e.M > 2) continue;
    const ex = imgs
      .slice(0, 3)
      .map((x) => `"${lines(x.final, x.name)[0] ?? ""}" (${x.name} #${x.position})`);
    out.push({
      kind: "MESSAGE",
      level: levelOf(s, isDirective(s)),
      positions: [],
      strength: s,
      evidence: e,
      title: `Add the benefit "${themeLabel(t)}"`,
      text: `Headline benefit "${themeLabel(t)}": ${evidenceText(e)} use it on an image (${ex.join(", ")}); none of ours does. Put it on a new or replaced image.`,
      themes: [t],
      rank: rankOf("MESSAGE", s, []),
      notes: [],
    });
  }
  // Benefit lines: games whose image lines carry at least one benefit theme.
  const sellers = per.filter((x) => x.themes.size).map((x) => x.g);
  const be = evidenceOf(sellers, ctx.games, ctx.leaders);
  const bs = strengthOf(be);
  for (const o of ctx.ours) {
    const mech = lines(o.final, o.name).filter(mechanicOnly);
    if (mech.length && isDirective(bs, o.position))
      out.push({
        kind: "MESSAGE",
        level: levelOf(bs, true),
        positions: [o.position],
        strength: bs,
        evidence: be,
        title: `Image ${o.position}: replace "${mech[0]}"`,
        text: `Image ${o.position}: "${mech[0]}" only names a play action. ${evidenceText(be)} sell a benefit on their images instead: replace it with a benefit we do not show yet.`,
        themes: [],
        rank: rankOf("MESSAGE", bs, [o.position]),
        notes: ["mechanic-only line"],
      });
    if (o.attrs?.focusMatch === "mismatch") {
      const head = lines(o.final, o.name)[0] ?? "";
      out.push({
        kind: "MESSAGE",
        level: "directive",
        positions: [o.position],
        strength: "majority",
        evidence: evidenceOf([], [gameOf(o)], ctx.leaders, [o.imageId]),
        title: `Image ${o.position}: the headline does not match the image`,
        text: `Image ${o.position}: the headline${head ? ` "${head}"` : ""} does not say what the screenshot shows. Make the line and the screen tell the same story.`,
        themes: [],
        rank: rankOf("MESSAGE", "majority", [o.position]),
        notes: ["focus mismatch on ours"],
      });
    }
  }
  return out;
}
