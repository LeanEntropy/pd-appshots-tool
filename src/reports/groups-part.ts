import type { CountryAdvice } from "../analysis/country-advice-schema.ts";
import type { GameOrder } from "../analysis/report-data.ts";
import type { PlayContext } from "./ab-section.ts";
import type { CountryReport } from "./country-report-types.ts";
import { MAIN_DIMS } from "./group-dims.ts";
import { exploratory, similarityHint } from "./group-explore.ts";
import { commonFinding, type GroupData, groupDifference } from "./group-findings.ts";
import { oursFindings } from "./group-ours.ts";
import { groupSetupLine, recommendations } from "./group-recs.ts";
import { sketchSvg } from "./group-sketch.ts";
import {
  DEFAULT_RULES,
  type GroupFinding,
  type GroupRules,
  type GroupSection,
  type GroupsPart,
} from "./group-types.ts";
import {
  ALL_NAME,
  type CountryPages,
  effectiveGroups,
  type GroupDef,
  samePagesNotes,
  suggestGroups,
} from "./groups.ts";
import { countryName, theCountry } from "./names.ts";
import type { MarketRef } from "./types.ts";

/**
 * The "Across countries" group part of a comparison (plan-cross-country 3, C2 and the free
 * schematic briefs of C4a), computed by code from the saved position tables of each compared
 * country plus the main country's current ones (the same competitors). Never an AI call.
 */
export interface GroupsInput {
  report: CountryReport;
  main: { market: MarketRef; games: GameOrder[] } | null;
  saved: GroupDef[] | undefined;
  regions: GroupDef[];
  play: PlayContext;
  rules?: GroupRules;
}

const TERMS: GroupsPart["terms"] = [
  {
    term: "Group",
    definition:
      "Compared countries looked at together, e.g. East Asia: Japan, South Korea, Taiwan, Hong Kong. Suggested by region and listing language; you can edit them.",
  },
  {
    term: "Same pages",
    definition:
      "For one game, countries where it shows the same image files in the same order. Decided game by game; counted once.",
  },
  {
    term: "Changed the same way",
    definition:
      "A competitor that does something on all its pages in the group and not in the other countries (or the reverse).",
  },
  {
    term: "Our pages differ",
    definition:
      "Our own pages are not the same between the countries: a fact about us, no competitor numbers needed.",
  },
  {
    term: "Common in every country",
    definition:
      "Most competitors do it in every compared country and in the main country: roll it out everywhere, it is not a group habit.",
  },
  {
    term: "Different in this group",
    definition:
      "The same competitor games do something here that they do not do elsewhere. Worth testing: 3 or more changed this way and at most 1 the other way, holding in every country of the group; clear: 5 or more and none the other way.",
  },
  {
    term: "Mixed",
    definition:
      "A game that does it on some of its pages in the group and not on others. Shown, never counted as yes.",
  },
  ...MAIN_DIMS.map((d) => ({ term: d.label, definition: d.definition })),
];

const rank = (f: GroupFinding) =>
  (f.strength === "clear" ? 2 : 1) * 100 + (f.counts ? f.counts.b - f.counts.c : 0);

