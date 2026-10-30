import type { PositionVerdict } from "../analysis/ours-vs-position.ts";
import { byRank, type Directive, isFirm, LEVEL_WORD, type SlotSpec } from "./directives.ts";
import type { EngineResult } from "./engine.ts";
import { evidenceText } from "./strength.ts";

/**
 * "How ours compares" per position with the engine's directives first (replaces the interim
 * copy/drop rules of 2026-10-30): a COPY or DROP leads, then any other firm change, then the
 * review notes (anything only we show is never a plain "following").
 */
const specLines = (s: SlotSpec) =>
  s.fields.map((f) => `${f.label}: ${f.value} (${f.agree}, ${f.from})`);

export function positionNote(v: PositionVerdict, engine: EngineResult): PositionVerdict {
  const here = engine.directives
    .filter((d) => d.positions[0] === v.position && d.kind !== "KEEP")
    .sort(byRank);
  const firm = here.filter(isFirm);
  const review = here.filter((d) => d.level === "review");
  const tests = here.filter((d) => d.level === "test" || d.level === "consider");
  const lead: Directive | undefined =
    firm.find((d) => d.kind === "COPY") ?? firm.find((d) => d.kind === "DROP") ?? firm[0];
  const slot = engine.skeleton.find((s) => s.position === v.position);
  const notes = [
    ...firm.filter((d) => d !== lead).map((d) => `${d.title} (${evidenceText(d.evidence)})`),
    ...review.map((d) => `${LEVEL_WORD.review}: ${d.text}`),
    ...tests.map((d) => `${LEVEL_WORD[d.level]}: ${d.text}`),
  ];
  if (!lead) {
    if (!review.length) return notes.length ? { ...v, reasons: [...v.reasons, ...notes] } : v;
    const r = review[0] as Directive;
    return {
      ...v,
      verdict: v.verdict === "following" ? "slightly different" : v.verdict,
      reasons: [r.text, ...v.reasons, ...notes.filter((n) => !n.endsWith(r.text))],
      directive: {
        kind: "review",
        ids: review.map((d) => d.id),
        text: r.text,
        details: [],
        orientation: v.ours.canvas ?? "portrait",
        screenshotLayer: true,
      },
    };
  }
  const spec =
    lead.kind === "DROP"
      ? (lead.replacement ?? slot?.spec ?? null)
      : (lead.spec ?? slot?.spec ?? null);
  const kind = lead.kind === "COPY" ? "copy" : lead.kind === "DROP" ? "drop" : "change";
  const details = spec ? specLines(spec) : [];
  return {
    ...v,
    verdict:
      kind === "change" && v.verdict === "following"
        ? "slightly different"
        : kind === "change"
          ? v.verdict
          : "very different",
    reasons: [
      lead.text,
      ...(details.length ? [`What should be there: ${details.join("; ")}`] : []),
      ...notes,
      ...v.reasons,
    ],
    directive: {
      kind,
      ids: [lead.id, ...firm.filter((d) => d !== lead).map((d) => d.id)],
      text: lead.text,
      details,
      orientation: spec?.canvas ?? v.ours.canvas ?? "portrait",
      screenshotLayer: spec ? spec.source !== "marketing_art" : true,
    },
  };
}
