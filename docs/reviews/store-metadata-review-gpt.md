# Code review: store text and derived keywords (gpt-5.6-sol, 2026-09-28)

Reviewed: commit 99b5f01 (feat(store-text)), against docs/plan-store-metadata.md.

## Outcome

| # | Severity | Finding | Decision |
|---|---|---|---|
| 1 | High | The report shows no store text | Partly applied: the report tables now show the title and short description per game and country. The full description stays in the library (and its keywords are in the table); printing every full description in every country would swamp the report. |
| 2 | Medium | Backfill ignored storage failures | Fixed: counted as failures, the command exits with an error and asks to run again. Test added. |
| 3 | Medium | A damaged snapshot counted as saved, so it was never read again | Fixed: "saved" now means a snapshot that loads and validates. Test added. |
| 4 | Medium | Block HTML tags glued words together | Fixed: p, div, li, headings and similar become line breaks. Test added. |
| 5 | Low | Weak snapshot validation | Fixed: Zod schema for the saved snapshot; damaged keywords are derived again. Test added. |

## Reviewer output

1. **High — `src/analysis/report-store-md.ts:19`, `src/view/gallery-store.ts:43`, `src/analysis/store-compare.ts:19`** — The “Store text and keywords” report does not show or compare the store text. It only renders category, tags, derived keywords, and date. `StoreTextView` omits the full description entirely, while title and short description are only shown in the grid popover. This does not meet the requirement to report title, short description, and full description per country. Add all three fields to the report model and render them—preferably in expandable per-game sections to keep the table manageable—with every value escaped.

2. **Medium — `src/steps/store-text.ts:131`** — Backfill storage failures are discarded. `saveListingTexts()` returns `{ saved, failed }`, but the loop only adds `.saved`; consequently the final message reports zero failures and the CLI exits successfully even when nothing could be persisted. Capture both values:
   ```ts
   const saved = saveListingTexts(storage, [l], o.log);
   result.saved += saved.saved;
   result.failed += saved.failed;
   ```
   Add a test using a `Storage` whose `putJson` throws, asserting a nonzero failure count and retry message.

3. **Medium — `src/library/store-text.ts:75`** — `hasStoreText()` treats any correctly named JSON file as a saved page without reading or validating it. A truncated, corrupt, or schema-invalid snapshot therefore causes backfill to skip that page forever, even though `latestStoreText()` cannot load it. Implement `hasStoreText()` in terms of a successfully validated snapshot, or share validation/loading logic with `latestStoreText()`. Add a backfill test containing a corrupt dated file.

4. **Medium — `src/play/store-text.ts:44`** — `cleanText()` removes most HTML tags without inserting separators. Common descriptions such as `<p>First</p><p>Second</p>` become `FirstSecond`; list items and headings are similarly concatenated. This corrupts the stored official text and can generate derived phrases that never appeared on the page. Convert block-closing/opening tags (`p`, `div`, `li`, headings, etc.) to line breaks before stripping markup, then normalize whitespace. Test paragraph and list markup as well as `<br>`.

5. **Low — `src/library/store-text.ts:84`** — Snapshot validation is too weak for its consumers. A file with `appId`, `date`, and `official.chips`, but missing `official.genre` or containing a malformed `derived` object with the current version, passes `valid()` and can crash `view()` or keyword rendering. Validate the complete persisted shape, ideally with a Zod schema; only reuse current-version derived keywords when `keywords` is a valid array. Add malformed-current-version snapshot tests.
