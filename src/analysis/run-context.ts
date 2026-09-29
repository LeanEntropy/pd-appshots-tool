import type { LoadedConfig, ProjectPaths, Taxonomy } from "../config/load.ts";
import { openKbRun } from "../kb/open.ts";
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

/** The context with the report's knowledge base (Settings switch; off = the context as is). */
export function withKb(ctx: CallContext, loaded: LoadedConfig, gl: string): CallContext {
  const kb = openKbRun(loaded.config, loaded.root, ctx.storage, gl);
  return kb ? { ...ctx, kb } : ctx;
}

/** A copy of the context that also tells `onCost` the cost of its own calls. */
export function withOwnCost(ctx: CallContext, onCost?: (usd: number) => void): CallContext {
  if (!onCost) return ctx;
  return {
    ...ctx,
    // These calls run in the pool, which waits and retries a rate-limited task once.
    poolRetries: true,
    onCost: (u) => {
      ctx.onCost(u);
      onCost(u);
    },
  };
}
