import { LAYER_TAGS } from "../analysis/categories.ts";
import { colourFamily } from "../analysis/colours.ts";
import { lines, showsLogo } from "../analysis/image-tags.ts";
import { layerStructure } from "../analysis/layer-structure.ts";
import { counts, type DeckEntry } from "../analysis/patterns.ts";
import type { SlotSpec, SpecField } from "./directives.ts";
import { KIND_LABEL, type Kind, kindOf, SOURCE_LABEL, type Source, sourceOf } from "./kinds.ts";
import { type Theme, themeLabel, themesOf } from "./themes.ts";

/**
 * What SHOULD be there, built by code from the competitors' exemplars (plan 5.3-1). Each field
 * says where it comes from (pixels, code, the analysis) and how many exemplars agree; a field
 * old analyses cannot give reads "not measured". The spec never invents precision.
 */
const top = (xs: readonly (string | null | undefined)[]) =>
  counts(xs.map((x) => x || null))[0] ?? null;

function field(
  label: string,
  xs: readonly (string | null | undefined)[],
  of: number,
  from: SpecField["from"],
  required = false,
): SpecField {
  const t = top(xs);
  if (!t)
    return { label, value: "not measured", from: "not measured", agree: `0 of ${of}`, required };
  return { label, value: t.key, from, agree: `${t.n} of ${of}`, required };
}

const join = (xs: readonly string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

/** Themes of one image's lines (its own game name left out). */
export const imageThemes = (e: DeckEntry): Theme[] => [
  ...new Set(lines(e.final, e.name).flatMap(themesOf)),
];

export function specFrom(
  exemplars: readonly DeckEntry[],
  opts: { kind?: Kind; canvas?: string; themes?: readonly string[] } = {},
): SlotSpec {
  const es = [...exemplars];
  const n = es.length;
  const kinds = es.map((e) => kindOf(e).kind);
  const kind = opts.kind ?? (top(kinds)?.key as Kind | undefined) ?? "core_play";
  const canvasF = field(
    "Orientation",
    es.map((e) => e.canvas),
    n,
    "pixels",
    true,
  );
  const canvas = opts.canvas ?? canvasF.value;
  const sameCanvas = es.filter((e) => e.canvas === canvas);
  const sizeF = field(
    "Canvas size",
    sameCanvas.map((e) => e.size),
    sameCanvas.length,
    "pixels",
    true,
  );
  const source: Source = top(es.map((e) => sourceOf(e, kindOf(e).kind)))?.key as Source;
  const logoN = es.filter((e) => showsLogo(e.final, e.name)).length;
  const logo = logoN * 2 > n;
  const themeCounts = counts(es.flatMap(imageThemes).filter((t) => t !== "mechanic"));
  const themes = opts.themes?.length ? [...opts.themes] : themeCounts.slice(0, 2).map((t) => t.key);
  const heads = es.flatMap((e) =>
    lines(e.final, e.name)
      .slice(0, 1)
      .map((h) => `"${h}" (${e.name} #${e.position})`),
  );
  const texts = es.flatMap((e) =>
    e.final.marketingLayer.texts.filter((t) => t.role === "headline"),
  );
  const elements = es.flatMap((e) =>
    e.final.marketingLayer.elements
      .filter((x) => x.kind === "character" || x.kind === "creature" || x.kind === "item")
      .slice(0, 2)
      .map((x) => x.what),
  );
  const colours = counts(
    es.flatMap((e) =>
      [...e.final.marketingLayer.mainColours, ...e.final.screenshot.mainColours]
        .slice(0, 3)
        .map((c) => colourFamily(c.name, c.hex)),
    ),
  )
    .slice(0, 3)
    .map((c) => c.key);
  const layer = field(
    "Layer structure",
    es.map((e) => {
      const k = layerStructure(e.final);
      return (LAYER_TAGS[k]?.label ?? k).toLowerCase();
    }),
    n,
    "code",
  );
  const fields: SpecField[] = [
    {
      label: "Kind",
      value: KIND_LABEL[kind],
      from: "code",
      agree: `${kinds.filter((k) => k === kind).length} of ${n}`,
      required: true,
    },
    { ...canvasF, value: canvas },
    sizeF,
    {
      label: "Production source",
      value: SOURCE_LABEL[source],
      from: "code",
      agree: `${es.filter((e) => sourceOf(e, kindOf(e).kind) === source).length} of ${n}`,
      required: true,
    },
    {
      label: "Game logo",
      value: logo ? "yes" : "no",
      from: "analysis",
      agree: `${logo ? logoN : n - logoN} of ${n}`,
      required: true,
    },
    {
      label: "Headline theme",
      value: themes.length
        ? themes.map((t) => themeLabel(t as Theme) ?? t).join("; ")
        : "none (no line)",
      from: "code",
      agree: themeCounts[0] ? `${themeCounts[0].n} of ${n}` : `0 of ${n}`,
      required: true,
    },
    layer,
    field(
      "Headline place",
      texts.map((t) => `${t.size}, ${t.position.replace(/_/g, " ")}`),
      texts.length || n,
      "analysis",
    ),
    field(
      "Headline style",
      texts.map((t) => `${t.fontStyle}, ${t.colour}`),
      texts.length || n,
      "analysis",
    ),
    field(
      "Board density",
      es.map((e) => e.attrs?.boardDensity),
      n,
      "analysis",
    ),
    field(
      "Game interface (HUD)",
      es.map((e) =>
        e.attrs?.hudVisible == null ? null : e.attrs.hudVisible ? "visible" : "hidden",
      ),
      n,
      "analysis",
    ),
    {
      label: "Colours",
      value: colours.length ? join(colours) : "not measured",
      from: colours.length ? "analysis" : "not measured",
      agree: `${n} exemplars`,
      required: false,
    },
    {
      label: "Elements",
      value: elements.length ? [...new Set(elements)].slice(0, 4).join("; ") : "none listed",
      from: "analysis",
      agree: `${n} exemplars`,
      required: false,
    },
    {
      label: "Their lines (write our own)",
      value: heads.length ? heads.slice(0, 4).join(", ") : "none",
      from: "analysis",
      agree: `${heads.length} of ${n}`,
      required: false,
    },
  ];
  const exemplarsOut = es.map((e) => ({ game: e.name, position: e.position, imageId: e.imageId }));
  fields.push({
    label: "Exemplars",
    value: exemplarsOut.map((x) => `${x.game} #${x.position}`).join(", "),
    from: "code",
    agree: `${n}`,
    required: true,
  });
  return {
    kind,
    kindLabel: KIND_LABEL[kind],
    canvas,
    size: sizeF.value,
    source,
    logo,
    themes,
    exemplars: exemplarsOut,
    headline: `${KIND_LABEL[kind]}, ${canvas}${sizeF.value !== "not measured" ? ` ${sizeF.value}` : ""}, ${source === "marketing_art" ? "marketing art (no screenshot layer)" : source === "capture_layer" ? "in-game capture + marketing layer" : "in-game capture"}${logo ? ", with the game logo" : ""}`,
    fields,
  };
}

/** A required field is missing or not measured (validator 5.6-3). */
export function specGaps(s: SlotSpec): string[] {
  const need = [
    "Kind",
    "Orientation",
    "Canvas size",
    "Production source",
    "Game logo",
    "Headline theme",
    "Exemplars",
  ];
  return need.filter((l) => {
    const f = s.fields.find((x) => x.label === l);
    return !f || (f.from === "not measured" && l !== "Canvas size");
  });
}
