import { z } from "zod";
import type { Config } from "../config/schema.ts";
import { TEXT_USD } from "../reports/scope-cost.ts";
import { stableHash } from "../util/hash.ts";
import { kbCost, priceOf } from "./cost.ts";
import type { RecallResult } from "./recall.ts";

/**
 * The blind evaluation, with and without the knowledge base (plan section 10, milestone K4).
 * PREPARED ONLY: nothing here calls a model. Running it needs the user's approval of its cost
 * (evalCost), then each enabled step is generated in both arms from the same frozen inputs,
 * blinded (blindPair), judged by the user and by gpt-5.6-sol with the rubric (kb/eval/rubric.json,
 * prompts/analysis/kb-eval-judge.v1.md), and scored against the gates (evalGates).
 */
export const CRITERIA = [
  "meaningful",
  "to_the_point",
  "actionable",
  "insightful",
  "tied_to_evidence",
  "correct_about_stores",
  "right_for_market",
  "ab_tests_sound",
] as const;

export const JudgementSchema = z.strictObject({
  step: z.string().min(1),
  judge: z.enum(["user", "gpt"]),
  scores: z.strictObject({
    A: z.record(z.enum(CRITERIA), z.number().int().min(1).max(5)),
    B: z.record(z.enum(CRITERIA), z.number().int().min(1).max(5)),
  }),
  prefer: z.enum(["A", "B", "tie"]),
});
export type Judgement = z.infer<typeof JudgementSchema>;

export interface BlindKey {
  step: string;
  /** Which arm answer A is. */
  A: "kb" | "plain";
}

const KB_KEYS = new Set(["kb", "kbCites", "kbNotes"]);

/** The answer without any sign of the knowledge base (citation marks, notes, the kb field). */
export function stripKb(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripKb);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => !KB_KEYS.has(k))
        .map(([k, x]) => [k, stripKb(x)]),
    );
  return v;
}

/** Both arms of one step in a random but reproducible order (the seed is kept with the key). */
export function blindPair(step: string, withKb: unknown, plain: unknown, seed: string) {
  const kbFirst = Number.parseInt(stableHash({ step, seed }).slice(0, 8), 16) % 2 === 0;
  const a = kbFirst ? withKb : plain;
  const b = kbFirst ? plain : withKb;
  return {
    packet: {
      step,
      answers: [
        { label: "A", answer: stripKb(a) },
        { label: "B", answer: stripKb(b) },
      ],
    },
    key: { step, A: kbFirst ? "kb" : "plain" } satisfies BlindKey,
  };
}

export interface GateInput {
  judgements: readonly Judgement[];
  keys: readonly BlindKey[];
  /** The human check of a sample of knowledge-backed claims (about 20). */
  claimCheck: { checked: number; unsupported: number; critical: number };
  /** Unverified entries stated as fact, found by code (must be 0). */
  unverifiedAsFact: number;
  recall: RecallResult;
  /** Characters of each step's answer in both arms. */
  lengths: readonly { step: string; kb: number; plain: number }[];
  cost: { estimateUsd: number; actualUsd: number };
}

