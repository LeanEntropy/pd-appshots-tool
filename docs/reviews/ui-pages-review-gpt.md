# Gallery pages and report rebuild: code review (gpt-5.6-sol)

Reviewer: gpt-5.6-sol via Codex CLI (read-only), 2026-09-28. Scope: tabbed gallery pages, one report model for the page and the markdown, the pattern check, the title-screen remap, the interactive (i) popover.

- **High — `src/analysis/report-data.ts`, `buildReportData`:** Position tables use `coreDeck(...)` manifests loaded at report time, while patterns, coverage, and hashes use the saved plan’s image IDs. After a store refresh, the report can pair old analysis with new screenshots/order. Build rows from `plan.items`/saved snapshots; use current manifests only for an explicitly identified proposed batch.

- **High — `src/analysis/record-refresh.ts`, `mapTitleScreen`:** When an existing title capture is framed or occupies part of an image, the function preserves its region but overwrites the composition to `single_full_capture` and `captureAreaPercent` to `100`. This creates internally contradictory and inaccurate records. Only synthesize a full-frame capture for `pure_art`; otherwise retain composition, captures, and aggregate area while remapping the relevant subtype.

- **Medium — `src/analysis/report-md.ts`, `reportMarkdown`; `src/view/gallery-report-parts.ts`, `fitHtml`:** Stale AI interpretation summaries are displayed without a stale label because both read `d.ai.interpretation` without checking `d.ai.current`. The Overview correctly performs this check. Gate these summaries on `ai.current`, or visibly label them as belonging to the older run.

- **Medium — `src/view/gallery-report.ts`, `loadReport` and the `stage` change handler:** If a saved run is selected and the batch stage changes, `loadReport()` requests that old run ID under the new stage, receives 404, and renders it as an “older format” report with an empty body. Reset `reportRun` to `"current"` before loading after a stage change, and handle non-OK responses before the legacy-report branch.

- **Medium — `src/analysis/pattern-fit.ts`, marketing-layer colour block:** The generated strength is forced to exactly `0.5` whenever the sum of the top colour shares reaches 50%, so even a colour used by every competitor can only be a partial pattern. Summing shares also double-counts colours occurring together. Compute per-game or per-image union prevalence for the proposed colour set and pass that actual share to `add()`.

- **Medium — `src/analysis/report-data.ts`, `buildReportData`:** The new taxonomy remap is not applied while constructing current reports; `reportInputs()` merely calls `readRecords()`. Existing usable records can therefore continue appearing with the old title-image classification until the separate refresh command or another write happens. Apply the versioned deterministic refresh during record loading/report input preparation, or make stale mapping versions invalidate/refresh records automatically.

- **Low — `src/analysis/report-md.ts`, `reportMarkdown`; `src/view/gallery-report-parts.ts`, `positionsHtml`:** Both derive the final row number from `g.rows.length`, not the greatest stored `position`. A deck with missing/non-contiguous slots silently omits later positions. Iterate the sorted union of actual position values, or use `Math.max(...rows.map(r => r.position))`.

**Verdict:** Request changes; the current/saved-deck mismatch and title-screen remap can make the report deterministically show incorrect data.

## Disposition (Claude, 2026-09-28)

| Finding | Decision |
|---|---|
| High: position rows from the current deck, analyses from the saved plan | Fixed. Each analysed position now uses the plan's own image id; the deck only supplies the rest of the order (excluded tablet images). |
| High: the title remap overwrote the composition of a framed title capture | Fixed. A title capture the model already saw keeps its composition, area and framing; only the subtype changes. A full-frame capture is created only for pure art. |
| Medium: an out-of-date AI summary shown without a label | Fixed, in both the page and the markdown ("From run X, written from older analyses"). The overview wording is used only when it names the computed verdict and has the same number of key points. |
| Medium: an earlier run stays selected after a batch change (404 shown as an older-format report) | Fixed. Changing the batch resets the selector to the current report, and a missing run shows its error. |
| Medium: layer-colour strength forced to 0.5 and double counting | Fixed. The share is now the fraction of competitor layers that use one of the top colours, each image counted once. |
| Medium: the new mapping is not applied until records are rewritten | Fixed. Report inputs apply the current mapping in memory (no AI). `npm run refresh-records` was also run on the workspace: Rogue Legend #1 and Archero 2 #1 became in-game title screens. |
| Low: row count from the number of rows, not the highest position | Fixed in both renderers. |

Also changed after the review:
- A position where competitors tie (one game each) is no longer reported as a pattern.
- The pattern-check version is part of the batch fingerprint, so a logic change asks for new AI wording.
