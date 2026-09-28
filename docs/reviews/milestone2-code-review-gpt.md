# Milestone 2 code review (gpt-5.6-sol)

Date: 2026-09-28. Reviewer: gpt-5.6-sol via Codex CLI (`codex exec -m gpt-5.6-sol -s read-only --skip-git-repo-check --ephemeral`), cross-family. Input: the milestone 2 scope and plan sections 5.1, 5.3, 6.1, 6.2, 7, 12A (A3, A4, A6) and 12B (B3), plus the key files inlined: `src/jobs/*`, `src/analysis/attempts.ts`, `run-images.ts`, `run.ts`, `job.ts`, `expansion.ts`, `src/projects/state.ts`, `src/server/{api-analysis,app-context,app-server,routes-project,routes-home,static,instance,http-util}.ts`, `src/steps/analyze.ts`, `src/storage/leases.ts`.

## Outcome

10 findings: 6 fixed, 3 declined, 1 "no finding" (server security).

| # | Finding | Outcome | What was done / why |
|---|---|---|---|
| 1 | The same approval can start a second paid batch after the first job ended | Fixed | Each job records the approval it used (plan fingerprint plus the time the screen was shown). A repeated or replayed request for the same approval is refused ("This approval was used already"); a new look at the approval screen is needed. Test added |
| 2 | Loss of a record lock is ignored; the old holder could overwrite another job's result | Fixed | After the model call and before any write, every record lease is renewed; if one was taken over, nothing is written and the batch stops with a plain message |
| 3 | Same-project rule is check-then-acquire (race with a store job) | Fixed | The AI lane lock is taken first, then the store lane is checked while holding it (released on refusal). The store job of milestone 4 must do the mirror check after taking its own lock (noted in the code) |
| 4 | Budget check only tests "left > 0", not whether the next call fits | Declined | Every model call already gets `maxBudgetUsd = min(per-call cap, what is left)` (existing `call.ts`), which the Claude CLI enforces, and calls stop when less than $0.01 is left. Reserving a worst-case amount per call would stop batches early for no real safety gain. GPT (second opinion) is paused and has no dollar budget flag |
| 5 | Attempt closed as finished before the record is saved | Fixed | Attempts are now closed only after their record is saved; a crash in between leaves the attempt "started", counted at its estimate on the Continue screen |
| 6 | Derived state lacks the downloading stage; a stale preview counts as current | Declined (this stage) | Store checks and downloads run from the page only in milestone 4, which adds the downloading stage and preview freshness with the store-check journal |
| 7 | Single-instance check could reuse an old server that lost the lock | Fixed | The recorded server is reused only if its nonce equals the current lock holder's nonce and it answers health with the same nonce. Test added (second start hands back the running server) |
| 8 | Old `/api/report?stage=` redirects to a route that does not exist | Fixed | `/p/<id>/api/report` answers like the current report endpoint |
| 9 | Project creation, Play lookup/search, countries, settings and download routes missing | Declined (scope) | These belong to milestones 3 (wizard, lookup, countries, settings) and 4 (store check, download) in the approved plan; milestone 2 has a "New project" placeholder |
| 10 | Security: host, origin, token, JSON-only, body cap, project-id and static traversal | No finding | |

All tests (125), `npm run typecheck` and `npm run lint` pass after the fixes.

## Raw review

1. **High — `src/jobs/runner.ts`, `enqueueAnalysis`**  
   Idempotency is enforced only against the in-memory `running` map. After a stopped, failed, interrupted, or completed process disappears from that map, submitting the same approved `planHash` without `continueBatch` creates a new batch with a fresh spending limit. A duplicated/replayed `/analysis/run` request can therefore pay for the same approval twice.  
   **Fix:** Before acquiring the AI lock, search the journal for a job/batch with the same idempotency key. Return the existing job if running/finished, and require the explicit continuation path for stopped/failed jobs. Persist a unique mapping from approval fingerprint to job/batch and update it atomically.

