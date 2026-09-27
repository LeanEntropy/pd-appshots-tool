# Review of docs/plan-project-setup.md by gpt-5.6-terra

Date: 2026-09-27. Invocation: `codex exec -m gpt-5.6-terra -s read-only --skip-git-repo-check --ephemeral`, with the plan, the stage requirements, PILLARS excerpts and the relevant code inlined on stdin. Raw output below, unedited.

---

1. **High — §5.1 / §1.3: required expansion lifecycle is not implemented.** `expand` is only “greyed in the step bar; built later,” and there is no separate recommendations stage. This conflicts with the required lifecycle and the expanding-circle flow, which must ask the user how to expand after the core result.  
   **Fix:** Define and implement persisted/derived states for `expansion-choice`, `expansion-preview`, `expansion-running`, and `recommendations`; after core, present the country/competitor checkbox choice and require approval for each expansion.

2. **High — §5.1, §6.2: analysis can apparently run without a valid confirmed core pick.** Existing `postAnalysisPlan` and `postAnalysisRun` only check the plan hash and cap. They do not require `run-config.json.confirmed`, a whole-deck fit, or the minimum competitor count. The new plan says this logic is unchanged.  
   **Fix:** Make pilot/core planning and run endpoints reject execution unless the saved selection is confirmed, fits the whole-deck rule, includes at least `core.minCompetitors`, and has a current download data fingerprint.

3. **High — §5.3 / §7: resumed analysis can exceed the approved per-increment budget.** The current job state resets `spentUsd` when `runApproved` starts. `buildAnalysisPlan` estimates remaining work only, while the plan merely states that prior spending “counts.” There is no durable increment-level cost ledger or enforcement mechanism across restarts/resumes.  
   **Fix:** Assign an immutable approved increment ID; persist actual spending after every call; show prior, remaining, and maximum total before Continue; pass the remaining budget into the runner and enforce it before each call.

4. **High — §5.3: “resume exactly where it stopped” is not guaranteed for charged model calls.** A crash after a provider accepts a request but before the response cache/analysis record is atomically written will resend the request and incur another charge. “Cache by full input” does not solve this unless the cache write is durable before record processing and provider calls are idempotent.  
   **Fix:** Persist a per-request intent with a stable request ID before dispatch, atomically save the raw response before deriving records, and reconcile pending requests on resume. Where providers support idempotency keys, use them.

5. **High — §5.3 / §6.3: download resume contradicts the existing approval validation model.** Existing `planProblem` rejects a plan when the config hash changes. The plan permits settings edits while a job runs and says resume uses the “same approved plan,” but does not specify a snapshot path insulated from later previews/settings changes. A later store check can overwrite `pending/download-plan.json`.  
   **Fix:** Store each approved plan under an immutable run/increment ID and resume strictly from that snapshot. Do not rebuild it or overwrite it. Settings changes should create a separate pending increment, not alter an approved one.

6. **High — §5.3: interrupted store previews are not actually resumable at target granularity.** Current preview construction writes only at the end. Its cache helps only for fresh successful entries; it does not persist a partial target list, chart results, errors, or progress checkpoint. Re-running can repeat reads after cache expiry and cannot reliably report the exact stopping point.  
   **Fix:** Persist a preview work manifest before starting, checkpoint every completed chart/listing, and resume unfinished target keys from that manifest. Retain the partial manifest until the user discards or replaces it.

7. **High — §7: lock takeover has race and ownership bugs.** A stale-lock remover and two contenders can both decide a lock is stale; a prior owner can later delete a lock acquired by a new owner. PID-only checks also fail under PID reuse. The plan does not define an ownership token or compare-and-delete procedure.  
   **Fix:** Put a random lock nonce and process-start identity in every lock; verify nonce before heartbeat or release; use retrying exclusive creation after stale takeover; never unlink a lock not owned by the caller.

8. **High — §7 / §6.1: server single-instance handling is underspecified and can create unsafe duplicate servers.** `server.json` has only PID and port, with no startup ordering, nonce, liveness protocol, or handling for a port occupied by an unrelated process. The current server falls back to a random port, which can undermine the intended singleton behavior.  
   **Fix:** Acquire a nonce-protected server lock before binding, verify the recorded server with a local authenticated health endpoint, and only publish `server.json` after listening. If a live owned server exists, open it; otherwise recover the stale lock.

