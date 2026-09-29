import { z } from "zod";
import type { Kb } from "./release.ts";
import { select } from "./retrieve.ts";
import { KB_STEPS, type Preset } from "./steps.ts";

/**
 * The retrieval recall test (plan 4.1 point 8, gate K2): hand-labelled step contexts, each with
 * the entries a careful expert would want ("must have"). Retrieval must find at least the gate's
 * share of them before any prompt uses the knowledge base.
 */
export const RecallSetSchema = z.strictObject({
  gate: z.number().min(0).max(1),
  cases: z.array(
    z.strictObject({
      id: z.string().min(1),
      step: z.enum(KB_STEPS),
      country: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .nullable(),
      genres: z.array(z.string()),
      facts: z.array(z.string()),
      mustHave: z.array(z.string()).min(1),
      note: z.string().default(""),
    }),
  ),
});
export type RecallSet = z.infer<typeof RecallSetSchema>;

export interface RecallResult {
  recall: number;
  found: number;
  total: number;
  gate: number;
  pass: boolean;
  cases: { id: string; missing: string[]; blocked: string | null }[];
}

export function recallOf(kb: Kb, set: RecallSet, preset: Preset = "normal"): RecallResult {
  let found = 0;
  let total = 0;
  const cases = set.cases.map((c) => {
    const sel = select(kb, {
      step: c.step,
      store: "google_play",
      country: c.country,
      genres: c.genres,
      facts: c.facts,
      preset,
    });
    const got = new Set(sel.picked.map((p) => p.entry.id));
    const missing = c.mustHave.filter((id) => !got.has(id));
    total += c.mustHave.length;
    found += c.mustHave.length - missing.length;
    return { id: c.id, missing, blocked: sel.blocked };
  });
  const recall = total ? found / total : 0;
  return { recall, found, total, gate: set.gate, pass: total > 0 && recall >= set.gate, cases };
}
