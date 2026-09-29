import { z } from "zod";
import type { FieldDef } from "./fields.ts";

/** The "Analysis speed" group of the Settings page (docs/plan-analysis-speed.md). */
export function speedFields(): FieldDef[] {
  const sw = (key: string, label: string, help: string): FieldDef => ({
    id: `options.speed.${key}`,
    group: "speed",
    label,
    help,
    kind: "switch",
    value: z.boolean(),
    paths: [["options", "speed", key]],
  });
  return [
    {
      id: "options.speed.parallelCalls",
      group: "speed",
      label: "AI calls at the same time",
      help: "Screenshots analysed at once inside one batch (1 to 5). 1 analyses one image after another. The spending limit still holds exactly.",
      kind: "number",
      value: z.number().int().min(1).max(5),
      min: 1,
      max: 5,
      paths: [["options", "speed", "parallelCalls"]],
    },
    sw(
      "inlineImages",
      "Send the image inside the request",
      "Saves one model turn (about 2.5 s) per screenshot. Off: the model opens the image file itself, as before.",
    ),
    sw(
      "leanAnswer",
      "Shorter answers",
      "The model no longer writes the fields nothing reads (capture descriptions, element scale, confidence); notes only when something is uncertain. Existing analyses stay valid.",
    ),
    sw(
      "measuredColours",
      "Colours measured by code",
      "Colour statistics and the recommendation input use colours measured from the pixels of each layer instead of the model's. Switching it on marks the AI-written parts of reports built before as out of date.",
    ),
    sw(
      "layoutCapture",
      "Layout breakdown for new analyses",
      "Each newly analysed screenshot also gets a coarse wireframe of both layers (up to 8 boxes each), asked in the same AI call and saved in its own file. Existing analyses stay valid; images analysed before show 'layout missing'.",
    ),
    {
      id: "options.pixelCheck.mode",
      group: "speed",
      label: "Pixel check of near-identical pictures",
      help: "Compares a country picture with its main-country version pixel by pixel. Suggest: pairs that changed only in the text or band are grouped for one-click confirmation. Automatic: decided without asking (the approval screen still lists them). Off: fingerprint only.",
      kind: "select",
      value: z.enum(["off", "suggest", "automatic"]),
      choices: [
        { value: "off", label: "Off" },
        { value: "suggest", label: "Suggest" },
        { value: "automatic", label: "Automatic" },
      ],
      paths: [["options", "pixelCheck", "mode"]],
    },
    {
      id: "options.pixelCheck.sameMaxOutside",
      group: "speed",
      label: "Same picture: changed pixels outside the text and band at most",
      kind: "percent",
      value: z.number().min(0).max(0.05),
      paths: [["options", "pixelCheck", "sameMaxOutside"]],
    },
    {
      id: "options.pixelCheck.differentMinOutside",
      group: "speed",
      label: "Different picture: changed pixels outside the text and band above",
      kind: "percent",
      value: z.number().min(0.01).max(0.5),
      paths: [["options", "pixelCheck", "differentMinOutside"]],
    },
  ];
}
