import type { CountryAdvice } from "../analysis/country-advice-schema.ts";
import { languageName, playSetup, VARIABLE_NAMES } from "../analysis/play-experiments.ts";
import type { PlayContext } from "./ab-section.ts";
import { MAIN_DIMS, type MainDim } from "./group-dims.ts";
import type { GroupData } from "./group-findings.ts";
import { sketchSvg } from "./group-sketch.ts";
import type { GroupFinding, GroupRecommendation } from "./group-types.ts";
import type { CountryPages } from "./groups.ts";
import { countryName } from "./names.ts";

/**
 * Group recommendations, each framed as an A/B test to run (plan-cross-country 3.7), by code:
 * from our own pages that differ (use our own image as on our other pages), a habit common in
 * every country that our page lacks somewhere, and a group difference (suggestive or clear). One
 * variable per test; the Play Console setup is resolved by code (a localised experiment when the
 * group's languages are its own, else a custom store listing for the group's countries). A
 * recommendation that goes against a country's advice is shown with both sources.
 */
const list = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

const VARIABLE: Record<
  MainDim | "deckLength",
  { v: GroupRecommendation["variable"]; at: number[] }
> = {
  titleArt: { v: "screenshot", at: [1] },
  logo: { v: "screenshot", at: [1] },
  inset: { v: "composition", at: [1] },
  largeLayer: { v: "composition", at: [1] },
  landscape: { v: "composition", at: [1] },
  deckLength: { v: "order", at: [] },
};

/** A country's advice going the other way on the same position, in plain words. */
function conflictsOf(
  dim: MainDim | "deckLength",
  countries: readonly CountryPages[],
  advice: ReadonlyMap<string, CountryAdvice>,
): string[] {
  const out: string[] = [];
  for (const p of countries) {
    const a = advice.get(p.gl);
    if (!a) continue;
    const first = a.deck.find((d) => d.position === 1);
    if (dim === "titleArt" && first && !/title|full-screen art|key art/i.test(first.screen))
      out.push(`${countryName(p.label)}'s advice keeps "${first.screen}" at image 1.`);
    if (dim === "logo" && a.deck.filter((d) => d.position <= 3).every((d) => !d.logo.show))
      out.push(`${countryName(p.label)}'s advice shows no logo in images 1 to 3.`);
  }
  return out;
}

export function groupSetupLine(
  markets: readonly { gl: string; hl: string; label: string }[],
  play: PlayContext,
): string {
  const langs = [...new Set(markets.map((m) => m.hl))];
  const gls = new Set(markets.map((m) => m.gl));
  const shared = [...play.reportMarkets, ...play.projectMarkets].filter(
    (m) => !gls.has(m.gl) && langs.includes(m.hl),
  );
  const where = list(markets.map((m) => countryName(m.label)));
  if (!shared.length && langs.length <= 5)
    return `These countries' listing languages (${list(langs.map(languageName))}) are theirs alone: test with a localised experiment in those languages, or give ${where} one custom store listing to keep the group's page apart.`;
  return `${list([...new Set(shared.map((m) => countryName(m.label)))])} ${shared.length === 1 ? "uses" : "use"} the same language, so create one custom store listing targeting ${where} in Play Console and run the experiment on it (the tool cannot see your listings).`;
}