9. **High — §8 / §12: automatic migration conflicts with the stated approval checkpoint.** Section 8 says first server startup automatically migrates and writes files; milestone 1 says the user approves migration after seeing a dry run. Automatic mutation also makes a failed or surprising migration occur merely by opening the app.  
   **Fix:** Never apply migration automatically. Detect legacy data and offer a dry-run summary plus an explicit in-app or CLI confirmation.

10. **High — §2.2 / §2.4 / §5.1: a project created after step 1 cannot satisfy the current runtime config schema.** `ConfigSchema` requires at least one competitor and `ownAssets`; the wizard deliberately creates a project with no competitors, and new projects have no own assets. The plan says project state is derived from this data and the loader validates merged settings with the existing schema.  
   **Fix:** Separate draft-project validation from runnable-config validation. Only load a strict runnable `Config` after required setup is complete; make `ownAssets` optional in the actual schema and ensure routes for draft projects never require a runnable config.

11. **Medium — §5.3: there are still two competing analysis-status stores.** The summary says only the job journal is stored, but the design keeps both `state/job.json` and `pending/analysis-status.json`, plus in-memory state. They can diverge after a crash or partial write, making “derived state” unreliable.  
   **Fix:** Make one versioned, validated job journal canonical. If compatibility requires reading the old analysis status file, import it once and stop writing it.

12. **Medium — §6.3: incremental download incorrectly treats an old deck as permanently complete.** A manifest with `ok` or `unavailable` means “already downloaded” regardless of whether it belongs to the current approved target/settings snapshot, has missing image files, or was produced by an incomplete/failed download. This can hide missing decks and images.  
   **Fix:** Reuse only a manifest that passes integrity checks, matches the target key and desired store snapshot policy, and has all referenced images available; explicitly distinguish “unavailable confirmed” from “not yet checked.”

13. **Medium — §3.2: icon download validation is insufficient.** Allow-listing the initial hostname and limiting the post-download buffer does not protect against redirects, oversized streamed responses, image decompression bombs, or non-image content. The existing `fetch(...arrayBuffer())` pattern is unbounded.  
   **Fix:** Disable redirects or validate every redirect target, enforce `Content-Length` and streaming byte limits, require an image content type, cap decoded dimensions/pixels in `sharp`, and set a request timeout.

14. **Medium — §3.2 / §4: Zod coverage is incomplete at existing file boundaries.** Current `PlayClient` casts cached JSON directly to `Listing`/`ChartResult`; the plan adds schemas for new scraper responses but does not say existing project caches, saved plans, manifests, image DB data, or legacy analysis status are parsed before use. Corrupt local files can still reach runtime logic.  
   **Fix:** Add schemas at each persisted-data read boundary, especially cache entries and resumable job/plan files; quarantine invalid cache entries and present a recoverable plain-language error.

15. **Medium — §3.2: the competitor-search UI promises data it does not fetch.** The mock results show category and installs, but the proposed `search()` response lacks both and the plan explicitly defers `details()` until after selection. That violates the stated confirmation/search flow and makes the displayed result ambiguous.  
   **Fix:** Either change the result card to show only available search fields, or fetch and validate details for the displayed matches before rendering them, with clear progress and caching.

16. **Medium — §6.2 / §6.4: the route migration is incomplete and likely breaks existing gallery calls.** The plan lists existing endpoints as “unchanged logic, now per project,” but only mentions injecting `API_BASE` into the gallery. Existing endpoint registration, redirects, static paths, report file exposure, and generated gallery HTML need an explicit route-by-route migration and tests for every existing action.  
   **Fix:** Make a complete route inventory, convert every client call to a single relative API helper, and add integration tests for selection, plan, run, status, analyses, report, image loading, and direct project URLs.

17. **Medium — §5.1: state derivation does not adequately detect stale reports/data.** “Latest pilot/core report is complete for current data” is asserted, but no comparison rule is defined for settings changes, deck-manifest changes, taxonomy changes, selection changes, or record corrections. Existing `readLatest` alone cannot establish that.  
   **Fix:** Define a versioned data fingerprint for each report from selected decks, image identities, usable-record versions, taxonomy, and relevant settings; store it in the report manifest and compare it during state derivation.

