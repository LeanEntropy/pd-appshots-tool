# UI feedback and art-screen wording: code review (gpt-5.6-sol)

Reviewer: gpt-5.6-sol via Codex CLI (read-only), 2026-09-28. Scope: commits e04bb86 (every button and action gives immediate feedback; import progress) and bd1d19a (never claim an art screen is not from the game), base 378e227. The Codex sandbox blocks local commands on this machine, so the reviewer got the full diff and the key files as input.

## Findings (as returned)

- **High — `src/library/import/run-import.ts`, `runImport`**  
  The import now yields after checking `runningAnalysis()` while the legacy analyser explicitly holds no lock. A legacy analysis can therefore start during linking, hashing, record writing, or snapshot generation and mutate the source data used by the import. Previously, the event-loop blockage incidentally closed this same-process race. The final snapshot gate may detect some changes, but it does not make copying a concurrently changing inventory safe or guarantee every mutation is represented in the gate.  
  **Fix:** introduce an import-in-progress gate that the legacy analysis-start endpoint checks atomically, set it before inventorying, and keep it through the switch/rollback. Also re-check `runningAnalysis()` immediately before each source-reading phase and before switching; ideally take the inventory only after acquiring that exclusion.

- **Medium — `src/view/home-script.ts`, `followImport`**  
  Polling loops forever when `/api/import` succeeds but returns `importing: null`. This happens if the server restarts because import state is only module memory, including after the filesystem switch has completed. The page then remains permanently busy with no success or error.  
  **Fix:** treat a missing import state as terminal: reload projects/import candidates and infer completion from the project registry, otherwise throw a readable “import status was lost after server restart” error. Persisting the import status alongside the journal would be more robust.

- **Medium — `src/analysis/art-wording.ts`, `artWording` / `RULES`**  
  The display migration does not enforce the wording rule for arbitrary existing AI text. Equivalent claims such as “not an in-game screenshot,” “does not show gameplay,” “without a gameplay screenshot,” “zero gameplay captures,” or “only promotional art, rather than a game screen” pass unchanged and can still appear in popovers and reports. The tests cover only the hand-picked phrases already handled by the implementation.  
  **Fix:** expand normalization to sentence-level variants and add adversarial tests for negation, “without,” “zero,” “rather than,” and “not an in-game…” forms. Apply a final forbidden-claim check to every display payload and replace any matching sentence with neutral visible-content wording.

- **Medium — `src/view/action.ts`, delegated button-link click handler**  
  Button-styled links (`Open`, `New project`, and other `.btn` links) show “Opening…” but are not actually guarded against double clicks. Anchors have no disabled state, and the handler neither checks `aria-busy` nor prevents a second navigation.  
  **Fix:** when an anchor is already `aria-busy="true"`, call `preventDefault()` and return; on the first click also set a stable action key or temporarily remove pointer interaction.

- **Medium — `src/library/import/run-import.ts`, `runImport`; `src/library/import/steps.ts`, `writeFacts`/`writeRecords`; `src/library/import/survey.ts`, `inventory`**  
  Several potentially long synchronous phases only publish a step name, not measurable progress: inventory creation, both snapshots, image-fact writes, record writes, and the final comparison. With a large project these can exceed one second while presenting an indefinite spinner, contrary to the real-progress requirement. `writeFacts` and `writeRecords` also do not yield, so the server can again become unresponsive during those phases.  
  **Fix:** make these phases batched/async, yield between bounded batches, and report `done/total` counts for each collection being scanned or written.

- **Low — `src/view/home-script.ts`, `loadImport`**  
  Failures loading `/api/import` are silently swallowed. The import area can remain empty or stale with no visible reason, violating the “never silent” requirement for restoring/following import state.  
  **Fix:** render a red error in the import area with `actReason(e)` and provide an explicit retry action.

- **Low — `src/view/home-script.ts`, Show archived handler**  
  “Show archived” is the named control least consistently covered by the reusable helper. It changes the view immediately, but provides no explicit success/status announcement and has no `aria-expanded` state, so assistive-technology users receive weak feedback.  
  **Fix:** update `aria-expanded` and a live status message such as “Archived projects shown/hidden,” preferably through a small synchronous mode supported by `act()`.

**Verdict:** Not ready: the yielding import introduces a high-severity concurrency hole, and feedback/wording guarantees still have concrete gaps.
## Outcome

- **High, legacy analysis during the import:** partly fixed. The import now checks again, just before it switches the project over, that no old-tool analysis started meanwhile (it rolls back if one did). Not added: an in-process gate. In this server a project that is not imported yet cannot run an analysis at all, and an old-tool analysis in another process was never blocked by the event loop; the before/after gate still catches changed records.
- **Medium, import status lost after a restart:** fixed. The page stops waiting, reloads the project list and says the progress was lost.
- **Medium, wording variants:** fixed for the listed forms ("not an in-game screenshot", "without a gameplay screenshot", "zero gameplay captures", "rather than a game screen"), with tests. The real project's popovers and reports were checked read-only: no forbidden phrase left.
- **Medium, double clicks on button-styled links:** fixed (a second click while "Opening..." is ignored).
- **Medium, counts for the short import steps:** declined. Hashing and linking (the 35 s) report counts and yield; the other steps are shorter (not measured on the real project) and show their step name while they run.
- **Low, silent failure loading the import offer:** fixed (red message with the reason).
- **Low, Show archived:** fixed (aria-expanded and aria-controls); the list itself is the immediate feedback.
