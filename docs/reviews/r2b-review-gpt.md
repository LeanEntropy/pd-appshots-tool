# R2b code review (gpt-5.6-sol, cross-family)

Date: 2026-09-28. Reviewer: gpt-5.6-sol via Codex CLI (read-only; the diff of feat/r2b-summary against master, plan-reports 3B, 3B.3, 3C and the R2b row, and the PILLARS rules were given inline, because the Windows sandbox blocks the reviewer's own reads). Commit reviewed: b72c100.

## Findings (as returned)

1. **High** — `src/reports/scope-plan.ts:160-215`  
   Country/compare scopes do not add the main country to `markets`, decks, or inputs when it is unticked. They merely read it as a possible anchor. This omits required reference screenshots/analyses, undercounts cost, and can produce a comparison without the main-country baseline.  
   Fix: include the main market as a required reference slice for every foreign country/compare scope, while keeping it visually distinct from selected report countries.

2. **High** — `src/view/report-builder.ts:129-136`  
   Builder autosave does not happen for incomplete choices. For example, ticking one country in a Compare report, or ticking a competitor before a country, hits `scopeProblem()` and returns before `ensureDraft()`. Closing the page loses those choices.  
   Fix: support incomplete draft scopes server-side, or create a draft immediately and persist partial builder state separately; recompute only once the scope becomes valid.

3. **High** — `src/reports/eligibility.ts:29`  
   A Ready Full check is treated as if a Ready Pilot exists: `const pilot = core || ...`. This opens all report types even when there is no Ready Pilot with recommendations, contrary to D1.  
   Fix: set `pilotReady` solely from the Pilot outcome; do not substitute Core readiness.

4. **High** — `src/reports/scope-plan.ts:264`, `src/reports/build.ts:144-153`, `src/view/report-builder-review.ts:35-39`  
   `instant` means only “zero new images.” It ignores the non-cached text AI listed in `costOf()`. Consequently, an expansion can show a nonzero AI cost, exceed the spending limit, yet offer “Build report” and build without approval. This violates the “instant only when all AI is cached” and spending-limit rules.  
   Fix: require zero image work *and* cached required text work for `instant`; reject over-limit builds and require approval for any uncached AI work.

5. **Medium** — `src/server/reports-builder-api.ts:38-76`  
   `leftOut` is schema-shaped but never validated against the selected scope: arbitrary app IDs, countries outside the selected markets, duplicates, and chart/named-game mismatches are accepted. This violates the requirement to validate every ID and scope at the API boundary.  
   Fix: require each exclusion to refer to a selected non-ours game and selected market, reject duplicates, and reject exclusions for presets.

6. **Medium** — `src/server/reports-builder-api.ts:127-132, 145-157`  
   Eligibility is enforced for draft creation and build, but not for planning or saving a scope. A caller can obtain and persist country/compare scopes before the Pilot is Ready. The plan requires one shared eligibility rule used by the builder and API.  
   Fix: apply `eligibilityProblem()` in `postPlan`, `saveScope`, and relevant read/plan endpoints for non-Pilot types.

7. **Medium** — `src/view/report-builder-review.ts:15-18`  
   `t.label` is inserted into `needsHtml()` without `esc()`. Labels include market labels and can originate from project data, making this an HTML injection path.  
   Fix: escape `t.label` before passing it to `row()`; apply the same rule to every server-derived string interpolated into page HTML.

8. **Medium** — `src/reports/match-check.ts:67-128`, `src/view/report-builder-review.ts:41`  
   The perceptual-match accuracy check is optional and only exposed through a button for non-preset reports with layer-diff work. It neither runs nor blocks the first paid layer-diff approval. The milestone requires the check before the first paid run, with doubtful matches shown.  
   Fix: run/check this before opening a paid approval containing layer comparisons, show outstanding doubtful pairs there, and require their resolution or conservatively tier them as full.

9. **Low** — `src/reports/scope-cost.ts:142-166`  
   Drop ordering uses `competitorRank + marketRank`, which is not priority order by competitor then country. A higher-priority competitor in a later country can be dropped before a lower-priority competitor in an earlier country.  
   Fix: sort lexicographically by competitor priority descending, then country priority descending.

10. **Low** — `src/reports/suggest-signals.ts:120-124`  
    “Older data” for localisation suggestions is based on deck `fetchedAt`, not the required `orders/` snapshot dates. This can mark current order evidence as stale, or stale order evidence as current.  
    Fix: use `latestOrderDate()` / the saved order snapshots and the specified 30-day threshold.

Plan deviations:

- Main-country reference data is not fully planned or pinned for foreign-country reports.
- Draft choices are not reliably autosaved on every tick.
- The Pilot-only eligibility gate can be bypassed by an existing Full check.
- “Build report” is offered despite uncached AI work and can bypass the expansion spending limit.
- The early perceptual-hash accuracy check is not enforced before paid work.
## Outcome

| # | Severity | Outcome |
|---|---|---|
| 1 | High | Fixed. Each variant image now declares what differs from our image (screen, text, composition); the check allows only the test's one variable (an order test changes nothing inside an image; a text test only text; a composition test only composition; a one-screenshot test only its one image). Orientation is compared by code with our measured orientation. Free-text specs cannot be compared word by word; that part stays declared. |
| 2 | High | Fixed. Order evidence is now n of all competitor decks (the share the pattern uses), not n of n. |
| 3 | High | Fixed. Every targeted country and position pair must be covered by one cited gap, for both variants. |
| 4 | Medium | Fixed. A second variant in a low-traffic country is a problem (repaired by the model, else the test is left out). |
| 5 | Medium | Declined, deliberate. The variant length range includes our own deck length: a one-screenshot test keeps our deck length, so with our 7 screenshots against competitors' 5 to 6 every such test would fail. The deck length is its own gap and gets its own test (one variable per test). |
| 6 | Medium | Fixed. Never more tests than gaps (the extra ones are listed as left out). |
| 7 | Medium | Fixed. Install clicks are always the primary metric; pre-registration clicks are only offered in addition for a game in pre-registration. |
| 8 | Medium | Declined, not a real issue. The tool's markdown renderer (src/view/md-html.ts) escapes all HTML, the page and PDF escape every value with esc(), and the existing recommendations markdown already works this way. |
| 9 | Medium | Fixed. Left-out reasons name the gap by its statement and the country by its name; gap ids are removed from every AI text field shown (titles, hypotheses, variant texts, impact). |
| 10 | Medium | Fixed. AI parts whose prompt versions cannot be found count as older style. |
| 11 | Medium | Deferred, by plan. Localisation, per-country and terminology gaps need the country reports (milestone R4); R2b covers the Pilot and the Full check, one country. |
| 12 | Low | Deferred. More than five languages cannot happen in one-country reports; it matters for R4. |
| 13 | Low | Deferred, by plan. Country advice arrives in R4 and will include the voice block. |
| 14 | Low | Fixed with 6: the retry is asked for at most min(5, gaps) tests. |