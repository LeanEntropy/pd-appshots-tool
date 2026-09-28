# Review: plan-reports.md (gpt-5.6-terra, cross-family)

Date: 2026-09-28. Reviewer: gpt-5.6-terra via Codex CLI (read-only, ephemeral). Input: docs/plan-reports.md (including section 5A), memory/PILLARS.md, docs/report-requirements-user-2026-09-28.md, the user's requirements, and a summary of the relevant code. Processing: see "Review outcome" in docs/plan-reports.md.

## Findings (verbatim)

1. **High — §§2.3, 4: Partial/failed runs produce no usable report.** The plan builds a version only after the AI batch finishes, but the requirements say deterministic report content must always be available even when AI synthesis is missing.  
   **Fix:** create an immutable “partial” version from the frozen snapshot before AI starts (or upon Stop/Failure), containing order tables, pixel facts, patterns, and clear missing-AI states; create a new immutable ready version after AI completes.

2. **High — §§2.1–2.4: A tier can escalate from layer-diff to full analysis after approval.** The risk section says a layer-diff can discover a different screen and turn into full analysis “in the next approval,” but execution behavior and job state are not specified. An automatic full call would violate approval-before-any-AI rules.  
   **Fix:** make tier escalation a hard paused state: save the diff result, show the newly required full-image list/count/cost, and require a separate approval before any full analysis proceeds.

3. **High — §§2.3, 3.5, 11/R4: Total approved cost omits or ambiguously handles country-advice review.** Country-advice calls and optional cross-family reviews are AI work, yet D6 makes review behavior unresolved and the displayed total does not clearly include its count, model, range, or approval.  
   **Fix:** include every planned AI call—image full, layer diff, country advice, synthesis, and review—in one frozen approval ledger with model, input count, cost range, and maximum authorized spend. If review is enabled later, require another approval.

4. **High — §§2.2–2.3: The $30 expansion budget is not defined as an enforceable authorization ceiling.** Estimates are ranges, while actual calls can differ; “over the limit” only addresses pre-plan scope reduction. The runner needs a runtime rule when accumulated actual/reserved cost reaches the approved ceiling.  
   **Fix:** reserve worst-case cost before dispatching each call, stop before exceeding the approved cap, persist the remaining scope, and propose lowest-priority country/competitor combinations for a new approval.

5. **High — §§2.1, 4.1–4.2: Snapshot freezing is underspecified.** “Frozen approved plan” and later `version.json` are mentioned, but the plan does not require the job to pin exact deck/order snapshot IDs, image hashes, source analysis-record versions, and prompt/schema versions before work begins. Store or analysis changes during a job could otherwise mix data generations.  
   **Fix:** make the approved plan itself a complete immutable input manifest; the job and resulting version must read only those pinned objects. Mark newer data separately rather than incorporating it mid-run.

6. **High — §2.4: Layer-diff cache identity is incomplete.** Keying a layer diff by country-image hash, English-image hash, and pipeline key does not necessarily invalidate it if the selected English analysis record, detected regions, or source-reading version changes. That risks assembling a country reading from incompatible source facts.  
   **Fix:** include the exact English analysis record key/version, region/crop algorithm version, crop-content hashes, prompt and schema versions in the layer-diff input key and provenance.

7. **Medium — §§1.1, 1.3, 4: Pilot/Core definitions conflict with immutable report semantics.** Pilot and Core scopes are “derived … at build time” from the current pick, while reports are expected to represent named, historical analyses. A changed project pick can silently change what “Regenerate Full check” means.  
   **Fix:** preserve the current preset behavior only for creating a new version, but label it clearly as “regenerate using current core pick”; retain the resolved original pick/scope in every old version and show pick changes as a stale reason before approval.

8. **Medium — §§2.2, 3: Dropping country/competitor combinations can invalidate comparison meaning.** A multi-country report may silently become an uneven matrix beyond genuine “not sold” cases, making cross-country competitor shares and recommendations incomparable.  
   **Fix:** treat budget omissions as explicit scope exclusions in the report definition, prominently show them in the overview and every affected table, and either require a minimum comparable competitor set per country or suppress cross-country aggregate claims where it is not met.

9. **Medium — §§5A.1–5A.4: The coverage-map state model loses important information.** “In a report” is presented as a mutually exclusive cell state even though a deck can be partly analysed and used in a report. This makes coverage and recommendation ranking misleading.  
   **Fix:** model analysis coverage and report usage as independent attributes: e.g. `Partly analysed (5/8) · used in 2 reports`, with state colors based on coverage and a separate usage badge.

10. **Medium — §5A: Suggestions can be based on stale or non-comparable evidence.** Weak-pattern suggestions use the latest Full check without requiring it to be current, while localization scoring uses byte-identical-to-US rates that do not distinguish benign asset reuse from meaningful marketing-layer change.  
    **Fix:** prioritize/require refresh when the Full check or relevant store snapshots are stale, label stale-derived suggestions, and compute localization opportunity from the planner’s deterministic hash/pHash classification rather than only `reusedFromUs`.

11. **Medium — §§6.2–6.3: The PDF browser-launch decision needs a Windows feasibility spike.** `playwright-core` does not bundle a browser; relying on channel discovery for installed Chrome/Edge is environment-sensitive. Bookmark/outline support also varies by Chromium/Playwright version.  
    **Fix:** make R2 begin with a real Windows smoke test that discovers executable paths, launches both Chrome and Edge where applicable, produces a PDF, and verifies links/outline. Define explicit executable discovery and a tested fallback if either feature is unavailable.

