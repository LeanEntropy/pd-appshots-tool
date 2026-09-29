# Review: analysis speed implementation (gpt-5.6-sol)

Date: 2026-09-29. Reviewer: gpt-5.6-sol via codex exec -m gpt-5.6-sol -s read-only --skip-git-repo-check --ephemeral (diff passed inline). Three rounds.

## Round 1 (full diff)

1. **Major — reservations do not cap the individual call to the reserved ceiling.**  
   [src/analysis/budget.ts:66](src/analysis/budget.ts:66) returns `maxUsd: left`, although only `amount` was reserved. With concurrent calls, each CLI process may therefore spend more than its reservation and push aggregate spend over the batch limit.  
   **Fix:** return `maxUsd: amount` and pass that exact ceiling to the provider.

2. **Major — unknown call cost releases the reservation as if the call were free.**  
   [src/analysis/call.ts:187](src/analysis/call.ts:187) calls `held.done(r.costUsd ?? 0)` and records no spend when a timed-out/failed CLI process omits cost. Subsequent calls can start even though the failed process may have consumed its full CLI allowance, violating the exact spending limit.  
   **Fix:** on unknown cost, account for the reservation ceiling conservatively—or stop the batch while retaining that reservation. Reconcile later only when an authoritative cost is available.

3. **Major — rate limits can cause up to four attempts and do not reliably reduce concurrency.**  
   [src/analysis/call.ts:171](src/analysis/call.ts:171) retries provider errors internally before `runPool` sees them. Then [src/analysis/pool.ts:32](src/analysis/pool.ts:32) retries the whole task again. A rate-limited call can therefore run twice immediately and twice after the pool retry, contradicting “drop to one and retry once after waiting.”  
   **Fix:** classify rate-limit errors in `validatedCall` and return them without its generic retry; let the pool perform the sole delayed retry.

4. **Major — rate-limit state is shared and can be attributed to the wrong concurrent task.**  
   [src/analysis/run-images.ts:77](src/analysis/run-images.ts:77) and [src/analysis/layer-diff-run.ts:100](src/analysis/layer-diff-run.ts:100) use one mutable `rateWait`. Any worker finishing next may consume it, causing the wrong task to be retried while the actual rate-limited task is lost.  
   **Fix:** make `run(task)` return task-local status such as `{continue, retryAfterMs}`; have `runPool` retry that exact task.

5. **Major — pixel-dependent layer comparisons can be reused after their verdict/settings change.**  
   [src/analysis/layer-diff.ts:139](src/analysis/layer-diff.ts:139) derives crops/schema/task from the pixel verdict, but `currentLayerDiff`/`layerDiffKey` still key only the original `keyInput`; the record’s `pixel` data is merely informational. Changing pixel thresholds can change which fields and images should be sent while the old layer record remains current.  
   **Fix:** include pixel-check version, result/regions hash, effective verdict/parts, crop version, and relevant thresholds in the layer-diff record key.

6. **Major — report runs do not record per-call tokens/time/cost in their manifest.**  
   Core analysis adds `onCall` and writes `bc.calls`, but [src/reports/report-run.ts:59](src/reports/report-run.ts:59) creates the report context without an `onCall` collector, and no report manifest call log is added. This misses full-analysis, layer-diff, and report-writing calls required by the plan.  
   **Fix:** use a shared batch context for report runs and persist its complete call log and ledger warnings in the report-run manifest.

7. **Minor — enabling measured colours can silently mix measured and model colours.**  
   [src/analysis/colour-store.ts:76](src/analysis/colour-store.ts:76) leaves unmeasured records unchanged. Existing records are bulk-measured only from `runAnalysis`; synchronous report paths such as [src/analysis/report-inputs.ts:76](src/analysis/report-inputs.ts:76) merely read cached measurements. A report rebuild immediately after enabling the switch may therefore use a mixture.  
   **Fix:** run `measuredRecords` before report generation, or make approval explicitly perform/await a complete free measurement pass and refuse mixed inputs.

8. **Minor — the first paid call is not necessarily the call run alone.**  
   [src/analysis/pool.ts:57](src/analysis/pool.ts:57) serializes the first queued task, but that task may be a cache hit. The first actual paid miss can then start alongside other misses, defeating the required prompt-cache warm-up.  
   **Fix:** distinguish cache hits from paid starts and keep serial scheduling until the first paid call completes.

**Overall verdict: no-go.** The reservation and rate-limit defects can violate the approved spending guarantees; fix those before running paid workloads.

Decisions: 1-4, 6-8 fixed in 2d2b7a9; 5 declined (the comparison reads the actual crop; the pixel verdict only decides what is asked; no text comparison has run yet; keying on it would tie every report lookup to the pixel settings).

## Round 2 (fix diff)

1. **High — `src/analysis/call.ts:202` — Rate-limit retries were disabled globally.** `validatedCall` is also used outside `runPool` (including synthesis and the deferred-image path), so those calls now receive no retry. Make pool-managed calls opt out explicitly, while retaining the internal retry for direct callers, or route every caller through the pool.

2. **Medium — `src/analysis/run-images.ts:212`, `src/analysis/layer-diff-run.ts:191` — The warm-up fix still marks every attempted task as paid.** Both paths return `paid: true` even when `validatedCall` returns a cached answer, so concurrency can still begin before any real model call warms the prompt cache. Derive `paid` from whether the provider was actually invoked, not whether the task reached analysis.

3. **Medium — `src/reports/report-run.ts:236` — Call logs are written only after report construction succeeds.** An exception or interruption after paid calls leaves the run without its per-call log. Persist as calls complete, or flush the log in a `finally` block.

Findings 1, 2, 4, and 7 otherwise appear correctly addressed; 6 is only partially fixed. Finding 5’s decline is reasonable.

**Verdict: no-go.**

Decisions: all three fixed in 686418a.

## Round 3 (fix diff)

1. Medium — `src/reports/report-run.ts:75`: removing the final `saveCalls()` means `calls.json` is never created when a report makes zero paid calls, and warnings added after the last call are not persisted. Fix: keep incremental saves in `ctx.onCall`, and also call `saveCalls()` once at report completion.

The three prior findings are otherwise fixed: retry ownership is pool-scoped, cache hits no longer count as paid, and calls are saved incrementally.

Verdict: **go with fixes**.

Decision: fixed (the call log is also saved once at the end of the report run).
