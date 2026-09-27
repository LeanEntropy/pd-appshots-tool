# Overview fold and recommendation label check: code review (gpt-5.6-sol)

Reviewer: gpt-5.6-sol via Codex CLI (read-only), 2026-09-28.

- **High — `recommendationProblems`: unknown keep references pass validation.** `if (keep && was && …)` skips checks when position N is absent or has no type, so “keep our current position 99” is accepted. **Fix:** report an error when `keep` matches but `ours.get(N)` is missing; do the same for recapture references if they must refer to an existing screenshot.

- **Medium — `buildReportData`: warning includes unrelated failures.** `recProblems` receives every `recommendationProblems` result, including deck length/gaps and missing marketing text, while the report claims all are label/spec mismatches. **Fix:** separate label/spec validation into its own function/result or classify/filter problems.

- **Medium — `loadOverview`: initial Build likely opens the overview too.** The same `rebuild` boolean controls both requesting generation and adding `open`; if the “Build the overview” button calls `loadOverview(true)`, a first build opens it despite “only right after a rebuild.” **Fix:** distinguish `build` from user-requested `rebuild`, and set `open` only for the latter.

- **Low — gallery test does not verify the conditional-open behavior.** Its negative regex only rejects a literal `open` tag and misses the dynamically concatenated `open` attribute. **Fix:** exercise `loadOverview(false/true)` and assert the rendered `<details>.open` state.

**Verdict:** Core checks are present, but missing-source validation and UI state/report-warning boundaries leave requirements incompletely enforced.
## Disposition (Claude, 2026-09-28)

| Finding | Decision |
|---|---|
| High: "keep our current position 99" passes | Fixed. A kept or recaptured position our deck does not have is now an error. Test added. |
| Medium: the report warning included unrelated problems (deck length, gaps) | Fixed. Label checks are their own function (`labelProblems`), and the report shows only those. |
| Medium: the first "Build the overview" opens it | Kept on purpose. The user pressed Build, so the result is shown. On every page load the overview starts folded. |
| Low: the fold test only checks the script text | Not changed. A full DOM test adds little here; the fold was also checked in the code path (`open` only after a build). |
