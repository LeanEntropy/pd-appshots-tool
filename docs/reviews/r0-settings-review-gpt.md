# R0 Settings page: code review by gpt-5.6-sol

Date: 2026-09-28. Reviewer: gpt-5.6-sol via Codex CLI (cross-family), read-only, 8-minute limit.
Scope: branch `feat/r0-settings`, commit f2bcf32 against master 57b9a00 (milestone R0 of `docs/plan-reports.md`, section 5B).
The reviewer received the full diff, plan section 5B, the R0 milestone row and the relevant pillars inline (its sandbox could not read the repository), so it could not see code outside the diff.

## Outcome

| # | Finding | Decision |
|---|---|---|
| 1 | Family rule not enforced for screenshot and recommendation pairs | **Declined (already enforced).** The existing `ConfigSchema` rule checks `fullAnalysis`/`imageReview` and `recommend`/`recommendationReview` (unchanged lines outside the diff). Added direct `ConfigSchema` tests to prove it (`test/settings-rules.test.ts`). |
| 2 | Pattern wording and text-layer second-opinion switches do not control execution | **Fixed (wording).** Text-layer was already marked "not used yet"; the pattern wording note now says plainly that its own second opinion arrives with the reports update and that today the recommendations' second opinion checks the combined text. The switch is stored for the reports update (R2b/R3), which adds that call. |
| 3 | Screenshot switch cannot turn review on when `review.enabled` is false | **Fixed.** The switch now also writes `review.enabled: true`; test added. |
| 4 | Confirmation not bound to the numbers shown; `confirm: true` could skip the question | **Fixed.** The server returns a confirmation key (hash of the saved settings, the change and the consequences); only that key saves. A change in between (another tab) answers with the new numbers and "these numbers changed" and asks again. Tests added. |
| 5 | Astra not enforced by `ConfigSchema` for the older model fields | **Declined (already enforced).** The existing rule refuses Astra in every `models` role except `imageReviewSpecial`; tests added to prove it. |
| 6 | Pattern wording has no model control | **Declined.** By design one writer (the recommendations model) writes both today; the card says so. A separate model would be a setting that controls nothing. |
| 7 | Main-country change should keep old reports and create new ones (test) | **Declined for R0.** Report lists and versions are milestone R1 (built in parallel); R0 shows the consequence text. To be tested in R1 once reports carry their country. |

## Review as received
## Verdict

The page is broadly implemented, but I would not approve R0 yet. The main blockers are incomplete schema enforcement, switches that do not reliably control the advertised work, and confirmation that is not tied to the state whose cost was shown.

1. **High — `ConfigSchema` does not enforce the required reviewer-family rules for several AI steps**  
   **File:** `src/config/schema.ts`, `settingsRules()` around lines 194–245

   The family check covers `countryAdvice`, `conceptMap`, `abTests`, and `textLayer`, but not:

   - screenshot analysis: `fullAnalysis` versus `imageReview`
   - recommendations: `recommend` versus `recommendationReview`
   - pattern wording: also uses `recommend`/`recommendationReview`

   Consequently, a project override can load with same-family producer and reviewer models, even when the second opinion is enabled. The HTTP endpoint usually rejects this only because its select choices happen to separate families; that is not the required `ConfigSchema` protection and does not protect imported or externally created `project.json` files.

   The “same-family reviewer” test is therefore misleading: it exercises choice-list rejection rather than the cross-field schema rule.

   **Suggested fix:** validate every producer/reviewer pair in `ConfigSchema`, preferably independently of whether the switch is currently enabled, and add direct `ConfigSchema.safeParse()` tests for screenshot and recommendation pairs.