12. **Medium — §§6.3–6.4: Export contents are coupled to transient UI folding/image state.** “With pictures” can still omit images hidden in the currently open card, despite the requirement that folded report sections print expanded. This can yield unintentionally incomplete exports and non-reproducible PDFs.  
    **Fix:** default exports to all sections expanded and all images included; offer explicit “respect current image visibility” only as an advanced option, and include that choice plus renderer/stylesheet version in the export cache key.

13. **Medium — §7: Migration verification is too narrow for safety.** The dry run checks run count, current content, and pilot/core approval numbers, but not read-only behavior for legacy folders, malformed/partial historical runs, idempotence after interruption, or preservation of `latest-*` behavior after migration.  
    **Fix:** add fixture cases for partial old runs, missing JSON, repeated/interrupted migration, and assert byte-for-byte unchanged legacy files plus unchanged existing API/current-report results.

14. **Medium — §9: Tests miss approval and recovery boundaries.** There are no explicit tests for mid-run tier escalation, runtime budget exhaustion, snapshot changes during execution, country-advice/review cost inclusion, or partial-report rendering after cancellation/failure.  
    **Fix:** add job-level fixtures covering each boundary, asserting no provider call occurs without the applicable approval and that resumptions consume only frozen inputs.

15. **Low — §12/D1 and R3: A material workflow decision remains unresolved.** The plan both implements “country reports only after Full check” and leaves that as a user decision; R3 also builds a US country report before paid country work, which makes the intended gate less clear.  
    **Fix:** resolve D1 before implementation and encode the chosen eligibility rule in builder validation, suggestion actions, and tests.

Overall verdict: the plan is strong on report structure, reuse, migration intent, deterministic suggestions, and the general PDF comparison, but it is not implementation-ready until it tightens approval/budget enforcement, freezes data provenance at job start, guarantees useful partial reports, and proves the Windows headless-PDF path.
## Second review: additions 3A (terminology) and 3B (voice, A/B tests), 2026-09-28 (verbatim)

1. **Critical — 3B.2 A/B tests:** The stated Play Console metrics are incorrect (“first-time installers / retained first-time installers”). Use its actual targets: **Unique user install clicks** or **Unique user open clicks**; require the model to choose only from supported metrics. [Google Play guidance](https://support.google.com/googleplay/android-developer/answer/12053285)

2. **Critical — 3B.2 / risks:** “Countries to run it in” is not directly executable: localized experiments target languages, while country-specific assets require the relevant custom store listing and eligible targeting. Add a deterministic listing-target resolver; validate each test against an actual listing ID, language/audience eligibility, and that every target country is covered. [Google Play guidance](https://support.google.com/googleplay/android-developer/answer/12053285)

3. **High — 3A.2 mapping cache/versioning:** `library/terms/<hl>/<term hash>.json` is insufficiently keyed. A mapping depends on the normalized term, language, concept-list version, mapping prompt/schema/model, and likely candidate context. Include all in the cache key/provenance and in report freshness/fingerprints; otherwise a changed concept list can silently reuse obsolete mappings.

4. **High — 3A.2 term discovery:** Mapping only top derived keywords plus layer words used by at least two games misses the most important divergence: a term used only by our game or one competitor. Build deterministic raw token/phrase frequencies from all stated fields, map a bounded but explicit candidate set that includes every term used by our game and competitor-common terms, and disclose any omitted terms.

5. **High — 3A.2 counting:** Substring matching for Japanese/Chinese/Thai and unrestricted Korean word-prefix matching will overcount terms embedded in unrelated words (and Korean compounds such as `전투력`). Use segment-aware matching where available, longest-match/non-overlap rules, and a Korean particle-suffix allowlist; test false-positive fixtures.

6. **Medium — 3A.3 output/decision rules:** “Most common” and “we differ” lack a precise denominator and multi-term rule. Define eligible competitors as those with usable source text for that country; count “games using term” separately from occurrences; specify how a game using multiple variants is displayed and how its representative term is chosen. This makes `n of m`, ties, and recommendations reproducible.

7. **High — 3B.2 validation:** Citation validation proves an evidence ID exists, but not that it supports the test in its proposed countries or assets. Require each target country/position/claim to be covered by the cited evidence, and reject aggregated evidence when it does not apply to every proposed target.

8. **Medium — 3B.2 experiment design:** The plan permits a full-deck rewrite while presenting a single causal hypothesis. Add a deterministic `testUnit` (one screenshot, screenshot set/order, text, or listing), selected assets, and rationale; default to one changed asset/set unless the stated hypothesis is explicitly a package test. Play Console itself recommends isolating one asset where possible. [Google Play guidance](https://support.google.com/googleplay/android-developer/answer/12053285)

9. **Medium — R2b / tests:** The milestone says “one text-only run per report,” but regeneration actually needs several independently cached synthesis calls (patterns, recommendations, optional review, A/B tests). State the call inventory and cost range explicitly, and test that a voice-only regeneration does not accidentally schedule image calls while still rerunning every required stale text artifact.

Verdict: The additions have the right architecture—deterministic evidence first, cheap text-only AI second, and no image-cache invalidation—but 3A needs stronger lexical/version semantics and 3B needs Play-Console-executable targeting and metrics. Resolve those before approval; they are correctness issues, not implementation polish.