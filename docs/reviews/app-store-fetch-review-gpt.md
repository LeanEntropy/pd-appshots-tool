# Review: App Store A0-A3 (fetch, match, dedup)

One review by gpt-5.6-sol (Codex CLI, read-only) on the diff, 2026-09-29.

## Decisions

- Applied: 1 (store lock taken first, then the analysis check), 2 (a project App Store lock held by the job and by each page save), 3 (lock checked before every write, also inside the image ingest), 4 (identity change replaces the match with a fresh question, never kept as the user's), 5 (a software row that does not parse fails the read), 7 (US first), 8 (all twin candidates checked), 9 (a retry-after longer than 10 minutes stops instead of retrying early), 10 (summary after the fetch), 11 (tests for 2, 4, 5, 9).
- Declined: 6 (name search in en_us). Play names are English; the search still runs in each storefront, and a local-language title would not match the Play name. Candidates always wait for the user.

## Review text

- **High â€” `src/appstore/job.ts:78-84`** â€” The analysis-state check and store-lock acquisition are not atomic. An analysis can acquire its lock after `lockHolder(LOCKS.ai)` is checked but before/after the store lock is acquired, so both jobs can run for the same project. Acquire the store and project-analysis exclusion locks atomically, or make analysis acquisition check the store lease under the same atomic locking operation. Add a race test.

- **High â€” `src/server/routes-appstore.ts:120-163`** â€” UI writes only inspect the lock and then write later; they never acquire it. A CLI process can start between `busy()` and `writeAppStore()`, causing lost confirmations or switch updates. Perform these mutations while holding the relevant store/project lock, including a final lease check immediately before writing.

- **High â€” `src/appstore/fetch-run.ts:153-197`, `src/appstore/ingest.ts:89-137`, `src/appstore/job.ts:146-151`** â€” The lease is not checked before every write. After a pre-download check, `ingest`, alias creation, same-picture metadata, refs saving, store text, deck, and run-result writes can occur after the lock is lost. Thread `held.check` into `AppleImages` and call it immediately before every persistent write; also check separately before text, deck, App Store state, and run-result writes. Add lease-loss tests during download and between consecutive writes.

- **High â€” `src/appstore/fetch-run.ts:145-157`** â€” On identity change, the code changes only `status` and `evidence`. A user-confirmed match retains `source: "user"`, so `runMatching()` permanently skips it, while its candidates still describe the old app. The confirmation UI can therefore offer stale identity data and the match never recovers. Replace the entire match with a fresh `needs_confirmation` record, non-user source, and a candidate representing the newly returned identity.

- **High â€” `src/appstore/api.ts:57-63`** â€” Malformed result rows are silently skipped. If Apple changes a required field or returns a partially malformed matching row, this becomes an empty result and is stored as `not_found`, contrary to the requirement that API failures never become â€œnone.â€ Reject malformed software rows/answers; skip only rows positively identified as non-software. Test a malformed software result.

- **Medium â€” `src/appstore/matching.ts:101`** â€” Name search hardcodes `lang: "en_us"` instead of using `appleLangFor(m.gl, m.hl)`. Candidates and metadata can be wrong or absent in non-English storefronts. Pass `sf(m)` to `searchApps` and test a localized search URL.

- **Medium â€” `src/appstore/job.ts:58-59`** â€” Storefront ordering prioritizes the configured core market, not the US. When the core market is not US, this violates â€œUS firstâ€ and can also choose a non-US cached developer first. Sort US first when present, then retain project order. Add a non-US-core test.

- **Medium â€” `src/appstore/ingest.ts:94`** â€” Only the first three pixel-comparison candidates are examined. A valid Play twin ranked fourth or later is incorrectly classified as new, losing the required same-picture link. Check all candidates within the stated pHash bound, or use a provably safe secondary bound. Add a test where the actual twin is after three false candidates.

- **Medium â€” `src/appstore/queue.ts:103-105`** â€” `Retry-After` is capped at 120 seconds, so a longer server-specified delay is not honored. Keep retries bounded, but sleep for the full valid `Retry-After`; apply the cap only to locally generated exponential backoff if desired. Test an HTTP-date or numeric delay above 120 seconds.

- **Low â€” `src/appstore/fetch-run.ts:145-157` and `src/appstore/job.ts:122-145`** â€” Match-summary arrays are built before fetch-time identity checks mutate matches, so the saved run result can report an app as automatic/confirmed while the deck reports `identity_changed`. Recompute the match summary after fetching or update it when identity changes.

- **Low â€” tests** â€” There is no integration coverage for atomic job exclusion, UI/CLI write races, lease loss before each write, fetch-time identity changes, localized search, US-first ordering, or malformed API rows. These are the highest-risk paths introduced by the change.
