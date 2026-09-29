# Code review: layout breakdown as a separate call (gpt-5.6-sol, 2026-09-29)

Reviewer: gpt-5.6-sol via Codex CLI (read-only, ephemeral), given the requirements and the diff against master inline.

## Findings

- **Major — `src/layout/backfill.ts:128,165`**: The backfill limit is `images × $0.15`, but each layout reserves the `$0.25` step ceiling and the gate requires `remaining > $0.25`. A one-image backfill can never start, and larger runs can stop early despite staying below the advertised estimate. Repairs make the displayed upper cost still less accurate. **Fix:** calculate and display a repair/reservation-safe upper bound, use it for the ledger, and gate via an attempted reservation or `>= STEP_CEILING_USD.layout`.

- **Major — `src/layout/store.ts:111` with `src/layout/capture.ts:73-86`**: A current-version layout that no longer fits the final reading is reported as `missing`. Backfill then pays for a replacement, but `putJsonOnce` retains the incompatible file under the same key; the image remains missing and can be charged again on every run. **Fix:** classify the existing file as `outdated` and never schedule an impossible write-once replacement, or introduce a versioned repair key while preserving tuple/write-once semantics.

- **Major — `src/layout/checks.ts:56-100`**: Validation checks only references that the model chose to emit. It does not require every capture or marketing-text index from the finished reading to be represented. A response containing one generic scene and one band can pass while omitting captures/headlines entirely. **Fix:** require coverage of all applicable capture and marketing-text indexes, with an explicit deterministic rule for merging when the eight-box cap applies.

- **Major — `src/layout/backfill.ts:117-159`**: The AI lock is acquired before taxonomy loading, database opening, provider construction, and record reading. Any synchronous exception during that setup leaks the lock because the `finally` exists only on the later pool promise. **Fix:** perform fallible setup before acquisition where possible and wrap everything after acquisition in `try/catch` that always releases the lease.

- **Minor — `src/layout/backfill.ts:62-64`**: The approval fingerprint hashes only image IDs and cost, not the exact list shown (`game`, ownership, locations/order). The displayed scope can change while the hash remains valid. **Fix:** hash a canonical serialization of the complete ordered `items` array plus the displayed cost.

- **Minor — `src/cli.ts:1,213-219`**: The cleanup feature directly adds `node:fs` operations outside the storage/allow-list boundary, contrary to the stated filesystem constraint. **Fix:** expose narrowly scoped sample enumeration/reading through the approved filesystem abstraction and keep feature code on that interface.

## Outcome

| Finding | Outcome |
|---|---|
| Backfill limit below one call's reserved ceiling | **Applied:** the limit is the top of the range and at least one call's ceiling ($0.25); shown in the approval dialog; the pool starts a call only when that ceiling is left |
| A saved layout that no longer fits was offered again but could never be replaced (write-once) | **Applied:** new status `stale`: kept, shown as no longer matching, never offered or paid for again |
| Checks did not require every capture and headline to be covered | **Applied:** every capture (up to 8) needs an in-game element; every headline text is referenced or lies inside a text-carrying element (test added; the 4 benchmark answers still pass) |
| AI lock could leak if setup failed | **Applied:** all fallible setup happens before the lock is taken |
| Approval fingerprint did not cover the full list | **Applied:** it hashes the whole ordered list, the cost and the limit |
| node:fs in src/cli.ts | **Declined:** src/cli.ts is on the legacy allow-list (test/code-rules.test.ts); the cleanup command reads the samples there and hands them to the storage-only module |
