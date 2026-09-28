# R3 code review (report builder and suggested next research), gpt-5.6-terra

Date: 2026-09-28. Branch `feat/r3-report-builder`, reviewed at aab43aa (diff against master).
Reviewer: gpt-5.6-terra through Codex CLI (read-only). Its sandbox could not run commands, so it
got the full diff, the plan excerpts (plan-reports sections 1-2.2, 5, 5A, 7, 11) and the
PILLARS rules on stdin.

## Findings and outcome

| # | Sev. | Finding | Outcome |
|---|---|---|---|
| 1 | High | Country and Compare scopes do not plan the whole main-country deck as a reference | Declined. Plan 2.1 (D2) plans a main-country image only as an anchor: used when analysed, added as a full analysis when not. Identical, same-picture and different are decided by hash against the main deck (read by code), which needs no analysis of the rest of that deck. |
| 2 | High | Incomplete choices (one country in a comparison, a competitor before a country) were not autosaved | Fixed. Drafts can be saved incomplete (the server checks every value, not the count). They show "Draft: tick at least two countries to compare" and have no numbers, and building one is refused. |
| 3 | High | A Ready Full check opens every type even without a Ready Pilot | Declined. A Full check is the Pilot's superset (same main country, the whole pick). The existing project-state rule already counts a Full check as completing the Pilot. |
| 4 | High | "Build report" is offered while the text-only AI is not cached, which bypasses approval and the limit | Declined for R3. The build never calls AI. It writes only the parts computed from the analyses, and the written advice is marked as coming with the next update (plan row R3: "no AI yet ... builds instantly when nothing is needed"). The text-only AI steps and their approval arrive with R4, where the instant rule must include the cached text. |
| 5 | Medium | `leftOut` was not checked against the scope | Fixed. Each exclusion must be a picked game (never ours) in a picked country, with no duplicates; otherwise 400. Tested. |
| 6 | Medium | Eligibility was not enforced on plan and save | Fixed. `POST reports/plan` and scope saves apply the same `eligibilityProblem` (409). Tested. |
| 7 | Medium | `t.label` inserted without `esc()` in the needs box | Declined: a false positive. `row()` escapes its label. |
| 8 | Medium | The picture-match check does not block the first paid text comparison | Deferred to R4. R3 has no paid run. The check is free and available in the builder, and a pair marked different is analysed in full. R4's approval of text comparisons must list the doubtful pairs still unresolved. |
| 9 | Low | Drop order uses competitor rank + country rank, not a strict order | Declined. "Competitor order x country order" (plan 2.2, PILLARS) is met by the combined rank. It drops the last competitors in the last countries first and mixes them as the plan's own example does ("Mini Tales in Taiwan, Heroll in Thailand"). |
| 10 | Low | "Older data" used the deck fetch time instead of the saved store orders | Fixed. It now uses the date of the newest saved store order. |