18. **Low — §10: file-size compliance is planned but not enforced.** Approximate module budgets do not prevent later files from exceeding 300 lines, especially route handlers and wizard scripts.  
   **Fix:** Add a lightweight test or lint script that fails CI when TypeScript source files exceed 300 lines, with narrowly documented exceptions only if approved.

19. **Low — §1.4 / §5.1: removal can silently invalidate reports and selections without clear historical labeling.** Removed competitors are hidden and core picks are altered, but existing pilot/core reports may still look current unless the missing data-fingerprint rules are implemented.  
   **Fix:** Mark affected reports as based on an earlier selection, require a new pick before further analysis, and retain prior reports as dated history rather than presenting them as current.

Decisions the user should make:

- Whether migration must always require explicit confirmation; automatic migration should be removed.
- Whether an approved download remains resumable after settings change, or whether any settings edit invalidates/cancels that approved increment.
- Default countries for new projects.
- Whether global single-AI-job scheduling remains the intended policy; the plan’s global choice is reasonable only if lock ownership and durable queue/rejection behavior are fixed.
---

## Delta review 1: shared image and analysis library (section 12A)

Date: 2026-09-27, gpt-5.6-terra, same invocation, section 12A plus the record and image-database types inlined. Raw output:

1. **High — Analysis key is incomplete.** It omits reviewer and settling prompt versions (and likely provider/settings that affect output). Same key could incorrectly reuse a different pipeline’s result.  
   **Fix:** Key on a canonical, versioned full pipeline spec: every stage’s prompt/template hash, model/provider parameters, schema, image-preprocessing version, and adjudication/settling logic.

2. **High — “Never downloaded twice” is not achievable from the proposed lookup.** Before downloading a new Google image ID, its SHA-256 is unknown. A byte-identical image under a new ID will still be fetched once under A5.  
   **Fix:** Define the guarantee as “never stored or analysed twice”; add canonical source-URL/ETag indexes to avoid known duplicate fetches, and explicitly state that unknown alternate IDs cannot be deduplicated before first retrieval.

3. **High — Migration cannot safely derive reusable analysis keys from the shown legacy record.** The old type does not contain all required prompt/pipeline versions; a run manifest may be absent or insufficient, especially for review/settling. Inventing a key would silently grant unapproved reuse.  
   **Fix:** Migrate only records with provable complete provenance into their exact key. Preserve the remainder as `legacy-unverified` records, visible as history but not reusable until explicitly matched/approved. If all 18 must remain reusable, establish the missing version mapping before migration.

4. **High — Shared record identity leaks other projects’ data.** A record containing appearances across all projects conflicts with project isolation if any referenced project can read that record. Image-serving checks alone do not protect analysis JSON, reports, or APIs.  
   **Fix:** Keep the required global identity in a library-private record, but return project-scoped identity projections; expose only the allowed attribution (for example, “another project”) unless cross-project visibility is explicitly authorized.

5. **High — Cost attribution is not crash-safe.** A provider call, shared-record write, and payer’s project ledger update span separate files. A crash can produce an uncharged usable record, a charged failed/missing result, or inconsistent reuse attribution.  
   **Fix:** Under the record lock, use a durable intent/settlement state machine with idempotency keys: persist payer intent before the call, persist provider outcome/result, then reconcile the payer ledger idempotently on restart.

6. **High — Migration rollback can delete data another project started using.** “Remove only library entries it created” is unsafe without exclusive migration/GC coordination; a concurrent project may reference or complete an entry after it appears in the journal.  
   **Fix:** Hold a library-wide mutation lock for migration through gate/switch, or use ownership tokens plus a fresh full refs scan before rollback deletion. Require all ref-writing operations to coordinate with that lock.

7. **Medium — Google-ID files need synchronization and conflict handling.** They are not truly harmless write-once files: one ID can race, or later resolve to different bytes. Blind “target exists” handling can retain a wrong mapping.  
   **Fix:** Lock/CAS per Google ID; validate existing mapping against the fetched hash, retain immutable conflict evidence, and require an explicit policy for changed upstream content.

