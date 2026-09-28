# Code review: add competitors from the Competitors tab

Reviewer: gpt-5.6-sol through Codex CLI (read-only, cross-family), 2026-09-28.
Scope: branch `feat/add-competitor` against master 57b9a00 (commit 93ca52c), with PILLARS and plan sections 1.4 and 6.3 as the requirements. The sandbox blocked shell commands, so the diff and the related files were given to the reviewer in one bundle.

6 findings: 4 accepted (2 in part), 2 declined.

## Outcome

| # | Severity | Finding | Outcome | What changed / why |
|---|---|---|---|---|
| 1 | High | A library image is reused because its Google ID is known, without checking its file is on disk | Declined | The same rule is used by the existing whole-project download (`runDownload`, `LibraryImageDb.byGoogleId`). Library files are write-once and hash-checked; a library-wide integrity check and repair belongs with the "Free up space" and store-history work, not this feature |
| 2 | High | A download with failed images is reported as finished, and the game counts as downloaded if any deck exists | Accepted | The job now ends as failed with a plain message ("N images downloaded, but M could not be downloaded... Press Check the store"), keeping what was fetched. The list marks a game downloaded only when every store page was read and every screenshot is on disk, otherwise "Download incomplete" with Check the store. Tested |
| 3 | Medium | `state/downloaded.json` is not updated | Declined | That record does not exist yet in the code (whole-project incremental downloads and the "new items" notice are milestone 4/5). The merged run manifest records the new deck keys in `added` |
| 4 | Medium | Idempotency only while the job is in memory; a finished approval can be replayed | Accepted in part | A download approval that already finished is refused ("is downloaded already"). A failed or stopped one may run again: it fetches only what is still missing. Store checks stay repeatable on purpose (free, no images). Tested |
| 5 | Medium | Remove writes settings and pick separately; a crash in between leaves them inconsistent; picker saves are not in the same queue | Accepted in part | The pick is now written first, so a stop in between only leaves the game unticked. A picker save naming a removed game is already refused by `resolvePick`; one shared write queue for settings and pick is not added |
| 6 | Medium | Lease loss is only checked on progress callbacks; the tail of a job can commit after losing the lock | Accepted in part | The store job checks its lease after the work returns and before it is marked finished, and the store check reports progress (and so checks the lease) before measuring and writing its preview. The download's last writes inside `runDownload` are not guarded separately (the lock is renewed every 15 s and only taken over after 2 minutes without a heartbeat) |

## Raw review

- **High** — `src/steps/download.ts:61`: An image is treated as reusable solely because `db.byGoogleId(gid)` returns metadata. The required integrity check that the original image file actually exists is missing, so a deleted/corrupt library blob is skipped and the new deck is written with a broken image reference. Add a storage-layer integrity API that verifies the database record and blob on disk; redownload or repair images that fail it. Use the same check when calculating `inLibrary` in `src/steps/add-competitor.ts:158`.

- **High** — `src/server/routes-competitors.ts:91`: The download job ignores `runDownload`'s `failed` result and reports the job as finished. `getCompetitors` then marks the game downloaded merely because any named deck exists (`src/server/competitors-api.ts:52`), removing the retry button even when slots failed or countries have error decks. Fail or explicitly mark the job incomplete when `failed.length > 0`, and calculate `downloaded` only when every expected deck passes the required manifest/file integrity check.

- **Medium** — `src/steps/add-competitor.ts:196`: The incremental path calls `runDownload` but never updates `state/downloaded.json` with the current settings fingerprint and merged deck keys. Later "new items" detection and whole-project incremental downloads will continue treating this competitor as new. After the merged manifest is committed, atomically update the downloaded-state record with the current settings fingerprint and the full merged deck-key set.

- **Medium** — `src/jobs/store-runner.ts:65`: Idempotency exists only while a job remains in the in-memory `storeRunning` map. Replaying the same approved download after completion or after restarting the tool starts it again, creates another run, and can repeat work; a sufficiently fast job can also finish before a duplicate request is handled. Persist an idempotency/approval identifier in the journal and refuse or return the completed job for an already-used download approval. Store checks need a distinct persisted request generation instead of the constant empty `planHash`.

- **Medium** — `src/server/competitors-api.ts:139`: Removing a competitor writes settings and the core pick as two independent operations, while picker saves are not serialized through `oneAtATime`. A concurrent `/selection` save can reinsert the removed app into `run-config`, and a crash/write failure between the two writes leaves settings and the pick inconsistent. Serialize add/remove and selection writes under the same project mutation lock/queue, re-read both immediately before commit, and make the settings-plus-pick update recoverable as one journaled transaction.

- **Medium** — `src/jobs/store-runner.ts:115`: Lock ownership is checked only when the work callback emits progress. `checkGame` performs measurement and writes its plan after its last progress event, and `runDownload` writes decks and the merged run manifest after its last image callback. If the lease is lost during either tail, the job can still commit data and be marked finished. Check the lease after `work` returns and immediately before each persistent commit, or pass an ownership guard into the download/check routines so they cannot write after lease loss.
