import type { z } from "zod";
import type { RenderedPrompt } from "../analysis/prompts.ts";
import type { Cite } from "./cite.ts";
import type { PlacedText } from "./enforce.ts";
import type { KbRun } from "./run.ts";
import { type KbAnswer, type KbRecord, kbCall, withKbField, withoutKb } from "./step.ts";
import type { KbStep } from "./steps.ts";

/**
 * The glue between a text step and the knowledge base. With the switch off (no run) every value
 * passes through untouched, so the prompts, schemas and checks are exactly today's.
 */
export interface KbPart<T> {
  system: RenderedPrompt;
  task: { now: string; before: string };
  schema: z.ZodType<T>;
  check: (v: T) => string[];
  /** The step's own answer (kb field removed) and the record of what it cited. */
  finish: (v: T | null) => { value: T | null; record: KbRecord | null };
  /** Enforced store rules the answer breaks (always empty with the switch off). */
  enforced: (v: T) => string[];
}

/** What a step tells the knowledge base about itself. */
export interface KbOpts<T> {
  step: KbStep;
  facts: readonly string[];
  /** The items of an answer that may carry citations ("position:1", "test:2" ...). */
  items: (v: T) => string[];
  /** The texts on the images and the deck lengths, for the enforced-rule checks. */
  placed?: (v: T) => { texts: PlacedText[]; lengths: { where: string; n: number }[] };
  /** false: a reviewer that reads the same material (and what was left out) but cites nothing. */
  cite?: boolean;
  /**
   * true: enforced-rule problems are not part of the call's check; the caller drops the items
   * that break a rule (A/B tests: one bad test must not throw away the others).
   */
  dropBreaking?: boolean;
}

export interface KbPartInput<T> extends KbOpts<T> {
  run: KbRun | undefined;
  system: RenderedPrompt;
  task: { now: string; before: string };
  schema: z.ZodType<T>;
  check: (v: T) => string[];
}

export function kbPart<T>(x: KbPartInput<T>): KbPart<T> | { blocked: string } {
  const call = kbCall(x.run, x.step, x.facts);
  if (!call)
    return {
      system: x.system,
      task: x.task,
      schema: x.schema,
      check: x.check,
      finish: (v) => ({ value: v, record: null }),
      enforced: () => [],
    };
  if ("blocked" in call) return call;
  const enforced = (v: T) => {
    const p = x.placed?.(v);
    return p ? call.enforced(p.texts, p.lengths) : [];
  };
  if (x.cite === false) {
    const left = call.selection.leftOut.length;
    const log = `\n\nSelection log: the writer received the knowledge base entries above${left ? `; ${left} other eligible entries were left out by code (not about this step, or over the budget)` : ""}. Check that each cited entry supports the statement it is attached to, that no given counter-claim or enforced store rule was ignored, and that no convention is presented as proven effective.`;
    return {
      system: call.system(x.system),
      task: { now: call.task(x.task.now) + log, before: call.task(x.task.before) + log },
      schema: x.schema,
      check: (v) => [...x.check(v), ...enforced(v)],
      finish: (v) => ({ value: v, record: null }),
      enforced,
    };
  }
  const answer = (v: T) => (v as T & { kb?: KbAnswer }).kb;
  const items = (v: T) => new Set(x.items(v));
  const check = (v: T) => [
    ...x.check(v),
    ...call.problems(answer(v), items(v)),
    ...(x.dropBreaking ? [] : enforced(v)),
  ];
  return {
    system: call.system(x.system),
    task: { now: call.task(x.task.now), before: call.task(x.task.before) },
    // The answer carries the kb field too; the rest of the tool reads T (kb removed in finish).
    schema: withKbField(x.schema) as unknown as z.ZodType<T>,
    check,
    finish: (v) =>
      v === null
        ? { value: null, record: null }
        : {
            value: withoutKb(v as T & object & { kb?: KbAnswer }) as T,
            record: call.record(answer(v), items(v)),
          },
    enforced,
  };
}

/** Citation marks and plain notes per item, ready for the report (only links in the marks). */
export interface KbMarks {
  kbCites: Record<string, Cite[]>;
  kbNotes: Record<string, string[]>;
}

const STORE_NAME: Record<string, string> = {
  google_play: "Google Play",
  app_store: "the App Store",
};

/** Turns a record into marks: [n] per cited entry, and a plain line for guidance gone against. */
export function marksOf(run: KbRun, record: KbRecord | null): KbMarks | null {
  if (!record) return null;
  const kbCites: Record<string, Cite[]> = {};
  const kbNotes: Record<string, string[]> = {};
  for (const c of record.citations) {
    const cites = run.cite(c.entryIds);
    if (cites.length) kbCites[c.item] = [...(kbCites[c.item] ?? []), ...cites];
  }
  for (const g of record.againstGuidance) {
    const e = run.kb.byId.get(g.entryId);
    if (!e) continue;
    const store = STORE_NAME[e.scope.store[0] ?? ""] ?? "The store";
    kbNotes[g.item] = [
      ...(kbNotes[g.item] ?? []),
      `This goes against ${store}'s own advice, which is not a rule: "${e.claim}" Why we still do it: ${g.reason}`,
    ];
    const cites = run.cite([g.entryId]);
    if (cites.length) kbCites[g.item] = [...(kbCites[g.item] ?? []), ...cites];
  }
  return Object.keys(kbCites).length || Object.keys(kbNotes).length ? { kbCites, kbNotes } : null;
}

/** The answer with its marks (the report's view reads kbCites and kbNotes when present). */
export function withMarks<T extends object>(v: T | null, marks: KbMarks | null): T | null {
  return v && marks ? { ...v, ...marks } : v;
}