2. **High — `src/analysis/run-images.ts`, `analyseImages`**  
   Loss of a record lease is ignored. The heartbeat callback discards `Lease.heartbeat()`’s false result, and ownership is not rechecked before `endAttempt` or `d.save`. After sleep/event-loop starvation permits takeover, the old process can finish its paid call and overwrite records while another process makes the same paid call.  
   **Fix:** Track heartbeat failure, check record-lock ownership immediately before the call and again before every attempt/record write, and discard/stop safely if ownership was lost. Ideally expose a nonce-check method on `Lease`.

3. **High — `src/jobs/runner.ts`, `enqueueAnalysis`**  
   The same-project lane exclusion is a TOCTOU race: it reads `store.lock`, then separately acquires `ai.lock`. A store job can acquire its lock between those operations, allowing analysis and download in the same project. Symmetric “check then acquire” logic would allow both contenders to pass simultaneously.  
   **Fix:** Make lane acquisition atomically enforce the opposite-lane rule, such as acquiring both locks in a fixed order and releasing the unused lane only after registration, or using a per-project job lock held for either lane.

4. **High — `src/analysis/run-images.ts`, `analyseImages`; `src/analysis/run.ts`, `runAnalysis`**  
   Budget gating checks only `budgetLeft() <= 0`, not whether the next paid call’s maximum/approved estimate fits in the remaining budget. A chunk can start with a few cents left and spend beyond the batch limit; synthesis is also entered without reserving/checking its estimated cost. This violates the requirement to check the remaining batch budget before each paid call.  
   **Fix:** Before every provider invocation, refuse unless its conservative maximum cost is within the remaining batch budget. Apply this separately to producer, reviewer, adjudicator, writer, and recommendation-review calls.

5. **Medium — `src/analysis/run-images.ts`, `analyseImages`**  
   Attempts are marked finished before their records are durably saved. A crash after `endAttempt(..., "finished")` but before `d.save()` leaves paid spend recorded but no reusable result, so Continue pays again. This exceeds the stated known-loss window because the response has already arrived and could have been made durable.  
   **Fix:** While holding the record lock, save the result first and then close the attempt, or atomically persist the record and attempt transition in one storage operation/journal.

6. **Medium — `src/projects/state.ts`, `ProjectStage` and `projectState`**  
   The derived state omits `downloading` entirely and ignores store-check/download jobs. It also treats any `pending/download-plan.json` as a current preview without verifying its settings fingerprint. Consequently the home/landing state can report Setup or Ready to download while a download is running/stopped, or expose a stale preview.  
   **Fix:** Add the required downloading stage and derive preview/downloading substates from the journal/checkpoint and approved plan. Validate preview freshness against current settings before selecting `preview`.

7. **Medium — `src/server/instance.ts`, `runningServer` / `startToolServer`**  
   When lock acquisition fails, the health check validates `server.json` against the responding server but never verifies that `server.json.nonce` equals the currently held lock’s nonce. During stale-lock recovery/startup, a second launcher can accept an old still-answering server that no longer owns `server.lock`.  
   **Fix:** Pass the observed lock holder into `runningServer` and require `server.json.nonce === heldBy.nonce` as well as the health response nonce match.

8. **Medium — `src/server/routes-project.ts`, `GETS`; `src/server/app-server.ts`, `isOldPath`**  
   The required legacy `/api/report?stage=` redirect becomes `/p/:id/api/report?stage=`, but that destination is not registered—only `/api/report/current` and `/api/report/run` exist. Thus a required inventoried route redirects to a 404.  
   **Fix:** Implement `/p/:id/api/report` with the former contract, or translate the old URL to the appropriate supported report endpoint.

9. **Medium — `src/server/app-server.ts` and `src/server/routes-project.ts`, route tables**  
   Several milestone-2 endpoints are absent: project creation, play lookup/search, countries, project settings GET/PUT, and the documented per-project download/store-check routes. PUT is not handled at all. This leaves the projects home/import/workspace flow incomplete relative to the approved route inventory.  
   **Fix:** Add the specified routes with the same host/origin/token/body protections, including token-protected PUT handling, or explicitly move them out of this milestone and update the approved scope.

10. **Low — security review: `app-context.ts`, `app-server.ts`, `http-util.ts`, `static.ts`**  
    **No finding** for project-ID traversal, static-file traversal, executable HTML/JS/SVG serving, local-host enforcement, same-origin checks, write tokens, JSON-only writes, or the 64-KB request cap in the shown paths.
