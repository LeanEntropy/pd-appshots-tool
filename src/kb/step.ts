import { z } from "zod";
import { extendPrompt, type RenderedPrompt } from "../analysis/prompts.ts";
import { activeChecks, enforcedProblems, type PlacedText } from "./enforce.ts";
import { type Selection, select } from "./retrieve.ts";
import type { KbRun } from "./run.ts";
import type { KbStep } from "./steps.ts";
import { canDrive } from "./trust.ts";

/**
 * One AI step with the knowledge base (plan 4.2 to 4.4). The order of the prompt is fixed: the
 * step's own system prompt, then the shared rules block and the step's core entries (stable for
 * every call of the step), then in the user message the per-call entries (one country's notes),
 * then the computed data as today. The model answers with handles only (kb field); code checks
 * them and keeps a record, from which the report renders citation marks.
 */
export const kbAnswerSchema = z.strictObject({
  citations: z
    .array(z.strictObject({ item: z.string(), handles: z.array(z.string()) }))
    .describe(
      'per item ("position:2", "keyPoint:1", "test:1", "action:3") the handles it rests on',
    ),
  againstGuidance: z
    .array(z.strictObject({ item: z.string(), handle: z.string(), reason: z.string() }))
    .describe("items that go against official guidance that is NOT enforced, and why"),
  conflicts: z
    .array(z.strictObject({ item: z.string(), handle: z.string(), note: z.string() }))
    .describe(
      "where a corroborated entry disagrees with a clear pattern in the data (a test idea)",
    ),
});
export type KbAnswer = z.infer<typeof kbAnswerSchema>;

export interface KbRecord {
  step: KbStep;
  releaseHash: string;
  handles: Record<string, string>;
  citations: { item: string; entryIds: string[] }[];
  againstGuidance: { item: string; entryId: string; reason: string }[];
  conflicts: { item: string; entryId: string; note: string }[];
  /** Citations code removed (wrong handle, or not allowed for that item). */
  dropped: string[];
  tokens: number;
}

export interface KbCall {
  selection: Selection;
  system: (base: RenderedPrompt) => RenderedPrompt;
  task: (t: string) => string;
  /** Answer problems: handles not given, trust not allowed for the item, enforced rules. */
  problems: (a: KbAnswer | undefined, items: ReadonlySet<string>) => string[];
  record: (a: KbAnswer | undefined, items: ReadonlySet<string>) => KbRecord;
  enforced: (
    texts: readonly PlacedText[],
    lengths: readonly { where: string; n: number }[],
  ) => string[];
}

/** Test items may rest on unverified or contested entries; everything else may not. */
const isTestItem = (item: string) => item.startsWith("test:");

/** The schema with the kb answer added (the step's own fields are unchanged). */
export function withKbField<T>(schema: z.ZodType<T>): z.ZodType<T & { kb: KbAnswer }> {
  // Every step answer is a zod object; extend() keeps its fields and strictness.
  const obj = schema as unknown as z.ZodObject<z.ZodRawShape>;
  return obj.extend({ kb: kbAnswerSchema }) as unknown as z.ZodType<T & { kb: KbAnswer }>;
}

/**
 * The knowledge-base part of one call, or null when the switch is off, nothing applies, or the
 * report's knowledge cap is used up (the step then runs exactly as without the knowledge base).
 * `blocked` when mandatory store rules or regulation notes do not fit their reserved space.
 */