export function groupsPart(i: GroupsInput): GroupsPart | null {
  const r = i.report;
  const rules = i.rules ?? DEFAULT_RULES;
  const pages: CountryPages[] = r.countries
    .filter((c) => !c.isMain)
    .map((c) => ({ gl: c.gl, hl: c.hl, label: c.label, games: c.data.games }));
  if (pages.length < 2) return null;
  const main: CountryPages | null = i.main
    ? {
        gl: i.main.market.gl,
        hl: i.main.market.hl,
        label: i.main.market.label,
        games: i.main.games,
      }
    : null;
  const seen = new Map<string, string>();
  for (const p of pages) for (const g of p.games) if (!g.ours) seen.set(g.appId, g.name);
  const x: GroupData = {
    pages,
    main,
    competitors: [...seen].map(([appId, name]) => ({ appId, name })),
  };
  const withSketch = (f: GroupFinding): GroupFinding => ({ ...f, sketch: sketchSvg(f.dim) });
  const ours = oursFindings(x).map(withSketch);
  const commons = MAIN_DIMS.flatMap((d) => commonFinding(x, d.id, rules) ?? []).map(withSketch);
  const suggested = suggestGroups(pages, i.regions);
  const labels: Record<string, string> = {};
  for (const c of r.countries) Object.assign(labels, c.data.labels ?? {});
  const taken = new Set<string>();
  const sections: GroupSection[] = [];
  const allFirst = effectiveGroups(i.saved, suggested, pages).sort(
    (a, b) => b.group.countries.length - a.group.countries.length,
  );
  for (const { group, problem, suggested: sug } of allFirst) {
    const gl = group.countries;
    const sec: GroupSection = {
      name: group.name,
      countries: pages.filter((p) => gl.includes(p.gl)).map((p) => ({ gl: p.gl, label: p.label })),
      suggested: sug,
      problem,
      findings: [],
      notAPattern: [],
      exploratory: [],
      setup: groupSetupLine(
        pages.filter((p) => gl.includes(p.gl)),
        i.play,
      ),
    };
    sections.push(sec);
    if (problem) continue;
    const rest = pages.filter((p) => !gl.includes(p.gl));
    const found: GroupFinding[] = [];
    for (const d of MAIN_DIMS) {
      const sides = [
        ...(main ? [{ pages: [main], name: theCountry(main.label) }] : []),
        ...(rest.length && group.name !== ALL_NAME
          ? [{ pages: rest, name: "the other compared countries" }]
          : []),
      ];
      const got = sides.map((s) =>
        groupDifference(x, { name: group.name, gls: gl }, s, d.id, rules),
      );
      const best = got.flatMap((g) => g.finding ?? []).sort((a, b) => rank(b) - rank(a))[0];
      const key = `${d.id}|${best?.title.includes("do not") ? "less" : "more"}`;
      if (best && !taken.has(key)) {
        taken.add(key);
        found.push(withSketch(best));
      } else if (best) sec.notAPattern.push(`${d.label}: already shown for a wider group.`);
      else
        sec.notAPattern.push(
          ...got
            .map((g) => g.line)
            .filter(Boolean)
            .slice(0, 1),
        );
    }
    found.sort((a, b) => rank(b) - rank(a));
    sec.findings = found.slice(0, rules.maxFindings);
    sec.notAPattern.push(
      ...found
        .slice(rules.maxFindings)
        .map((f) => `${f.dimLabel}: beyond the ${rules.maxFindings} strongest findings.`),
    );
    sec.exploratory = exploratory(x, gl, labels);
  }
  const advice = new Map<string, CountryAdvice>(
    r.advice.flatMap((a) => (a.advice ? [[a.gl, a.advice] as const] : [])),
  );
  const groupFindings = sections.flatMap((s) => s.findings);
  const recs = recommendations(
    x,
    { ours, common: commons.filter((f) => f.kind === "common"), group: groupFindings },
    advice,
    i.play,
  );
  const same = samePagesNotes(pages);
  const nameOf = (gl: string) => countryName(pages.find((p) => p.gl === gl)?.label ?? gl);
  const mainName = main ? countryName(main.label) : "the main country";
  const bottom = [
    groupFindings.length
      ? `${groupFindings.length} group ${groupFindings.length === 1 ? "difference" : "differences"} worth testing: ${groupFindings.map((f) => f.title).join("; ")}.`
      : `Competitors' pages in these countries mostly follow their ${mainName} pages: no group difference found on the ${MAIN_DIMS.length} main dimensions.`,
    ours.length
      ? `What differs is ours: ${ours
          .filter((f) => !f.text.includes("split"))
          .map((f) => f.dimLabel.toLowerCase())
          .join(", ")}.`
      : "",
    commons.some((f) => f.kind === "common")
      ? `${commons
          .filter((f) => f.kind === "common")
          .map((f) => f.text.split(".")[0])
          .join("; ")}.`
      : "",
  ].filter(Boolean);
  return {
    version: "groups.v1",
    main: {
      gl: main?.gl ?? "",
      label: main?.label ?? "",
      note: main
        ? `${mainName}: the competitors' pages as saved now (the main country is the reference for "different in this group").`
        : "No main-country pages for these competitors: only the compared countries are used.",
    },
    bottomLine: bottom.join(" "),
    ours,
    common: commons.filter((f) => f.kind === "common"),
    descriptive: commons.filter((f) => f.kind === "descriptive"),
    groups: sections,
    recommendations: recs,
    suggested,
    saved: i.saved?.length ? i.saved : null,
    samePages: [...same].map(([gl, as]) => ({ gl, label: nameOf(gl), as: nameOf(as) })),
    hint: similarityHint(x),
    terms: TERMS,
    rules,
  };
}
