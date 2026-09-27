# Milestone 1 code review (gpt-5.6-sol)

Reviewer: gpt-5.6-sol via Codex CLI (`codex exec -m gpt-5.6-sol -s read-only --skip-git-repo-check --ephemeral`), 2026-09-28. Cross-family review of Claude's implementation of milestone 1 (1a settings, registry, storage; 1b shared library and the Rogue Legend import) of `docs/plan-project-setup.md`.
Input: the requirements summary, 22 new or central files in full, and the diff of the changed existing files.
Result: 13 findings (11 high, 1 medium, 1 low). Verdict: "not safe to merge". All 13 were fixed; see the outcome table.

## Outcome

| # | Finding | Outcome | Fix |
|---|---|---|---|
| 1 | Heartbeat and release could replace or delete a lock taken over by another process | Fixed | Heartbeat only touches the file time (never replaces the file) and re-checks the nonce; release moves the lock aside atomically, deletes it only if the nonce is ours, otherwise puts it back without overwriting |
| 2 | Stale takeover could remove a live replacement lock | Fixed (bounded) | A moved lock that is not the judged stale one is put back with a non-overwriting link; if that fails, the owner detects the loss at its next heartbeat (finding 3) and stops. A true compare-and-swap is not available on the local file system |
| 3 | Heartbeat failures were ignored | Fixed | `acquireAll` returns `check()`, which throws when any lock was lost; the import calls it before every phase and before the switch |
| 4 | Resuming an interrupted switch took no locks | Fixed | The resume takes the library and both lane locks first |
| 5 | Identity refresh could rewrite another project's existing record without journaling it | Fixed | Only records this import created are refreshed; existing library records are never modified |
| 6 | Rollback of carried-over entries could delete or revert other projects' data | Fixed | Rollback keeps every library entry whose image another project references (scan of all refs), and takes back only its own appended hash from Google-id files instead of restoring an old snapshot |
| 7 | Journal written after batches, not ahead of changes | Fixed | Write-ahead: the keys about to be created (and Google-id appends) are journaled and saved before anything is written |
| 8 | Imported settings were not validated against the project settings schema | Fixed | `settingsFromConfig` parses with `ProjectSettingsSchema`; an incompatible legacy project is refused in the read-only preflight |
| 9 | `overrides` could replace project fields (e.g. `project`) and cross project boundaries | Fixed | `overrides` is a strict object of tool-default sections only; project fields are applied after the merge; the loader asserts project and game ids |
| 10 | Analysis key omitted the review policy (coverage, thresholds) | Fixed | The pipeline spec includes the review policy; imported records need a real (or required-and-attempted) second opinion to be proven |
| 11 | Gate compared only record status/version, not content | Fixed | The gate hashes the full record a project sees, minus library bookkeeping and on-disk paths (served paths are kept) |
| 12 | Write-once blob commit used an overwriting rename | Fixed | Exclusive commit with a hard link (never replaces); an existing file is hash-checked |
| 13 | Refs cache could serve an image just removed, and was keyed only by refs key | Fixed | Cache keyed by the absolute refs path and invalidated on every refs write in the process |

Tests added for the fixes: lost lease detected before writing; overrides cannot change the project; an interrupted switch is finished under the locks; a rollback keeps entries another project uses.

## Raw review
- **High — `src/storage/leases.ts`, `lease().heartbeat()` and `lease().release()`**  
  Ownership checks and mutations are separate filesystem operations. After the nonce is read, another process can take over the stale lock; the old holder can then rename its heartbeat over the new lock or unlink the new lock during release.  
  **Scenario:** process A pauses past the stale timeout; B takes the lock; A resumes between B’s acquisition and A’s `renameSync`/`unlinkSync`, destroying B’s valid lock. Both processes may then mutate the library concurrently.  
  **Fix:** use a lock representation supporting atomic compare-and-update, or renew/release by atomically renaming the held inode and verifying its nonce without ever replacing the live path. At minimum, never rename over or unlink a path merely because an earlier read matched.

- **High — `src/storage/leases.ts`, `takeOver()`**  
  Takeover can remove a live lock. If the lock changes between `readLock(path)` and `renameSync(path, aside)`, `takeOver` may move the replacement lock. Its attempted hard-link restoration fails if another contender has already created the path, after which the moved live lock is deleted.  
  **Scenario:** A inspects stale lock S; owner renews/replaces S with live lock L; A moves L aside; C creates a lock; A deletes L because restoration failed. L’s owner continues working without ownership.  
  **Fix:** make stale takeover conditional on the exact lock instance, such as an atomic claim of a uniquely named lock/inode. Do not delete an aside file when restoration failed; retry or report contention.

- **High — `src/storage/leases.ts`, `acquireAll()`**  
  Heartbeat failures are ignored. The interval calls `heartbeat()` but does not stop the operation or expose loss of ownership.  
  **Scenario:** antivirus interference, a takeover race, or an external deletion makes one heartbeat return `false`; import continues moving folders and writing shared records while another process legitimately holds the same lock.  
  **Fix:** surface lease loss through an abort signal/error checked by the import before every phase and before the final switch.

- **High — `src/library/import/run-import.ts`, `runImport()` interrupted-switch branch**  
  An import with journal phase `"switching"` calls `finishSwitch()` before acquiring any locks.  
  **Scenario:** after a crash during switching, a rerun moves legacy folders and updates registry/refs concurrently with an AI or store job.  
  **Fix:** acquire the same library/AI/store locks before resuming `finishSwitch`, and revalidate settings and state while holding them.

