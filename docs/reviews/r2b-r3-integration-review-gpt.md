# Review: R2b + R3 integration (gpt-5.6-sol)

Date: 2026-09-28. Reviewer: gpt-5.6-sol via `codex exec -s read-only --ephemeral` (cross-family).
Scope: only the integration, passed inline: (A) the conflict resolution of merging `feat/r3-report-builder` into master with `feat/r2b-summary`, in `src/view/gallery-html.ts` and `src/view/gallery-script.ts`; (B) the integration commit that makes R3's "What to research next" a numbered section of R2b's report (page, markdown, PDF).

## Findings (verbatim)

- **High — multi-country PDFs do not render the multi-country report or its trailing research section.** `src/view/report-print.ts:42`, `src/export/report-source.ts:154`
  `PrintPage` and `printRender` support only one `data` object and call `renderReport` once. Unlike the page/markdown paths, there is no `countries` rendering path and therefore nowhere to append one research block after all country reports. Extend the print model/source with `countries`, render each country block as `showReportVersion` does, then append `researchHtml` once after them.

- **Medium — versions without a saved list can incorrectly gain a numbered section 7 from live suggestions.** `src/view/report-suggest.ts:73`, `src/view/report-list.ts:168`
  `researchBody(null)` still returns the current `suggestView` list. Consequently, an older version that never kept `suggestions.json` gets "What to research next" inserted as numbered section 7, contrary to "when a version kept a list." Require `savedItems !== null` before returning a version section. If live-only suggestions should remain visible, show them separately and unnumbered.

- **Medium — a failed research snapshot can leave a listed but incomplete preset version.** `src/reports/version.ts:107`
  `addVersion` publishes the version before invoking `research()` and before writing `suggestions.json` or `report.md`. If the callback or either write fails, readers see a version with missing artifacts. Preserve the required "snapshot after listing" semantics with a pending/building marker and publish only after all files succeed, or roll back the newly added version on failure.

- **Low — the PDF test does not exercise the print renderer.** `test/pdf-export-reports.test.ts:134`
  It only checks serialized JSON in the HTML, so it cannot detect missing globals, incorrect placement, escaping failures, or the multi-country omission. Execute the embedded print script in a DOM/browser fixture and assert section order, numbering, and escaped content; add a multi-country case.

I did not find a direct XSS issue in the new page/PDF list rendering: suggestion fields pass through `esc()`.

## Outcome

- **High (multi-country PDF): not an integration regression; deferred.** Compare countries versions (`countries.json`) could not be exported to PDF on R3 either (`reportSource` needs `data` or `html`). Adding a multi-country print path is new feature work, not part of this merge. The research section is in the PDF of every one-country version (Pilot, Full check, One country).
- **Medium (live list numbered): fixed.** `showReportVersion` numbers the section only when the version kept its list (`research.items`); otherwise the live list is shown after the report, unnumbered, as R3 did. Page, markdown and PDF now agree for saved versions.
- **Medium (incomplete preset version): fixed.** `buildPresetVersion` writes `report.md` before the version is listed; after listing it takes the research snapshot and, when there is one, writes `suggestions.json` and rewrites `report.md` with section 7. A failure there leaves a complete version without the list.
- **Low (print renderer test): not done.** The numbered placement is tested on the shared renderer (`test/report-list-view.test.ts`), the markdown numbering in `test/report-builder-api.test.ts` and `test/pdf-export-reports.test.ts`, and the saved list reaching the print page in `test/pdf-export-reports.test.ts`.
