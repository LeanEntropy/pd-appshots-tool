import type { ProjectPaths, Taxonomy } from "../config/load.ts";
import { answerKey } from "../library/layout.ts";
import { workspaceStorage } from "../storage/index.ts";
import { type Ledger, ledger } from "./budget.ts";
import type { CallContext, CallLog } from "./call.ts";

export interface BatchContext {
  ctx: CallContext;
  spent: () => number;
  /** Every paid call of the run, with tokens and time (written to the run manifest). */
  calls: CallLog[];
  ledger: Ledger;
}

/** The call context of one analysis run: spending limit with reservations, and a call log. */
export function batchContext(
  paths: ProjectPaths,
  taxonomy: Taxonomy,
  taxonomyHash: string,
  budget: number,
): BatchContext {
  let spent = 0;
  const calls: CallLog[] = [];
  const book = ledger(budget, () => spent);
  const ctx: CallContext = {
    storage: workspaceStorage(paths.workspace),
    answerKey: (step, key) => answerKey(paths, step, key),
    taxonomy,
    taxonomyHash,
    maxBudgetUsd: 3,
    remainingUsd: book.remaining,
    timeoutMs: 900_000,
    onCost: (u) => {
      spent += u;
    },
    reserve: book.reserve,
    onCall: (c) => {
      calls.push(c);
    },
  };
  return { ctx, spent: () => spent, calls, ledger: book };
}

/** A copy of the context that also tells `onCost` the cost of its own calls. */
export function withOwnCost(ctx: CallContext, onCost?: (usd: number) => void): CallContext {
  if (!onCost) return ctx;
  return {
    ...ctx,
    onCost: (u) => {
      ctx.onCost(u);
      onCost(u);
    },
  };
}