- **High — `src/library/import/steps.ts`, `refreshIdentities()`; `src/analysis/record-store.ts`, `writeStoredRecord()`**  
  Identity refresh can overwrite a pre-existing shared analysis record, but the journal does not record its previous contents. `writeRecords()` deliberately keeps an existing proven record; `refreshIdentities()` then reads that record and `recordWriter` writes it back with project-specific identity and `writtenBy`. Rollback tracks only newly created pixel facts.  
  **Scenario:** project B already owns a record for the same image/key. Project A’s import refreshes it, then the equivalence gate fails. Rollback leaves B’s record modified by A.  
  **Fix:** never mutate pre-existing library records during import, or journal their complete previous contents before the first write and restore them on rollback. Prefer generating the staged identity comparison without persisting changes.

- **High — `src/library/import/journal.ts`, `startJournal()`/`rollback()`**  
  Carrying `created` and `modified` entries across interrupted attempts can delete or revert changes made later by another project. There is no ownership/version check before rollback.  
  **Scenario:** import A creates a shared image or record and crashes. Import B subsequently adopts or legitimately updates that entry. A is rerun and fails; its rollback deletes the shared entry or restores an old Google-ID file, losing B’s data.  
  **Fix:** journal expected hashes/versions and undo only when the current entry still exactly matches what this import wrote. Shared content adopted by another project must not be deleted. Google-ID rollback must merge, not restore an obsolete whole-file snapshot.

- **High — `src/library/import/steps.ts`, `linkFiles()`, `writeFacts()`, and `writeRecords()`**  
  Journal persistence occurs after batches or whole phases rather than before/with each mutation. A crash leaves unjournaled library files and modifications. On rerun they appear pre-existing, so they are not added to `created`/`modified` and cannot be rolled back.  
  **Scenario:** the process crashes after adding a Google-ID entry or after linking 300 files but before `save()`. The next attempt fails its gate; those changes remain despite the “exact rollback” guarantee.  
  **Fix:** use write-ahead journaling: persist the intended operation and prior value before each mutation, then mark it complete. Batch only if the batch itself is recoverable and idempotently reconciled.

- **High — `src/config/project.ts`, `settingsFromConfig()`**  
  Constructed settings are never passed through `ProjectSettingsSchema`. The legacy `ConfigSchema` accepts values rejected by the new schema, including package IDs without the new format, names over 100 characters, and more than 60 competitors.  
  **Scenario:** a valid legacy project with an ID such as `123game` passes the equivalence gate, gets switched, and receives a `project.json` that `readSettings()` subsequently refuses to load.  
  **Fix:** return `ProjectSettingsSchema.parse(...)` before any import mutation. Either align the schemas or reject incompatible legacy projects during the read-only preflight.

- **High — `src/config/project.ts`, `settingsToRawConfig()` / `deepMerge()`**  
  `overrides` is an unrestricted record, and unknown top-level keys survive the merge. Because `...merged` comes after `project`, `ourApp`, `charts`, and other project fields, an override can replace them. Only `workspace` is prohibited.  
  **Scenario:** `projects/a/project.json` contains `overrides: { project: "b" }`. `loadProject("a")` returns a config whose `projectPaths()` points at project B, allowing commands launched for A to read or modify B’s data.  
  **Fix:** schema `overrides` as a deep partial of only the permitted tool-default fields, reject unknown keys, and assert after merging that `config.project === settings.id` and the project-owned fields equal the settings-derived values.

- **High — `src/analysis/pipeline.ts`, `currentPipeline()`**  
  The analysis key omits settings that determine whether and how an image is reviewed, including review coverage and confidence thresholds. It only includes `review.enabled` indirectly through the reviewer model.  
  **Scenario:** project A reviews 0% of expansion images while project B reviews 100%, but both produce the same analysis key. B can silently reuse A’s producer-only record instead of obtaining its required second opinion.  
  **Fix:** include every review-selection and analysis-affecting setting in `PipelineSpec`, or derive the key from a canonical complete per-image analysis policy.

- **High — `src/library/import/snapshot.ts`, `takeSnapshot()` / `compareSnapshots()`**  
  The record equivalence check hashes only image ID, status, schema, timestamp, and usability. It does not compare `final`, producer/reviewer/adjudication references, identity, mappings, or other record content. The plan and latest gallery hashes do not guarantee coverage of every record.  
  **Scenario:** `writeRecords()` keeps a different existing library record with the same status/schema/timestamp. If that image is outside the current plan/latest run, the gate can pass while the project receives different analysis content.  
  **Fix:** hash the complete project-visible record before and after, excluding only newly added storage metadata whose equivalence is separately proven. Explicitly compare every record selected by `readStoredRecord`.

- **Medium — `src/storage/local-fs.ts`, `putBlob()`**  
  Write-once behavior uses `existsSync` followed by `renameSync`, which is not an exclusive commit. Two processes can both see the destination absent and both rename temporary files to it; on platforms where rename replaces the target, the last writer wins.  
  **Scenario:** concurrent thumbnail/model-copy generation commits different bytes under one logical key, silently replacing the first result.  
  **Fix:** commit through an exclusive-create operation (`wx`) or link a temporary file into the final name atomically, then verify the winner. Never use an overwriting rename as the write-once commit.

- **Low — `src/library/serve.ts`, `referenced()`**  
  The three-second cache can authorize an image after it has been removed from the project’s refs. The cache key is only `refsKey`, not the workspace identity.  
  **Scenario:** refs are updated to remove an image, but requests during the TTL still receive it; two workspaces with the same project key can also share cached authorization state in one process.  
  **Fix:** invalidate the cache on refs writes, or key it by resolved workspace plus refs key and validate file version/mtime. For a strict authorization boundary, read the current refs for each request.

**Verdict:** not safe to merge. The lock implementation can lose mutual exclusion, rollback can modify or delete other projects’ shared data, settings can cross project boundaries, and the equivalence gate can approve materially different analysis records.
