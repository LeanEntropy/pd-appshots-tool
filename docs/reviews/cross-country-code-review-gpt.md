# Code review: country reports from a comparison, groups across countries (C1, C2, C4a)

Reviewer: gpt-5.6-sol (Codex CLI, read-only, diff passed inline). Date: 2026-09-29. Branch: feat/cross-country.

## Findings as returned

- **Major — `src/reports/group-findings.ts`**: `gameValue()` removes unknown page values before evaluating the group. A game that is “yes” in one country and unknown in another becomes “yes,” inflating `b` and potentially producing a statistically unsupported group finding. **Fix:** return `unknown` or `mixed` whenever any distinct page required for the group is unknown; count “yes” only when every distinct page is known and yes.

- **Major — `src/reports/derived-relations.ts`**: `readDerived()` silently replaces an invalid/truncated `reports/derived.json` with an empty registry. This loses `suppressed` state, so merely listing reports can recreate country reports the user explicitly deleted. Deleting first and calling `suppressChild()` afterward creates a similar crash window. **Fix:** use an atomic write/backup and treat an unreadable registry as an error; persist suppression before deleting the child, with rollback/recovery semantics.

- **Major — `src/reports/derive-country.ts`, `src/reports/derive-ab.ts`**: the projection does not enforce “drop any kept text naming another compared country.” Only banners, advice, some missing messages, and parent A/B tests are checked. Kept `c.data` text, localisation rows/habits, terminology, and country-owned A/B tests can still name other countries. **Fix:** recursively project every retained user-visible text field, dropping the containing item and recording its field-specific reason.

- **Major — `src/reports/groups.ts`, `src/server/reports-groups-api.ts`**: “All compared countries” disappears whenever the user saves custom groups because `effectiveGroups()` completely replaces suggestions. Validation also accepts duplicate codes such as `["jp","jp"]`, allowing a nominal two-country group containing only one country. **Fix:** canonicalize/deduplicate countries, require two distinct compared countries, and always prepend or preserve a canonical all-countries group outside the four editable groups.

- **Major — `src/reports/group-md.ts`**: the markdown/PDF path does not contain the C4a artifacts. It emits only “Sketch … shown on the page” and omits both the SVG and evidence thumbnails, while the PDF is generated from this markdown. **Fix:** embed a safely rendered schematic and the evidence images in the generated report content, or give PDF generation the same structured group data used by the interactive UI.

- **Major — `src/reports/groups-part.ts`**: the five-finding cap is applied separately to every group, while `ours` and `common` findings are uncapped. A report can therefore show well over five findings. **Fix:** rank and cap the final displayed findings globally, while retaining below-threshold/omitted dimensions as explanatory “not a pattern” lines.

- **Minor — `src/reports/group-dims.ts`**: `captureShare()` converts an unparseable capture string to zero, which classifies it as a very large marketing layer. It also uses `< 80`, although “marketing layer 20% or more” includes exactly 80% screenshot coverage. Landscape additionally counts excluded/not-analysed rows as positive evidence. **Fix:** return `null` when any required percentage cannot be parsed, use `<= 80`, and derive landscape only from analysed rows, returning unknown when none are analysed.

- **Minor — `src/reports/derive-ab.ts`**: `textFits()` does not reliably enforce the target script. For example, an English listing accepts mixed Japanese-and-ASCII text because English has no foreign-script rejection rule. **Fix:** perform Unicode-script validation for all supported listing languages and reject letters outside the allowed script set, apart from explicitly permitted shared characters.

## Outcome

| # | Finding | Outcome |
|---|---|---|
| 1 | A game yes in one country and unknown in another counted as yes | **Applied**: any page not analysed makes the game unknown in that group (test added) |
| 2 | Broken derived.json loses suppression; delete then suppress has a crash window | **Applied**: an unreadable file makes nothing by itself (only the user's "Make country reports now" rebuilds it); suppression is saved before the delete (test added) |
| 3 | Kept report data, localisation, words and country code tests not name-checked | **Declined**: those parts are computed per country by code from that country's own pages; only AI prose spans countries, and it is checked (advice, banners, missing parts, the comparison's A/B tests, which are now also dropped when their text names another country) |
| 4 | "All compared countries" disappears with saved groups; duplicate codes | **Applied**: always kept next to the user's groups; countries de-duplicated; 2 distinct countries required (tests added) |
| 5 | PDF (markdown) lacks sketches and thumbnails | **Declined for now**: the PDF uses the existing basic print path (low priority by the pillars); the markdown says the sketch is on the page |
| 6 | Five-finding cap per group, not global | **Declined**: the approved plan (3.4 rule 7, D6) caps findings per group; our-page facts are not competitor findings |
| 7 | Unparseable capture share read as a large layer; landscape from rows not analysed | **Partly applied**: unparseable share is unknown (test added). Landscape stays measured from pixels for every image (pillar: pixel facts are computed for every image) |
| 8 | Latin-script listings accept CJK text | **Applied**: Latin-script listings refuse CJK, Hangul and Thai letters in new text (test added) |