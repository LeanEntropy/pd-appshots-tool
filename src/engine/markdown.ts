import { type Directive, isFirm, LEVEL_WORD, type SlotSpec } from "./directives.ts";
import type { EngineResult } from "./engine.ts";
import type { MetaDirective } from "./rules-meta.ts";
import { evidenceText } from "./strength.ts";

/** The engine's blocks in the markdown report (same content as view/report-engine.ts). */
const specLine = (s: SlotSpec) =>
  s.fields.map((f) => `${f.label}: ${f.value} (${f.agree})`).join("; ");

const row = (d: Directive) =>
  `- **${LEVEL_WORD[d.level]}: ${d.title}** (${evidenceText(d.evidence)}). ${d.text}${d.replacement ? ` Replacement: ${specLine(d.replacement)}.` : d.spec ? ` Spec: ${specLine(d.spec)}.` : ""}`;

export function engineMarkdown(e: EngineResult | null | undefined): string[] {
  if (!e) return [];
  const firm = e.directives.filter(isFirm);
  const review = e.directives.filter((d) => d.level === "review");
  const tests = e.directives.filter((d) => d.level === "test" || d.level === "consider");
  return [
    "### What to change",
    "",
    `${e.notes.join(" ")} Our page should look more like the leaders: anything only we show counts against us.`,
    "",
    ...(firm.length ? firm.map(row) : ["No change is backed by the competitors' evidence."]),
    "",
    ...(review.length ? ["**Needs review**", "", ...review.map(row), ""] : []),
    `**Target deck (${e.skeleton.length} images):**`,
    "",
    ...e.skeleton.map(
      (s) =>
        `${s.position}. ${s.kindLabel}, ${s.canvas}${s.size && s.size !== "not measured" ? ` ${s.size}` : ""}, ${s.source}, logo ${s.logo ? "yes" : "no"}${s.themes.length ? `, theme: ${s.themes.join(", ").replace(/_/g, " ")}` : ""}: ${s.action} (${[s.why, ...s.directiveIds].join(", ")})`,
    ),
    "",
    ...(tests.length ? ["**Test ideas**", "", ...tests.map(row), ""] : []),
  ];
}

const metaRow = (d: MetaDirective) =>
  `- **${d.candidate ? "Candidate" : LEVEL_WORD[d.level]}: ${d.title}** (${evidenceText(d.evidence)}). ${d.text}`;

export function storeListingMarkdown(e: EngineResult | null | undefined): string[] {
  const m = e?.meta;
  if (!m?.groups.length) return [];
  return [
    "### Store listing",
    "",
    `By code from the saved store text. ${m.notes.join(" ")} Tags stay candidates until the Play Console tag limit is confirmed.`,
    "",
    ...m.groups.flatMap((g) => [`**${g.label}**`, "", ...g.directives.map(metaRow), ""]),
  ];
}
