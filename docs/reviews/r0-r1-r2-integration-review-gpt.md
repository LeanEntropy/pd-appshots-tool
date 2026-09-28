# R0 + R1 + R2 integration: code review by gpt-5.6-sol

Date: 2026-09-28. Reviewer: gpt-5.6-sol via Codex CLI (cross-family, read-only, ~6 minute cap), on master at 792ad1f (after merging feat/r1-reports and feat/r2-pdf onto R0). The Codex sandbox cannot run git on this machine, so the integration diffs (the main-country fix e706907, the R2 merge against each parent) and the full export, print, report-list and reports-api files were passed inline.

## Review (verbatim)

## High

- None found.

## Medium

- `src/view/report-export.ts` — Browser-print fallback does not preserve the export-dialog choices. `pdfFallbackHtml()` stores only the report ID, so `printReportFallback()` prints the card’s current DOM state. “Without pictures” can therefore print pictures, and declining “also hide…” can still print with those sections hidden. It may also print a stale version if the selector changed while its asynchronous card reload was pending. Fix by retaining the chosen version/options with the fallback action and loading/rendering that exact version into a dedicated print container before calling `window.print()`.

- `src/export/report-source.ts` — The renderer stage is inferred as `core` only for `def.type === "core"`; every other report type becomes `pilot`. For `country` or `compare` reports this can make stale/missing-analysis messaging and approval actions target the wrong analysis stage. Fix by returning the actual source stage from `getReportVersion`/version metadata and passing that to `PrintPage.stage`, rather than deriving it from report type.

## Low

- `src/export/report-source.ts` — `parsePrintQuery()` treats every `images` value except `"0"` as true, so malformed values such as `images=nope` are silently accepted. Fix by validating `"0" | "1"` explicitly, while allowing absence for the settings default.

- Test coverage — There is no browser/client integration test confirming that each card exports its selected version, that report-prefixed hidden sections reach the print renderer, or that the fallback prints the selected version and dialog image choices. There is also no test for non-preset report stage propagation. Add focused tests for these paths.

## Fine

- Report and version request values are schema-validated and then checked against listed definitions/versions before storage paths are constructed; no request-controlled path traversal is apparent.
- Dynamic report names, facts, filenames, job IDs, and client-generated HTML values are escaped or constrained appropriately. The embedded print JSON escapes `<`, preventing script termination.
- Export mutation routes enforce the server token through `writeRequest`; job lookup is project-scoped. The GET print/status/file routes use read-only or unguessable job-reference behavior consistent with the surrounding read APIs.
- PDF defaults correctly come from `settingsOf(config).pdf`, with explicit dialog choices taking precedence.
- `mainMarketRef()` now uses `settingsOf(config).mainMarket`, providing the required single source of truth.
- Saved-version association is checked by `getReportVersion`, so a version belonging to another report is rejected.

## Outcome

- Medium 1 (fallback print ignores the dialog's choices and can print a stale version): fixed. With no Chrome or Edge, "Print or save as PDF" now opens the server's print page for exactly that report version, pictures choice and hidden sections (`report-print.html?report&version&images&hidden#autoprint`) in a new tab, which opens the print dialog once every picture has loaded. The per-card DOM printing and its CSS are gone.
- Medium 2 (stage of One country / Compare countries reports): not changed. Only the Pilot and the Full check can have versions in this milestone, and R1's own card rendering maps the report type to the renderer stage the same way. To revisit when the report builder adds those types.
- Low 1 (`images=nope` accepted): fixed. `parsePrintQuery` accepts only `0`, `1` or no value (the Settings default).
- Low 2 (tests): added a test that the fallback URL round-trips through `parsePrintQuery` to the same version and choices, that bad `images` values are refused, that absent ones take the Settings default, that each card has the Export PDF button calling `exportReportPdf({ report, version })`, and that the print page carries the report id and the autoprint hook. There is no browser test of the client.
