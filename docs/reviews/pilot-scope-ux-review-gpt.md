# Pilot scope and run UX: code review (gpt-5.6-sol)

Reviewer: gpt-5.6-sol via Codex CLI (read-only), 2026-09-28. Scope: the gallery diff for pilot-scope marking, the approval dialog, the live run panel and the folded store overview.

## High

- `src/view/gallery-grid.ts`, `rowCount()` and `renderGrid()`: the grid derives inclusion from `i.analysis` instead of the approved server plan’s `tier`. An image with an existing analysis can still be a `"layer-diff"` item requiring another AI call, but the grid counts and labels it as “already analysed, no AI.” Stale analyses can similarly be misclassified. This produces wrong counts and badges versus the server plan. Fetch/store the actual plan for the selected stage and render directly from its `items` and `excluded` entries.

- `src/view/gallery-run.ts`, `pollStatus()`: after reload, the stage selector is not synchronized with `lastStatus.stage` while a run is active, nor when loading an already-finished run. It is only updated in the `wasRunning === true` transition. A reloaded core run therefore leaves the selector on pilot, causing the grid and initially loaded report to show the wrong batch. Set the selector from `lastStatus.stage` on every successful status fetch before rendering/loading the report.

- `src/server/api.ts`, `getAnalysisStatus()`: the displayed batch is reconstructed from the latest saved plan for the job’s stage, not the specific plan that was approved. A later plan request for that stage can overwrite it, so reloads may show different images and estimates from the actual run. Persist the approved plan hash or an immutable batch snapshot in the job state and return that exact snapshot.

## Medium

- `src/view/gallery-analysis.ts`, `gameBlock()`: approval thumbnails are generated from all `p.items`, including `tier === "identical"`. The dialog therefore does not show “exactly the images to analyse”; no-AI images appear alongside them. Filter thumbnails to `tier !== "identical"` and list identical images separately as excluded/no-AI text if needed.

- `src/view/gallery-analysis.ts`, `gameBlock()`: excluded entries are associated with a game using `x.name === g.name`. Games with duplicate display names will receive each other’s exclusions, producing incorrect totals and reasons. Carry `appId` on excluded plan entries and join by `appId`.

- `src/view/gallery-run.ts`, `runState()`: failures are matched only by game name and position. Duplicate game names can mark the wrong image failed, and errors without a position cannot mark any image. Persist and expose `imageId` on per-image errors, then match by `imageId`.

- `src/view/gallery-analysis.ts`, `approvalDialog()`, and `src/view/gallery-html.ts`: the dialog uses `aria-labelledby="approvalTitle"`, but loading and error views contain no element with that ID. The modal consequently lacks an accessible name in those states. Give the dialog a permanent heading/`aria-label`, or include `id="approvalTitle"` in every rendered state.

## Low

- `src/view/gallery-run.ts`, `imageLine()`: during non-image phases it can report “all N images done, finding patterns…” under a heading beginning with “Running,” but when `total` is zero it reports “image 1 of 0.” Handle zero-image synthesis/report-only runs explicitly.

**Verdict:** Not ready—the grid and reload state can disagree with the approved server batch, and the approval dialog includes images that will not be analysed.
## Disposition (Claude, 2026-09-28)

| Finding | Decision |
|---|---|
| Grid uses the saved analysis instead of the plan tier | Not changed. The grid shows the core market, which is the English baseline, so a layer-diff tier cannot occur there. The grid and the plan use the same "usable analysis" test. Known gap: an image that is new but identical to one analysed elsewhere is badged "will analyse" in the grid, while the plan counts it as no-AI. The approval dialog is authoritative and shows the exact list. |
| Stage selector not synced on reload during a run | Fixed. While a run is active, the selector follows the running stage, and the report reloads. |
| Status batch rebuilt from the latest saved plan | Fixed. On approval, the server saves a snapshot to `pending/analysis-batch.json`. A status falls back to the saved plan only for runs started before this change. |
| Approval thumbnails include no-AI images | Fixed. Thumbnails show only the images sent to AI. Already-analysed images are listed as text. |
| Exclusions and failures matched by game name | Not changed. Game names are unique in the current configs. A proper fix needs `appId` on plan exclusions and `imageId` on run errors (analysis code, outside this change). |
| Dialog accessible name missing in the loading and error states | Fixed. The dialog now has a permanent `aria-label`. |
| "image 1 of 0" for runs with no images | Fixed. It now says "no new images" plus the current step. |
