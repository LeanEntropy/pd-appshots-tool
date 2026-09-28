# R1 reports: code review (gpt-5.6-sol)

## Summary

Bottom line: R1 is not ready to merge because generation dates can disagree, home status can combine two different versions, and required stale-data explanations are incomplete.  
The storage boundary, write authentication, ID-to-listed-report checks, and report-only deletion guard are sound.  
Migration is non-destructive in the normal path, but its reconciliation logic has an idempotency gap.  
Several authoritative R1 tests—especially UI action outcomes and the full migration dry run—are still missing.

## Findings

1. **Major — `src/reports/version.ts:69`, `src/reports/migrate.ts:69`, `src/reports/store.ts:132` — Finished runs get two different generation dates.**

   `recordPresetRun()` calls `syncPresetReports()` before writing `version.json`. Since the run folder already exists, migration registers it using the timestamp parsed from the run ID. The subsequent `addVersion()` sees the same ID and returns without updating the entry, while `version.json.generatedAt` contains a later `new Date()` value.

   The list and version API therefore show the run-ID time, while the report’s immutable inputs contain the completion time. This violates the requirement that the generation date from `version.json` is shown consistently, and makes behavior depend on this write ordering.

   Fix by constructing and writing `version.json` before reconciliation, then registering the version from that immutable value. Reconciliation should also repair a def entry’s metadata from `version.json` when the same version ID is already present, without changing the version folder itself.

2. **Major — `src/reports/ready.ts:25-39` — The home line can combine readiness from one version with the verdict from another.**

   `ready` is true if any run has `recommendations.json`, but `verdict` and `score` are read from the newest folder containing `report-data.json`, whether or not that version has recommendations.

   After a completed Full check followed by a newer partial or failed Full check, the home card can say `Full check done: <new partial verdict>` because readiness came from the older completed version and the verdict came from the newer incomplete one.

   Select one coherent outcome: the newest Full check version that itself has recommendations, and read readiness, verdict, and score from that same version. Prefer the report def/version list rather than independently scanning every matching folder.

3. **Major — `src/reports/list.ts:47-68` — The “Newer data” implementation does not provide the required change-specific reasons.**

   Only main-country, pick, and taxonomy changes receive specific messages. All analysis, image, record-version, and order-snapshot changes collapse to “New or updated analyses…”, and the required “a Full check is now available” reason for a Pilot is absent.

   Section 4.2 explicitly requires plain explanations such as analysis counts and the page/date that changed. A generic result prevents users from deciding whether regeneration is worthwhile.

   Persist/compare structured fingerprint components, not just `dataHash`, and return distinct reasons for record additions/updates, order snapshots, pick, taxonomy, main country, and Pilot-to-Full-check availability. Add a test for every required reason.

4. **Major — `src/reports/list.ts:46`, `src/reports/list.ts:133-149` — Card descriptions do not consistently come from the report version’s own inputs.**

   Countries are always derived from `ReportDef.scope`. Only competitor names are taken from `version.json` or saved report data. Thus a saved version can be labelled with the current def’s countries rather than the scope with which that version was generated.

   This contradicts the later feedback requiring the description line—type, country, competitors, and generation date—to come from the report’s own inputs. It is especially visible after a main-country or scope change.

   Build the summary description from the newest version’s `version.json.scope` and `pick`, falling back to saved report data and then the def only for legacy versions that lack those fields.

5. **Minor — `src/reports/migrate.ts:73-87` — Reconciliation does not restore D3 archiving unless it discovers a missing version.**

   `saveDef()` and the “all but newest archived” normalization run only when `add` contains new folders. If an interrupted or older implementation left every run already listed but with incorrect `archived` flags, subsequent migrations return without correcting them.

   The migration is therefore not fully convergent/idempotent with respect to its promised final state.

   For every preset def, always compute the canonical sorted version set and archived flags, then write the def only when that canonical value differs. Add an interrupted fixture where all version IDs are present but the archive flags are wrong.