2. **High — Pattern wording and text-layer second-opinion switches are saved but do not control execution**  
   **Files:**  
   `src/settings/fields.ts`, around lines 123–139  
   `src/settings/access.ts`, around lines 43–66  
   `src/analysis/job.ts`, around lines 54–60  
   `src/analysis/estimate.ts`, around lines 94–118

   `review.patterns` and `review.textLayer` appear as functional switches, but the execution changes only consult `recommendations`. In particular, the single recommendation reviewer is instantiated solely from:

   ```ts
   secondOpinionOn(config, "recommendations")
   ```

   and the estimate’s recommendation check uses the same switch. Turning pattern wording on while recommendations are off therefore changes neither the estimate nor the job.

   Text-layer comparison similarly gained a stored switch and accessor entry, but no shown execution path consumes it. Unlike the explicitly future country-report steps, pattern wording is described as part of the current recommendation flow.

   **Suggested fix:** define how shared pattern/recommendation review is scheduled—likely review when either relevant switch is on, or split the review stages—and wire the text-layer switch into its actual planner/job. Add execution and estimate tests, not just save/reload tests.

3. **High — The screenshot switch cannot turn review on when `review.enabled` is false**  
   **Files:**  
   `src/settings/access.ts`, lines 35–42  
   `src/settings/fields.ts`, lines 104–122

   `secondOpinionOn()` treats `review.enabled` as an invisible master switch. The UI switch only writes `coreCoverage` and `expansionCoverage`. For a valid existing project with `review.enabled: false`, selecting “On” saves coverage `1`, but the page reloads as off and the reviewer remains disabled.

   This violates the requirement that the displayed per-step switch controls the second opinion and creates a valid override that cannot be corrected through the Settings page.

   **Suggested fix:** remove the hidden master from per-step resolution, or have enabling the screenshot switch also set `review.enabled: true`. Migration behavior for old projects with `review.enabled: false` should be covered by a test.

4. **Medium — Cost confirmation is not bound to the settings version or consequence that was shown**  
   **File:** `src/server/routes-settings.ts`, `postAnalysisSettings()` around lines 80–117

   The first request computes consequences, but the confirmation request merely repeats the field/value with `confirm: true`. Another tab or another field save can occur between those requests. The server then recomputes against the newer project and saves without showing any newly changed count or cost.

   A client can also send `confirm: true` initially and bypass the consequence display altogether. The token prevents cross-site writes, but it does not solve this stale-confirmation problem.

   **Suggested fix:** return a confirmation token containing a hash of the current project settings plus the proposed change/consequences. Require that token on confirmation and reject it if the settings have changed, asking the page to show the recalculated consequences.

5. **Medium — Astra and other model restrictions are not actually enforced by `ConfigSchema` for legacy model fields**  
   **File:** `src/config/schema.ts`, around lines 202–221

   Astra is rejected only for `options.models`. It remains schema-valid in fields such as `models.imageReview` and `models.recommendationReview`. The Settings endpoint rejects it later through the UI choice list, but direct project overrides can still load it.

   This contradicts the requirement that these restrictions be enforced by the existing schema on every load/save. It also means the Astra refusal test does not prove the stated schema rule.

   **Suggested fix:** encode allowed roles explicitly in `ConfigSchema`: Astra only in the specifically permitted special-review role, and rejected everywhere else. Test raw project/config parsing in addition to the route.

6. **Medium — Pattern wording has no model control despite being listed as a separate AI step**  
   **Files:**  
   `src/settings/fields.ts`, around lines 123–139  
   `src/view/settings-script.ts`, around lines 43–54

   The Pattern wording card gets only a second-opinion switch. Its model is hidden under Recommendations, with a note saying both use the recommendations model. Section 5B requires each listed AI step to show its model and second-opinion setting.

   Even if sharing one stored model is deliberate, the Pattern wording card should expose that model or clearly present a linked/shared control so the page satisfies the per-step requirement.

   **Suggested fix:** render the shared model control for both steps with an explicit “shared with Recommendations” explanation, or introduce distinct model fields if independent selection is intended.

7. **Low — Required main-country report behavior is not tested**  
   **File:** `test/settings.test.ts`

   The tests verify the consequence message and resolver, but not the required behavior that:

   - existing Pilot and Full check reports remain listed with their original country;
   - new Pilot and Full check reports are created for the new main country.

   This is specifically called out in section 5B.3 and is vulnerable to regressions in report identity/naming even if `mainMarket()` itself is correct.

   **Suggested fix:** create existing US Pilot/Full artifacts, change the main country, run the new plans, and assert both old US and new Japan reports remain separately addressable and correctly named.