export function kbCall(
  run: KbRun | undefined,
  step: KbStep,
  facts: readonly string[],
): KbCall | { blocked: string } | null {
  if (!run) return null;
  const sel = select(run.kb, {
    step,
    store: run.store,
    country: run.market,
    genres: run.genres,
    facts,
    preset: run.preset,
  });
  if (sel.blocked) {
    run.log.push(sel);
    return { blocked: sel.blocked };
  }
  if (!sel.picked.length) return null;
  if (run.capTokens && run.used.tokens + sel.tokens > run.capTokens) {
    run.log.push({
      ...sel,
      picked: [],
      blocked: "the knowledge cost cap of this report is used up",
    });
    return null;
  }
  run.used.tokens += sel.tokens;
  run.log.push(sel);
  const byHandle = new Map(sel.picked.map((p) => [p.handle, p]));
  const core = sel.picked.filter((p) => !p.perCall).map((p) => p.text);
  const perCall = sel.picked.filter((p) => p.perCall).map((p) => p.text);
  const system = [
    run.rules,
    ...(core.length ? [`Knowledge base entries for this step:\n\n${core.join("\n\n")}`] : []),
  ].join("\n\n");
  const checks = activeChecks(run.kb, run.store);
  const citeProblem = (item: string, handle: string, items: ReadonlySet<string>): string | null => {
    const p = byHandle.get(handle);
    if (!items.has(item)) return `kb: "${item}" is not an item of this answer`;
    if (!p) return `kb: ${handle} was not given in this call`;
    if (!isTestItem(item) && !canDrive(p.entry, p.computed))
      return `kb: ${item} cites ${handle}, which is unverified, contested or out of date: use it only for a test idea (or in conflicts), not for this item`;
    return null;
  };
  const guidanceProblem = (g: KbAnswer["againstGuidance"][number]): string | null => {
    const p = byHandle.get(g.handle);
    if (!p) return `kb: ${g.handle} was not given in this call`;
    if (p.entry.ruleClass === "enforced_rule")
      return `kb: ${g.item} goes against ${g.handle}, an ENFORCED rule: never break it; change the item`;
    if (p.entry.ruleClass !== "official_guidance")
      return `kb: ${g.handle} is not official guidance`;
    return null;
  };
  return {
    selection: sel,
    system: (base) => extendPrompt(base, system),
    task: (t) =>
      perCall.length
        ? `Knowledge base entries for this call:\n\n${perCall.join("\n\n")}\n\n${t}`
        : t,
    problems: (a, items) => {
      if (!a) return ["kb: the kb field is missing"];
      return [
        ...a.citations.flatMap((c) => c.handles.map((h) => citeProblem(c.item, h, items))),
        ...a.againstGuidance.map(guidanceProblem),
        ...a.conflicts.map((c) =>
          byHandle.has(c.handle) ? null : `kb: ${c.handle} was not given in this call`,
        ),
      ].filter((x): x is string => !!x);
    },
    record: (a, items) => {
      const dropped: string[] = [];
      const id = (h: string) => byHandle.get(h)?.entry.id ?? "";
      const citations = (a?.citations ?? []).map((c) => ({
        item: c.item,
        entryIds: c.handles
          .filter((h) => {
            const why = citeProblem(c.item, h, items);
            if (why) dropped.push(why);
            return !why;
          })
          .map(id),
      }));
      return {
        step,
        releaseHash: sel.releaseHash,
        handles: Object.fromEntries(sel.picked.map((p) => [p.handle, p.entry.id])),
        citations: citations.filter((c) => c.entryIds.length),
        againstGuidance: (a?.againstGuidance ?? [])
          .filter((g) => !guidanceProblem(g) && items.has(g.item))
          .map((g) => ({ item: g.item, entryId: id(g.handle), reason: g.reason })),
        conflicts: (a?.conflicts ?? [])
          .filter((c) => byHandle.has(c.handle))
          .map((c) => ({ item: c.item, entryId: id(c.handle), note: c.note })),
        dropped,
        tokens: sel.tokens,
      };
    },
    enforced: (texts, lengths) => enforcedProblems(checks, texts, lengths),
  };
}

/** Removes the kb field from an answer (the rest of the tool reads the step's own fields). */
export function withoutKb<T extends object>(v: T & { kb?: KbAnswer }): T {
  const { kb: _kb, ...rest } = v;
  return rest as T;
}