export interface GateResult {
  pass: boolean;
  gates: { name: string; pass: boolean; detail: string }[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The go / no-go gates of plan section 10 (the user's judgements are primary). */
export function evalGates(x: GateInput): GateResult {
  const key = new Map(x.keys.map((k) => [k.step, k]));
  const user = x.judgements.filter((j) => j.judge === "user");
  const arm = (j: Judgement, side: "A" | "B") =>
    (key.get(j.step)?.A === "kb") === (side === "A") ? "kb" : "plain";
  const prefersKb = user.filter((j) => j.prefer !== "tie" && arm(j, j.prefer) === "kb").length;
  const prefersPlain = user.filter(
    (j) => j.prefer !== "tie" && arm(j, j.prefer) === "plain",
  ).length;
  const score = (j: Judgement, a: "kb" | "plain", c: (typeof CRITERIA)[number]) =>
    (arm(j, "A") === a ? j.scores.A : j.scores.B)[c] ?? 0;
  const lower = (c: (typeof CRITERIA)[number]) =>
    user.filter((j) => score(j, "kb", c) < score(j, "plain", c)).map((j) => j.step);
  const storesLower = lower("correct_about_stores");
  const evidenceLower = lower("tied_to_evidence");
  const longer = x.lengths.filter((l) => l.plain > 0 && l.kb > l.plain * 1.2).map((l) => l.step);
  const gates = [
    {
      name: "You prefer the knowledge arm or tie on every step",
      pass: user.length > 0 && prefersPlain === 0,
      detail: `${prefersPlain} of ${user.length} steps prefer the arm without it`,
    },
    {
      name: "You prefer the knowledge arm on at least half the steps",
      pass: user.length > 0 && prefersKb >= user.length / 2,
      detail: `${prefersKb} of ${user.length}`,
    },
    {
      name: "No step lower on correct about the stores or tied to evidence",
      pass: !storesLower.length && !evidenceLower.length,
      detail: [...storesLower, ...evidenceLower].join(", ") || "none",
    },
    {
      name: "Unsupported claims at most 1 of 20, no critical error",
      pass:
        x.claimCheck.checked >= 20 && x.claimCheck.unsupported <= 1 && x.claimCheck.critical === 0,
      detail: `${x.claimCheck.unsupported} of ${x.claimCheck.checked}, ${x.claimCheck.critical} critical`,
    },
    {
      name: "Unverified entries never stated as fact",
      pass: x.unverifiedAsFact === 0,
      detail: String(x.unverifiedAsFact),
    },
    {
      name: "Retrieval recall gate met",
      pass: x.recall.pass,
      detail: `${Math.round(x.recall.recall * 100)} % (gate ${Math.round(x.recall.gate * 100)} %)`,
    },
    {
      name: "Answers at most 20 % longer",
      pass: !longer.length,
      detail: longer.join(", ") || "none",
    },
    {
      name: "Cost within the estimate",
      pass: x.cost.actualUsd <= x.cost.estimateUsd,
      detail: `$${x.cost.actualUsd.toFixed(2)} of $${x.cost.estimateUsd.toFixed(2)}`,
    },
  ];
  const agree = mean(
    x.judgements
      .filter((j) => j.judge === "gpt")
      .map((g) => Number(user.find((u) => u.step === g.step)?.prefer === g.prefer)),
  );
  gates.push({
    name: "Agreement between you and GPT (reported, not a gate)",
    pass: true,
    detail: `${Math.round(agree * 100)} %`,
  });
  return { pass: gates.every((g) => g.pass), gates };
}

/** One report of the evaluation set, as a call graph. */
export interface EvalReport {
  name: string;
  main: boolean;
  abroad: number;
}

/** Judge tokens per step and judge call (the data packet and both answers), an estimate. */
const JUDGE_INPUT = 40_000;
const JUDGE_OUTPUT = 2_000;

/**
 * The evaluation's cost for the approval (plan section 10): the knowledge arm of every report is
 * written anew (its text steps plus the knowledge tokens); the arm without it reuses the saved
 * answers when the inputs are unchanged (else the same text steps again, the high end); every
 * step is judged once by gpt-5.6-sol. The user's own judging is free.
 */
export function evalCost(c: Config, reports: readonly EvalReport[], judge = "codex:gpt-5.6-sol") {
  const lines = reports.map((r) => {
    const text: [number, number] = [0, 0];
    if (r.main) {
      text[0] += c.estimates.synthesisUsd[0] * 1.25;
      text[1] += c.estimates.synthesisUsd[1] * 1.5;
    }
    text[0] +=
      TEXT_USD.abTests[0] +
      r.abroad * (TEXT_USD.countryAdvice[0] + TEXT_USD.countryAdviceReview[0]);
    text[1] +=
      TEXT_USD.abTests[1] +
      r.abroad * (TEXT_USD.countryAdvice[1] + TEXT_USD.countryAdviceReview[1]);
    const kb = kbCost(c, { main: r.main, abroad: r.abroad, abTests: true });
    // Judged steps: pattern wording and recommendations (main country), the A/B tests, and the
    // advice of each other country.
    const steps = (r.main ? 2 : 0) + 1 + r.abroad;
    const p = priceOf(judge);
    const judgeUsd = (steps * (JUDGE_INPUT * p.input + JUDGE_OUTPUT * p.output)) / 1e6;
    const usd: [number, number] = [
      text[0] + kb.usd[0] + judgeUsd,
      2 * text[1] + kb.usd[1] + judgeUsd,
    ];
    return { name: r.name, steps, usd };
  });
  const total: [number, number] = [0, 0];
  for (const l of lines) {
    total[0] += l.usd[0];
    total[1] += l.usd[1];
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pair = (u: [number, number]): [number, number] => [r2(u[0]), r2(u[1])];
  return { lines: lines.map((l) => ({ ...l, usd: pair(l.usd) })), usd: pair(total) };
}