8. **Medium — “Refresh identity without changing `updatedAt`” makes freshness blind to meaningful data changes.** Reports whose identity/appearance fields are displayed can remain marked current after they changed.  
   **Fix:** Separate `analysisUpdatedAt` from `identityUpdatedAt`, and include the latter (or a project-scoped identity hash) in report freshness whenever identity-derived fields are rendered.

9. **Medium — The approval invalidation rule is underspecified.** A plan fingerprint “includes each image’s tier,” but a concurrent completion changes paid/free eligibility after approval. Unless the current reusable-record state is part of the checked snapshot, the runner can execute against a materially different plan.  
   **Fix:** Include a deterministic library availability snapshot (record key/status/version per selected image) in the approval hash, then recheck it immediately before execution and require renewed approval on a change.

10. **Medium — GC’s “all live projects” set is undefined and races ref changes.** Scanning folders while imports, deletions, or ref updates occur can reclaim data that was just referenced; archived folders alone are not a durable lifecycle definition.  
   **Fix:** Maintain an authoritative project registry/lifecycle state, require ref mutations and project deletion to coordinate with `library.lock`, and rescan/verify references while holding that lock immediately before deletion.
---

## Delta review 2: web-readiness design rule (section 12B)

Date: 2026-09-27, gpt-5.6-terra, same invocation, section 12B plus the milestones table inlined. Raw output:

1. **High — storage interface is too broad and mixes unrelated concerns.**  
   `list`, `link`, `delete`, and especially `lock` impose filesystem-shaped semantics that object storage/DB backends may not support safely or efficiently.  
   **Fix:** keep blob/document storage minimal; move locks to a `LeaseStore`/coordination boundary and import linking to an import-specific capability. Avoid general `list(prefix)` unless pagination and ordering semantics are specified.

2. **High — future multi-user isolation is absent from storage and job contracts.**  
   Logical keys such as `projects/<id>` have no ownership/tenant context. Retrofitting authorization into callers later risks cross-user reads, job control, or library metadata leakage.  
   **Fix:** add an opaque `Scope`/`ProjectContext` parameter now to project/job operations, with local mode using one default scope. Keep global, content-addressed blobs separate from scoped metadata and enforce ownership at the boundary.

3. **Medium — provider interface should not make providers resolve storage references.**  
   “Provider resolves through storage” couples an AI boundary to storage and makes testing, remote workers, and API-provider implementations unnecessarily dependent on library internals.  
   **Fix:** have analysis orchestration resolve `LibraryImageRef` into a provider-neutral `ModelImage` input (stream/bytes plus MIME type, optionally a temporary local-file capability). CLI adapters materialize a temporary path; API adapters consume the stream/bytes.

4. **High — jobs contract omits the information needed for a reliable UI and durable resumption.**  
   `status` has no defined progress, error, checkpoint, timestamps, result, or event/update model; `resume(jobId)` does not say whether it is idempotent or how inputs/settings are frozen. These become essential once server requests and workers are separated.  
   **Fix:** define a versioned persisted `JobRecord` now: immutable input snapshot, state, progress/checkpoint, attempt, timestamps, structured failure, and result. Make enqueue idempotent via a caller-provided key, and define cancel/resume state transitions.

5. **Medium — Milestone 1 migration scope is risky and its verification is too narrow.**  
   Moving settings, registry, library, refs, records, locks, and provider image handling behind storage in one approval-gated milestone is a large architectural migration; checking one gallery and the image/count cost assertion will miss integrity and atomicity regressions.  
   **Fix:** add migration tests for content hashes, interrupted atomic writes, concurrent imports/record updates, and backward-compatible loading. Consider deferring record locks to Milestone 2 alongside the job/lease implementation.

6. **Medium — lifecycle and retention rules are missing.**  
   Write-once content-addressed blobs plus `delete`/“Free up space” needs a defined reachability model. Otherwise a cleanup can remove an image still referenced by a record, job checkpoint, immutable approval, or another project.  
   **Fix:** specify reference ownership and an explicit mark-and-sweep/retention procedure; make deletion of blobs internal to that procedure, not a general feature-level operation.