6. **Minor — `src/view/report-list.ts:216-226` — Archive and delete success feedback is removed before it can be shown.**

   Both actions call `loadReport()` inside `run`, which rebuilds the report-list DOM before `act()` applies its `done` message. Archiving hides the card; deleting removes it. Consequently the success status target is detached or absent.

   Busy feedback exists, but the required visible success feedback does not reliably survive the action.

   Have the mutation finish first, show success in a persistent Report-tab status/live region, and then refresh the list; alternatively let `act()` complete before refreshing. Add fake-DOM tests asserting busy, success, and error states remain visible for rename, archive/restore, and delete.

7. **Minor — tests required by R1 are incomplete.**

   The added tests cover basic storage, API authorization, migration fallback, folded markup, and duplicate element IDs, but do not cover several explicit section 9 requirements:

   - every stale-reason change kind;
   - UI busy → success and busy → error behavior;
   - lazy loading proving folded cards make no version request;
   - independent interaction with two simultaneously open reports, beyond static ID comparison;
   - the Rogue Legends copy/dry-run with all existing runs, approval numbers, `planHash`, and byte-for-byte hashes;
   - migration recovery when all versions are listed but archive flags are incomplete;
   - the `writeFinalReport()`/list-upkeep ordering and generation-date consistency.

   Add these tests before treating the R1 checkpoint as complete.

## Checked and fine

- PATCH and DELETE require the page token.
- Request report IDs are syntax-checked and resolved through listed report definitions before use.
- Version IDs must belong to the selected report; request values are not directly converted into storage paths.
- Pilot and Full check deletion is refused.
- The storage deletion capability accepts only report defs and custom-report version-folder keys, excluding Pilot/Core runs, freshness pointers, library records, and broad directories.
- Migration does not move or rewrite existing run, pending, state, or latest-pointer files in the covered path.
- Malformed and partial saved report data fall back to markdown instead of crashing.
- Cards are folded initially and version content is requested only when a card opens.
- Rendered report section IDs are report-prefixed, avoiding the tested static ID collisions.
- New production files remain under the 300-line limit, and filesystem deletion stays behind the storage interface.
## Outcome (applied by the implementer, Claude Opus, 2026-09-28)

| # | Finding | Outcome |
|---|---|---|
| 1 | Two generation dates for a finished run | Fixed: `version.json` is written before the list upkeep, and the upkeep takes each version's date from its `version.json`, repairing a def entry that differs. Test: the list date equals the `version.json` date. |
| 2 | Home line mixes the ready version with a newer partial one | Fixed: readiness, verdict and score come from one version (the newest with recommendations, else the complete latest run). Test: a newer partial Full check does not change the home line. |
| 3 | "Newer data" reasons too generic | Partly fixed: versions with a `version.json` now get specific reasons (main country, pick with names, screen-type list, "N new or updated analyses", "<game>'s store page changed on <date>"), in the new `src/reports/stale.ts`, with a test per reason. Declined for R1: specific reasons for the migrated runs (they have no `version.json`, so only the fingerprint comparison of `latest-*.json` exists, which is what plan 7 prescribes), and "a Full check is now available" (only for reports built on the Pilot alone, which arrive with the builder in R3). |
| 4 | Card description from the def, not the version | Fixed: countries and competitors come from the newest version's `version.json`, then its saved report data, then the current pick. |
| 5 | Archive flags not repaired when no version is missing | Fixed: every preset def converges to its canonical versions (dates, order, all but the newest archived), written only when different. Test: an interrupted def with all versions listed but no archive flags is repaired. |
| 6 | Archive/delete success message lost when the list redraws | Fixed: those two actions report on the Report tab's own status line, which survives the redraw (the toast was already shown). |
| 7 | Missing tests | Added: generation-date consistency, archive-flag repair, every stale reason, coherent home outcome. The Rogue Legends dry run is run on a copy of the real workspace by a one-off script (the data is not in the repository): 8 runs listed and opened, "Now" identical to the old report endpoint, the same pilot and core `planHash` and counts, 984 files byte-for-byte unchanged. Declined: fake-DOM tests of lazy loading and two interactive open cards (the fake DOM has no `<details>` toggle events; ids per report and the act() wiring are tested). |