export function recommendations(
  x: GroupData,
  f: { ours: GroupFinding[]; common: GroupFinding[]; group: GroupFinding[] },
  advice: ReadonlyMap<string, CountryAdvice>,
  play: PlayContext,
): GroupRecommendation[] {
  const out: GroupRecommendation[] = [];
  const pagesOf = (labels: readonly string[]) => x.pages.filter((p) => labels.includes(p.label));
  const make = (
    g: GroupFinding,
    title: string,
    text: string,
    countries: CountryPages[],
    evidence: string[],
    hypothesis: string,
  ) => {
    if (!countries.length) return;
    const v = VARIABLE[g.dim];
    const markets = countries.map((p) => ({ gl: p.gl, hl: p.hl, label: p.label }));
    out.push({
      title,
      kind: g.kind,
      text,
      countries: countries.map((p) => p.label),
      evidence,
      variable: v.v,
      variableName: VARIABLE_NAMES[v.v],
      positions: v.at,
      hypothesis,
      setup: playSetup(
        markets,
        play.reportMarkets,
        play.projectMarkets,
        (gl) => play.traffic[gl] ?? "unknown",
        false,
      ),
      conflicts: conflictsOf(g.dim, countries, advice),
      sketch: sketchSvg(g.dim, "the variant, schematic, not measured"),
    });
  };
  const done = new Set<string>();
  for (const g of f.ours) {
    const d = MAIN_DIMS.find((m) => m.id === g.dim);
    const lacking = g.perCountry.filter(
      (p) => !p.isMain && (g.dim === "deckLength" ? p.yes < p.of : p.ours === false),
    );
    const lead = g.perCountry.find((p) =>
      g.dim === "deckLength" ? p.yes === p.of : p.ours === true,
    );
    // Our own image only where most competitors there do it (or it is our repeated deck).
    const worth =
      g.dim === "deckLength" ? lacking : lacking.filter((p) => p.of && p.yes * 2 >= p.of);
    const names = worth.map((p) => countryName(p.label));
    if (!worth.length || !lead) continue;
    done.add(g.dim);
    const leadName = countryName(lead.label);
    const leadPage = [...(x.main ? [x.main] : []), ...x.pages].find((p) => p.gl === lead.gl);
    const leadFirst = leadPage?.games.find((y) => y.ours)?.rows.find((r) => r.position === 1);
    // Our title art carries the logo: the title art test already puts the logo first.
    if (g.dim === "logo" && done.has("titleArt") && leadFirst?.logo) {
      const t = out.find((r) => r.variable === "screenshot" && r.positions[0] === 1);
      if (t) t.text += " Our title art carries the game logo, so this also puts the logo first.";
      continue;
    }
    if (g.dim === "deckLength")
      make(
        g,
        `Show each screen once in ${list(names)}`,
        `Use our own ${leadName} set: each screen once, instead of repeating pictures.`,
        pagesOf(worth.map((p) => p.label)),
        [g.text],
        `A shorter set without repeats keeps visitors on new information and should raise installs.`,
      );
    else
      make(
        g,
        `Our ${d?.noun} in ${list(names)}, as on our ${leadName} page`,
        `Use our own ${d?.noun} on the ${list(names)} ${names.length === 1 ? "page" : "pages"}, as on our ${leadName} page.`,
        pagesOf(worth.map((p) => p.label)),
        worth.map(
          (p) =>
            `${countryName(p.label)}: ${p.yes} of ${p.of} competitors ${d?.does}; ours does not.`,
        ),
        `Most competitors here ${d?.does}; our ${leadName} page already does. Reusing that image should make the page clearer at a glance and raise installs.`,
      );
  }
  for (const g of f.common) {
    if (done.has(g.dim)) continue;
    const d = MAIN_DIMS.find((m) => m.id === g.dim);
    const lacking = g.perCountry.filter((p) => !p.isMain && p.ours === false);
    if (!lacking.length) continue;
    done.add(g.dim);
    make(
      g,
      `Applies in every country you compared: ${d?.does}`,
      g.text,
      pagesOf(lacking.map((p) => p.label)),
      [g.text],
      `A habit of most competitors in every country; our page lacks it in ${list(lacking.map((p) => countryName(p.label)))}.`,
    );
  }
  for (const g of f.group) {
    if (done.has(g.dim) || g.examples.length === 0) continue;
    const d = MAIN_DIMS.find((m) => m.id === g.dim);
    const lacking = g.perCountry.filter(
      (p) => !p.isMain && p.ours === false && x.pages.some((q) => q.label === p.label),
    );
    if (!lacking.length) continue;
    done.add(g.dim);
    make(
      g,
      `${g.group}: ${d?.does} (${g.strength === "clear" ? "clear" : "worth testing"})`,
      `In ${g.group}, ${g.text.charAt(0).toLowerCase()}${g.text.slice(1)}`,
      pagesOf(lacking.map((p) => p.label)),
      [g.text],
      `The same competitor games change this in ${g.group}; an A/B test is the real check.`,
    );
  }
  return out.slice(0, 5);
}
