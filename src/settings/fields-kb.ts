import { z } from "zod";
import type { FieldDef } from "./fields.ts";

const GENRE_LABELS = {
  roguelike: "Roguelike",
  rpg: "RPG",
  idle: "Idle",
  survivor_like: "Survivor-like",
  casual: "Casual",
  strategy: "Strategy",
  puzzle: "Puzzle",
} as const;

/** The "Knowledge base" group of the Settings page (docs/plan-knowledge-base.md section 8). */
export function knowledgeFields(): FieldDef[] {
  const path = (...k: string[]) => [["options", "knowledge", ...k]];
  return [
    {
      id: "options.knowledge.enabled",
      group: "knowledge",
      label: "Use the knowledge base in the text steps",
      help: "Pattern wording, recommendations and their check, A/B tests and country advice get a small, relevant part of the approved knowledge base; code checks every citation and never lets a recommendation break an enforced store rule. Keep it off until its blind comparison with and without it has passed.",
      kind: "switch",
      value: z.boolean(),
      paths: path("enabled"),
    },
    {
      id: "options.knowledge.preset",
      group: "knowledge",
      label: "Knowledge per step",
      help: "How much knowledge each step may receive. Larger gives more context and costs more.",
      kind: "select",
      value: z.enum(["small", "normal", "large"]),
      choices: [
        { value: "small", label: "Small" },
        { value: "normal", label: "Normal" },
        { value: "large", label: "Large" },
      ],
      paths: path("preset"),
    },
    {
      id: "options.knowledge.maxUsdPerReport",
      group: "knowledge",
      label: "Knowledge cost cap per report",
      help: "The knowledge part of one report never costs more than this; steps past it run without knowledge.",
      kind: "usd",
      value: z.number().min(0.05).max(10),
      paths: path("maxUsdPerReport"),
    },
    ...Object.entries(GENRE_LABELS).map(
      ([k, label]): FieldDef => ({
        id: `options.knowledge.genres.${k}`,
        group: "knowledge",
        label: `Genre: ${label}`,
        kind: "switch",
        value: z.boolean(),
        paths: path("genres", k),
      }),
    ),
  ];
}
