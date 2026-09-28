# Plan: several reports per project, with PDF export

Date: 2026-09-28. Status: **draft for user approval** (reviewed by gpt-5.6-terra, findings applied). No code yet.
Authority: `memory/PILLARS.md`. The report format in `docs/report-requirements-user-2026-09-28.md` applies to every report type. Builds on `docs/plan-project-setup.md` (approved: storage, jobs, shared library, expansion increments, 12C "Report only" share), `docs/ui-pages-plan.md` (report data model and Report page) and `docs/analysis-requirements-user-2026-09-27.md`.
Review: gpt-5.6-terra (cross-family), see "Review outcome" at the end.

## 0. Summary

- **A project holds many reports.** Four types: **Pilot**, **Full check** (the core check), **One country** and **Compare countries**. Each has a name, its countries, its competitors, and the date of the store data and analyses it was built from.
- **One builder, "New report".** The user picks the type, ticks countries and competitors, and names it. The builder immediately shows what the report needs: which images are analysed already (free), which only need their text compared with the English image (cheap), and which need a full analysis. It lists the exact images, the count per kind and the cost, and waits for approval. **A report that needs no new AI is built instantly.**
- **Country reports are the expansion step.** There is one mechanism, not two: the expansion question after the core check ("more English competitors and/or other countries") opens the builder prefilled. The saved expansion choices become report drafts. The `countries`/`competitors` increments in the job journal keep their role as the approval and spend record of a report's AI batch.
- **Compare countries** gives, per country, our deck against the competitors' decks (the position table for that country); across countries, how each game localises (pictures, order, text, colours, genre wording), computed by code first and completed by the cheap text-layer comparisons; where our localisation differs from the competitors'; and recommendations per country.
- **Saved reports are immutable versions.** Each build writes a new version with its inputs, data and markdown. When the data changes, the report shows a **"Newer data"** badge and a Regenerate button (free when no new AI is needed). Reports can be archived or deleted. Reports never copy analyses; they point at the shared library.
- **Report tab:** a list of all reports, each folded, with name, type, countries, date, status and the newer-data badge. Open one to read it. Actions per report: **Export PDF**, **Regenerate**, **Rename**, **Archive**, **Delete**.
- **PDF export (decision):** a print stylesheet shared by all output, plus **server-side PDF by `playwright-core` driving the Chrome or Edge already installed on the computer** (`page.pdf`, with background colours, clickable contents and PDF bookmarks). It runs as a job with progress. The browser's own "Save as PDF" stays available as a fallback when no Chrome or Edge is found.
- **Suggested next research** (section 5A): a free, code-only panel with a coverage map (every game by country) and ranked suggestions of what to research next (value divided by cost). Each opens the builder prefilled; nothing runs without approval. Shown at the end of every report, in the Report tab and on the home card.
- **Migration:** the existing pilot runs and the core-check run become two listed reports, "Pilot (United States, English)" and "Full check (United States, English)", with every earlier run as an earlier version. No file is moved or rewritten.

## 1. Report types and the "New report" builder

### 1.1 Types

| Type | Plain name in the UI | Countries | Competitors | AI it can need | Cap and budget rule |
|---|---|---|---|---|---|
| `pilot` | Pilot | United States (English), fixed | the first picked competitors (as today), fixed | full analyses in English | core cap (100 hard, aim ~85), counted in the core |
| `core` | Full check | United States (English), fixed | the whole core pick, fixed | full analyses in English | core cap, counted in the core |
| `country` | One country | one country (radio), any of the project's countries, including the United States | ticked from the project's list (named competitors; chart games in a folded group, off by default) | full analyses; text-layer comparisons for non-English countries | expansion: no fixed image cap; spending limit per build (default $30, adjustable) |
| `compare` | Compare countries | two or more countries (checkboxes). The United States (English) is always used as the reference for "what changed", whether ticked or not | ticked, as above | as above | as above |

- "More English competitors" (the first expansion kind) is a **One country** report for the United States with extra competitors ticked. It does not change the core pick or the Full check.
- Pilot and Full check are **presets**: their countries and competitors come from the project's pick, as today, so the approved pilot/core flow and the core cap stay exactly as they are.
- One country and Compare countries are available **once the Full check has a report with recommendations** (the expanding circle: core first). Before that, their cards are shown greyed with the reason: "Available after the full check, because country advice builds on it." See decision D1.

### 1.2 The builder (one panel in the Report tab)

```
New report
 What kind?  ( ) Pilot   ( ) Full check   ( ) One country   (o) Compare countries

 Countries                                    Competitors (from this project)
  [x] Japan (Japanese)                          [x] Capybara Go        in all 3
  [x] South Korea (Korean)                      [x] Archero 2          in all 3
  [x] Taiwan (Traditional Chinese)              [x] Survivor.io        not sold in Taiwan
  [ ] Hong Kong  [ ] Thailand  ...              [ ] Mini Tales         in Japan only
  United States (English) is used as the        > Chart games (not ticked by default)
  reference for what changed.
                                               Our game: Rogue Legends (always included)
 Name  [ Japan, South Korea, Taiwan vs 3 competitors ]   (suggested, editable)
 Data  Store pages from 27 Sep 2026 (per game below). Analyses as of now.

 What this report needs                                      updated as you tick
  Already analysed or identical to the English image (free):   61
  Same picture, new text: compare the text layer ($0.03-0.06 each): 38
  Different picture: full analysis ($0.15-0.25 each):             9
  Country advice (text only): 3 countries                   $0.40-0.90
  Total about $2.30 to $4.60 (limit $30)       [Show the 47 images]
                                   [Build report]  or  [Review and approve]
```

- **Autosave:** the builder's choices are saved as a draft report as soon as anything is ticked (PILLARS: every choice is saved by the tool). Closing the page keeps the draft; it appears in the list as "Draft".
- **Availability per country:** a competitor that is not sold in a ticked country is shown with "not sold in Taiwan" and is included only where it exists. The report shows "not sold here" in that country's table. Deck availability comes from the existing deck manifests (`status: "ok"`).
- **Name:** suggested by code from the type, countries and competitor count ("Japan, South Korea, Taiwan vs 3 competitors"); editable; unique per project (a number is added on collision).
- **Data snapshot:** the builder shows the store-order date per game and country (from `orders/`), and "analyses as of now". The saved version records exactly which order snapshots and which analysis records it used (section 4).
- **Immediate feedback** on every tick: the "What this report needs" box shows "Working out what is needed…" while the plan is recomputed (debounced; typically well under a second, because it is code only), then the new numbers.
- **"Build report"** appears only when the report needs no AI at all; it builds instantly (a short job with "Building the report…", then the report opens unfolded in the list).
- **"Review and approve"** opens the existing approval dialog (highlighted, scrolled into view, focused), which lists **exactly** the images to send, per game and country, as thumbnails marked by kind (full analysis or text comparison), with counts and cost. Nothing is sent before the user approves.

### 1.3 Scope model (code)

```ts
ReportScope = {
  type: "pilot" | "core" | "country" | "compare",
  markets: { gl: string; hl: string }[],        // pilot/core: the core market
  competitors: string[],                          // app ids, in priority order
  includeCharts: string[],                        // chart app ids the user ticked (usually none)
}
```

- Validated with Zod at the API boundary against the project's own markets and competitor list (unknown values are refused with "Reload the page").
- Pilot and core scopes are **derived** from the pick when a new version is built (`fitFor(loaded)`), so they behave as today. Every version stores the resolved pick and scope it used. When the pick has changed since the latest version, the list shows "Newer data: the pick changed" and Regenerate says "Regenerate with your current pick (Capybara Go added, Heroll removed)" before anything is built or approved.
- **Eligibility** (decision D1) is enforced in one function used by the builder, the API, the suggestions (5A) and the tests, not only by greyed buttons.

## 2. What a report needs vs what exists

### 2.1 One planner for all report types

`buildAnalysisPlan(loaded, stage)` (`src/analysis/plan.ts`) is generalised to `buildScopePlan(loaded, scope)`:

- For every game in the scope and every market in the scope (plus the English reference market for `compare` and non-English `country` reports), take the phone deck (`analysedSlots`) of that country, and turn each position into a `TierInput` with that market's `gl`/`hl`. The existing `assignTiers` then decides the tier, cheapest first:
  1. **Identical (free):** the same image (content hash) already has a usable analysis in the shared library, or appears earlier in this plan. This covers the common case of a competitor using the same image in several countries.
  2. **Text layer only (cheap):** a non-English image whose picture is near-identical (perceptual hash) to an analysed English image of the same game. Only the cropped band and text regions plus the English analysis are sent.
  3. **Full (strong model):** everything else.
- **English anchors when they save money.** If a game's picture appears in several non-English countries but its English image is not analysed yet (a competitor outside the core), the planner compares: (a) a full analysis of each country's image, or (b) one full analysis of the English image plus a text comparison per country. It picks the cheaper and shows the English image in the list with the reason "analysed once in English, so the other countries only need their text compared".
- `pilot` and `core` call the same function with their preset scope; their output is identical to today's plan (same `planHash`), which a test proves.
- The plan also estimates the **text-only AI** the report needs (pattern wording and recommendations for pilot/core as today; country advice for country and compare reports, section 3.4), using the existing `estimate()`.
- A report is **"instant"** when the plan has 0 new images and all its AI text is cached for this exact input (the synthesis calls are cached by full input already, `objects/`). Then "Build report" is offered.

### 2.2 Scale rules

- **Core cap** (100 hard stop, aim ~85): applies to Pilot and Full check only, exactly as today (`withinCap`, `coreTotal`).
- **Expansions** (One country, Compare countries): no fixed image cap (user's choice), but each build has a spending limit (default $30 from settings, adjustable in the approval dialog).
- **Over the limit:** the builder proposes dropping the lowest-priority combinations first (competitor order x country order, as PILLARS says), shows which would be dropped ("Leave out: Mini Tales in Taiwan, Heroll in Thailand, saves $4.10"), and applies it only when the user clicks "Leave these out". It never drops silently.
  - Left-out combinations are saved in the report's scope as **explicit exclusions** ("left out to stay within the limit"), distinct from "not sold here". They are shown in the overview and in every affected table.
  - Cross-country figures (shares of competitors who localise, "our localisation vs theirs") are computed only over competitors present in every compared country; if fewer than 2 remain, the report says so instead of giving the figure. Per-country sections still use all competitors of that country.
- **The limit is enforced while running, not only estimated:** the existing runner already checks the batch budget before each call. For report batches it reserves the worst-case cost of the next call before sending it, stops before the approved limit would be passed, keeps everything finished, and saves the remaining work. Continuing needs a new approval with the remaining images and cost (the existing Continue panel).
- **Chart games** are shown in the builder but never ticked by default and never analysed unless the user ticks them.
- **Count and approval before every step:** the approval dialog shows the count per tier and per country, the exact images, and the cost range; the run shows "Comparing text, image 5 of 38" and "Analysing image 3 of 9".

### 2.3 Running the AI part

- The report's AI batch is an ordinary job through the jobs module (`enqueue`, `status`, `resume`, `cancel`), in the existing AI lane (one AI job at a time across all projects), with its frozen approved plan, Stop and Continue, and the attempt log in the shared library. No new runner.
- `Job.stage` (today `"pilot" | "core"`) becomes `stage` or `reportId`. Batches are keyed the same way. Pilot and core runs are unchanged.
- The approval checks in `src/analysis/job.ts` stay; the check "This batch needs marketing-layer diffs, which arrive with the country expansion step" is removed when the text-layer step (2.4) is built; the core-cap check applies only to pilot/core; the spending-limit check applies to expansions.
- **One approval covers every AI call of the build:** full analyses, text-layer comparisons, country advice, pattern wording and recommendations, and the cross-family reviews when review is on. The approval dialog lists each kind with its model, number of calls or images, and cost range, and the total is the maximum the user authorises. If review is switched on after the approval, it needs its own approval.
- **Frozen input:** the approved plan copy (`state/approved/<plan hash>.json`, as for downloads and analysis today) is a complete manifest: the resolved scope and exclusions, the deck and order snapshot per game and country, every image hash and its tier, the exact source analysis record key and version for each "identical" and each English anchor, and the prompt, schema, taxonomy and pipeline versions. The job and the version it produces read only these pinned objects. Store or analysis changes made while it runs do not enter this version; they show as "Newer data" afterwards.
- **A version at every end of a batch:** when the batch finishes, the report builds its version automatically (section 4) and the list shows "Ready". When it is stopped, fails or reaches the limit, a **partial version** is built too, with all the deterministic content (store order, position tables, pixel facts, patterns from what is analysed, the localisation matrix from hashes) and each missing AI part marked with why and how to get it ("12 text comparisons not done: press Continue, about $0.60"). While a batch runs, the open card shows a preview from what is analysed so far.
- **A text comparison that finds a different screen never escalates by itself.** The text-layer answer can say "the screen under the layer is different". That image is then marked "needs a full analysis", no full call is made, and the batch continues with the other images. At the end the card shows "2 images turned out to be different screens: full analysis needed, about $0.40" with the approval button (the exact images listed). Nothing is sent before that approval.

### 2.4 The text-layer comparison step (new AI step; the only new per-image step)

This is the "marketing-layer diff" from the approved plan v2. It is needed by every non-English report.

- **Input:** the country image's band and text regions, cropped and resized by code (`sharp`, using the English analysis's regions from `regions.ts`), plus the English image's analysis as JSON. The whole image is not re-analysed.
- **Output (Zod-validated, versioned prompt):** for each text on the layer: the local text, the English text it replaces, a literal back-translation, whether it is localised or left in English, genre terms and wording notes; and changes to the band colour, shape or position and to extra elements (character or item swapped), or "no change".
- **Model:** `models.layerDiff` in `configs/defaults.json` (currently Opus). No Sonnet (user rule).
- **Record:** saved in the shared library like any analysis, the moment it is done (resumable). Its key is the hash of: the country image hash, the English image hash, the **exact English analysis record key and version** it was compared with, the crop method version and the hashes of the crops sent, and the text-layer prompt, schema and model. The record stores the same values as its provenance. If the English analysis is redone or the crop method changes, the old comparison is no longer "identical" and shows as needing a new (cheap) comparison. A combined reading for the country image (English screenshot layer + the new marketing layer) is **assembled by code**, so the existing pattern, position-table and fit code reads it unchanged.
- **Early accuracy check** (milestone R3): the pilot's "same picture" test is still provisional. Before the first paid run, the perceptual-hash match is checked by code on all Rogue Legends and core competitor images across the project's countries, and the user is shown the matches that look doubtful (a sample of pairs side by side). A near-match with a different underlying screen falls back to "full".

## 3. Compare countries: content

The report keeps the required format: contents, numbered sections, overview with verdict and key points first, patterns marked fits or different, position tables (one row per position, ours first), recommendations. Sections:

1. **Overview.** Per country: our verdict in that country (optimised, on par, slightly / relatively / very different) as coloured cards, and the key points to optimise across all chosen countries, prioritised.
2. **Per country** (one folded sub-section per country, in the chosen order):
   - the position table for that country: row N = everyone's Nth image in that country's store, ours first, each cell with screen type, headline, the local text, and the (i);
   - the patterns in that country's competitor decks, each with [V] fits or [X] different and the reason (the existing `findPatterns`, `compareOurs`, `patternFit` run on that country's entries); fewer than 2 competitors in a country gives "not enough competitors here" instead of patterns.
3. **How each game localises** (across countries, against the English page):
   - a matrix per game x country: same picture as English (count), same picture with new text (count), different picture (count), order changed (moved positions), text left in English (count), band colour changed, characters or items swapped;
   - the order diff per game and country ("Japan: positions 3 and 4 swapped; a new picture at 5"), computed by code with the existing `compareOrders` over matched images;
   - colour differences from the measured colours (pixel facts, by code);
   - the text and genre wording per country from the text-layer comparisons: the English headline, the local one, the back-translation, and genre terms in a table.
   Computed by code first: identical by content hash, same picture by perceptual hash, order by matching. The AI parts (text, wording) come only from the text-layer records.
4. **Our localisation vs the competitors'**, per country: for each localisation habit (translate the text, reorder, swap pictures, change colours, keep English genre terms), the share of competitors who do it and whether we do, marked [V] same or [X] different with the reason. Computed by code.
5. **Recommendations per country:** the recommended order for that country, per position the screen to capture (usually the same as the Full check's recommendation) and the full marketing-layer spec with the **local text**, genre wording notes and anything to change from the English deck. Produced by one text-only AI call per country (**"country advice"**), from: the Full check's recommendations, that country's patterns and position table, the competitors' localisation habits and their local texts. Zod-validated, cached by input, cross-family reviewed like the core recommendations (when review is on).
6. **Detailed statistics** (folded): per-country pattern tables, as in the current report.

**One country** is the same without section 3's matrix across countries (it keeps the comparison with English for that one country, unless the country is the United States), and with one country in sections 2, 4 and 5. A One country report for the United States with more competitors has the Full check's sections and its own recommendations.

**Data model:** `ReportData` (today one market) becomes the per-country part. A new `MultiReportData = { def, version, countries: ReportData[], localisation: LocalisationData | null, countryAdvice: Record<gl, CountryAdvice | null>, overview }`. `buildReportData` is reused per country by giving it that country's plan slice; the new code is `localisation.ts` (deterministic diff) and the country-advice call.

## 4. Storage and versions

### 4.1 Layout (through `src/storage`, project-scoped keys; no direct `node:fs`)

```
projects/<id>/reports/
  defs/<reportId>.json            the report: name, type, scope, createdAt, archived, versions[]
  <versionId>/                    one immutable version (the existing run-folder convention)
    version.json                  write-once: inputs (below)
    report-data.json              write-once: the full data shown (the page and PDF render only this)
    report.md                     write-once: markdown with relative image links (as today)
    interpretation.json, recommendations.json, country-advice.json, review.json   AI parts, if any
    exports/<options hash>.pdf    derived PDFs (can be deleted and rebuilt)
  latest-pilot.json, latest-core.json   kept: the analysis freshness rule (plan.ts) still reads them
```

- `reportId`: a short slug from the name plus a counter (`r-japan-korea-taiwan-1`), matching the storage key rules.
- `versionId`: `<timestamp>-<reportId>` (pilot/core keep `<timestamp>-pilot` / `-core`, so `listRuns` and the existing runs keep working).
- `version.json` (write-once, `putJsonOnce`): the scope as resolved (exact games, countries, positions), the pick used, the order snapshot date per deck, the record keys and versions per image (including text-layer records), taxonomy, prompt, schema and pattern-fit versions, the approved plan hash (if AI ran), the data fingerprint (below), the AI run id, and `createdAt`.
- **Immutable:** a version is never edited. Rename and archive change only `defs/<reportId>.json`.

### 4.2 Newer data (stale badge)

- The data fingerprint generalises `batchDataHash` to all countries of the scope: games, positions, image ids, usable record versions (including text-layer records), order snapshots, versions and taxonomy.
- The Report tab computes the current fingerprint for each report's scope (code only, cached per request) and compares it with the latest version's. Different means the badge **"Newer data"** with the reason in plain words: "3 new analyses", "Survivor.io's Japanese page changed on 30 Sep", "the pick changed", "the screen-type list was updated".
- A version whose AI parts were written from other data keeps today's rule: AI text is shown as current only when its fingerprint matches, otherwise under "From an earlier version (older data)".
- **Regenerate** recomputes the plan: with nothing new to analyse it builds a new version instantly (free; cached AI calls cost nothing); otherwise it opens the approval with the exact images and cost.
- Store data is never refreshed by a report. Store refresh stays the user-triggered project action (plan 12D). A report pinned to an older store snapshot stays readable as it was.

### 4.3 Archive and delete

- **Archive:** hides the report from the list (shown under "Show archived"); nothing is deleted; it can be restored.
- **Delete:** asks for confirmation ("Delete the report 'Japan, South Korea, Taiwan vs 3 competitors' and its 2 versions? The analyses stay in the library and are reused by other reports."). It removes the report's own files (`defs/<id>.json` and its version folders) through a small, report-only delete in the storage module. **Analyses in the shared library are never deleted by a report.** Pilot and Full check can be archived but not deleted (they carry the analysis freshness pointers).
- Deleting the latest version only (keep the report) is not offered in V1.

### 4.4 Sharing with the library

- Reports hold only references (record keys, image hashes). Two reports that need the same image share its one analysis; the second pays nothing ("already analysed, free").
- The 12C share options include all reports: "Report only" exports one chosen report version (its `report-data.json` rendered by the same static template as the PDF, section 6.4).

## 5. UI: the Report tab

```
Report                                                        [+ New report]
 > Full check (United States, English)   Full check · US · 8 competitors
     28 Sep 2026 · Ready · [Newer data]
 v Japan, South Korea, Taiwan vs 3 competitors   Compare countries · JP KR TW
     28 Sep 2026 · Ready
     [Export PDF] [Regenerate] [More: Rename, Archive, Delete]  Version [28 Sep 16:21 v]
     (the report: contents, 1 Overview, 2 Per country, ...)
 > Pilot (United States, English)        Pilot · US · 3 competitors  27 Sep · Ready
 > Korea only (draft)                     One country · KR · Draft: needs approval ($1.20)
                                                                    Show archived (1)
```

- **List:** every report as a folded `<details>` card, newest first (drafts at the top). The summary line: name, a coloured type pill (four colours, each with its text), countries (plain names, codes only when there are more than three), competitor count, date of the latest version, status (Draft, Waiting for approval, Analysing 5 of 38, Building, Ready, Stopped with Continue, Failed with the reason) and the "Newer data" badge.
- **Open and expand:** opening a card loads that report (lazy: nothing is fetched for folded cards) and renders it with the existing report renderer, inside the card. The existing section folding, the global image toggle and per-section image folding keep working per report.
- **Actions** per report, each with immediate feedback (busy state, progress, success or error message, the card updates): Export PDF (section 6), Regenerate (busy, then either "Built a new version" or the approval dialog), Rename (inline, autosaved), Archive / Restore, Delete (confirmation).
- **Versions:** a selector in the open card (replaces today's run selector): newest first; older ones read-only with their date.
- **New report** opens the builder (section 1.2) above the list. The expansion question after the Full check becomes a "What next?" card with two buttons, "Compare countries" and "Add more English competitors", that open the builder prefilled.
- **Deep links:** `#report/<reportId>` opens the Report tab with that card open (hash routing extends `pageFromHash`).
- Plain language everywhere; no internal codes.

**Renderer changes:** today's report script uses fixed element ids (`report`, `rep-overview`, `reportRun`) and one global `reportData`. It becomes parameterised by a container and report id (ids prefixed with the report id), so several open reports do not clash. The per-country sections reuse the position-table and pattern functions with a country's data.

## 5A. Suggested next research (added at the user's request, 2026-09-28)

A panel that suggests the most valuable gaps to fill next. **It is computed by code only, with no AI and no cost to show.** It never starts anything: each suggestion opens the builder prefilled, and the builder still shows the exact images and waits for approval.

### 5A.1 Coverage map

A grid of every game (ours first, then the project's competitors in priority order, then chart games folded) by every project country. Each cell has one state, as a colour with its word:

| State | Meaning |
|---|---|
| Not sold here | no store page in that country (deck status not `ok`) |
| Downloaded | deck downloaded, no usable analysis |
| Partly analysed (5 of 8) | some positions have a usable analysis (identical images count) |
| Analysed | every phone-deck position has a usable analysis |
| In a report | analysed and used by at least one report (hover lists the reports) |

The first four are the analysis coverage (the cell colour). **"Used in N reports" is a separate badge** on the cell, so "Partly analysed (5 of 8) · used in 2 reports" is shown as such. Built from the deck manifests, the shared library records and the report defs (all code, milliseconds). A cell opens the builder with that game and country ticked.

### 5A.2 Signals (all free, all already on disk)

| Signal | Source | Suggestion |
|---|---|---|
| Picked competitors not analysed yet | the pick (`fitFor`) and the library records | "Analyse Heroll's English deck: it is in your pick but not analysed" (Full check or One country, US) |
| Countries where competitors localise | the planner's own classification per competitor image against the same game's US deck (identical by content hash, same picture with a changed layer by perceptual hash, different picture), code only. This separates "the same file" from "same picture, new text", which the overview's byte-identical rate (`reusedFromUs`) cannot | "Competitors change 70% of their Japanese images (50% new text, 20% new pictures): a Japan report is worth it" |
| Countries where nothing changes | at least 90% of competitor images identical to the US ones | "Skip the Philippines: 95% of images are the US ones, so a report would repeat the Full check" (information, no button except "Show anyway") |
| Weak patterns | `findPatterns` / `patternFit` of the latest Full check: a pattern with n below 4 at a position, or a split vote (top share between 40% and 60%) | "The 3rd image is split between battle and hero list (4 vs 3 games): analysing Mini Tales and Heroll would settle it" (names the unanalysed project competitors whose decks cover that position) |
| Where our game charts | the chart lists saved by the download (`state/charts.json`): our rank in each country's top-grossing list | "Rogue Legends is #10 grossing in Indonesia: see the games around it (free view)" (opens the Screenshots page filtered to that chart; a second button opens the builder with those chart games ticked) |
| Stale store data | order snapshot dates (`orders/`) older than 30 days for games in a report | "Store data for 6 games is older than 30 days: refresh it" (opens the user-triggered store refresh when it exists, plan 12D; hidden until then) |

### 5A.3 What each suggestion shows

- **Why:** the signal in one plain sentence, with its numbers.
- **What:** the games and countries it covers.
- **Cost:** "free" or the image count per kind and the cost range, from the same planner as the builder (`buildScopePlan`, code only).
- **Button:** "Set up this report" (opens the builder prefilled), or "Open" for free views. Plus **Dismiss**.

### 5A.4 Ranking (simple and explainable)

`score = value points / (1 + cost in dollars)`, using the middle of the cost range; free suggestions divide by 1. Value points, added up:

| Rule | Points |
|---|---|
| Fills a gap in the Full check itself (a picked competitor not analysed) | 5 per deck |
| Settles a weak pattern | 3 per pattern, +1 if it is about positions 1 to 3 (seen first in the store) |
| A country where competitors localise | 1 + 4 x (share of competitor images that are not the US ones) |
| A country in the project's default country list (JP, KR, TW, HK, TH, VN, ID, PH) | +1 |
| Our game charts in that country | +2 in the top 10, +1 in the top 50 |
| Already covered by a Ready report with no "Newer data" | x 0 (not suggested) |

- Ties: free first, then the project's country order, then competitor priority.
- **Stale evidence:** weak-pattern suggestions come from the latest Full check only when it has no "Newer data" badge. If it has, the top suggestion becomes "Regenerate the Full check first (free / about $X)", and suggestions derived from it are labelled "based on older data". Suggestions from store data older than 30 days carry the same label.
- Each card shows its reason for its rank in words ("High value: 7 of 8 competitors change their Japanese images; low cost: $2.10").
- The points are constants in one module (`suggest.ts`), versioned, and shown in an "How are these ranked?" note. See decision D7.

### 5A.5 Where it shows

- **At the end of every report**, as a last section "What to research next" (top 5, with "Show all"). The saved version keeps the list as it was at build time (so the PDF has it); the open card shows the live list, labelled "Now", when it differs.
- **In the Report tab**, above the list: the coverage map (folded) and the top 3 suggestions.
- **On the project's home card**, the top suggestion as the "Next" line with its button (after any interrupted job, which keeps priority).
- **Dismissed** suggestions stay dismissed, stored per project in `state/suggestions.json` (by a stable id: kind plus games plus countries). A "Show dismissed (2)" link restores them. A dismissed suggestion is shown again only if its kind of signal changes category (e.g. a country from "nothing changes" to "competitors localise" after a store refresh).

### 5A.6 Files and tests

- `src/reports/coverage.ts` (the map), `src/reports/suggest.ts` (signals, points, ranking, dismissals), `src/view/report-suggest.ts` (panel, map, home-card line); API `GET suggestions`, `POST suggestions/<id>/dismiss`, `POST suggestions/<id>/restore`.
- Tests: each signal on fixtures (unanalysed pick member, localising country, 95% reuse country, split vote, charting rank, stale dates); the ranking order and the tie rules; a covered, current report removes its suggestion; dismissals persist and restore; the costs shown equal the builder's plan for the same scope; no provider is ever called (fake provider counts 0); wording has no internal codes.

## 6. PDF export

### 6.1 Options evaluated

| | (a) Print stylesheet + browser "Save as PDF" | (b) `playwright-core` + installed Chrome/Edge (`page.pdf`) | (b') `puppeteer-core` + installed Chrome | (c) Rebuild layout in a PDF library (pdfkit, pdfmake, react-pdf) | (d) wkhtmltopdf, Gotenberg, Electron |
|---|---|---|---|---|---|
| Fidelity (colours, tables, thumbnails) | Good in Chrome/Edge if the user ticks "Background graphics"; varies by browser | Same Chromium engine as the page; `printBackground` forces colours | Same as (b) | Only what we rebuild; a second renderer to keep in step | wkhtmltopdf: old WebKit, weak CSS; Gotenberg/Electron: heavy |
| Page breaks | CSS only | CSS (`break-inside`, repeated table headers, `@page`) | Same | Manual | Varies |
| Contents with links, bookmarks | Chrome keeps internal links; no bookmarks | Internal links kept; `outline: true` embeds PDF bookmarks from the headings; `tagged: true` for an accessible PDF | Similar (`outline` exists; channel handling needs `@puppeteer/browsers`) | Manual | Varies |
| Folded sections print open | Needs a `beforeprint` script; lazy images may be missing | We control the page: print mode opens everything and waits for every image | Same | n/a | n/a |
| Job, progress, saved file | No: a browser dialog, the user picks a file name and folder | Yes: a job with progress; the PDF is saved in the project | Yes | Yes | Yes |
| Dependency weight | None | `playwright-core` only (a few MB of JavaScript, no browser download, Apache-2.0) | `puppeteer-core` (similar) | New layout code | Large or abandoned |
| Windows | Yes | Yes: `channel: "chrome"` or `"msedge"` finds the installed browser; Edge is on every Windows 11 machine | Needs a path lookup | Yes | wkhtmltopdf archived; Docker for Gotenberg |
| Offline | Yes | Yes (local browser, local server) | Yes | Yes | Mostly |

### 6.2 Decision

- **Feasibility first:** milestone R2 starts with a Windows spike on this machine: launch by `channel: "chrome"`, then `"msedge"`, then an explicit path list (the standard Chrome and Edge install folders, and a path set in settings); produce a PDF of the Full check and check colours, internal links and bookmarks. If `outline` is not supported by the installed browser version, the PDF is still produced and the contents page's links are the navigation (bookmarks are a bonus, not a requirement). If no browser starts, the fallback below is used. The spike result is shown to the user before the rest of R2.
- **(b) `playwright-core` with the installed Chrome, else Edge**, as the Export PDF job. It gives the same rendering as the page, forced colours, bookmarks, a saved file and progress, with one small dependency and no browser download. This machine has Chrome and Edge installed.
- **The print stylesheet is shared** by the PDF, the browser's print and the 12C "Report only" page. The browser's own "Print or save as PDF" button stays as a fallback (with a `beforeprint` handler that opens all sections and loads every image) and is offered automatically if no Chrome or Edge is found ("The PDF export needs Chrome or Edge. You can still use your browser's Save as PDF.").
- Not chosen: rebuilding the layout in a PDF library (reinventing, two renderers), wkhtmltopdf (archived, old engine), Gotenberg or Electron (heavy for one feature).

### 6.3 How it works

1. **Export PDF** opens a small dialog: "With pictures" / "Without pictures" (preselected from the report's global image toggle, so it matches what the user sees), paper A4 or Letter, and landscape (default, because the position tables are wide; decision D4). Every section is always printed expanded, and "With pictures" includes every picture. An optional tick "Also hide the pictures I hid in single sections" carries the per-section choices over (off by default). [Export].
2. The server enqueues an **export job** (new kind `pdf-export`, in a new third lane "export", one at a time across projects, independent of the AI and store lanes). Input: `{ reportId, versionId, images, perSectionHidden, paper, orientation }`. The job key is the hash of the input plus the renderer and print-stylesheet versions: the same export requested again returns the saved file at once, and a changed renderer makes a new file.
3. The job opens `GET /p/<id>/reports/<reportId>/<versionId>/print?...` in a headless browser. The print view is the **same report renderer** in print mode: every section and sub-section expanded, no buttons, the contents as real anchor links, images eager-loaded, light colours forced, a title page (report name, type, countries, competitors, date of store data and analyses, version). The page sets `window.reportReady = true` when all images have loaded or failed.
4. Progress: "Preparing the pages", "Loading pictures 40 of 96", "Writing the PDF", then "Saved" with **Download PDF** (a normal download with the file name `<report name> <date>.pdf`) and the saved path under the project.
5. `page.pdf({ format, landscape, printBackground: true, outline: true, tagged: true, displayHeaderFooter: true, footerTemplate: page x of y and report name, margin })`. The file is written through storage to `reports/<versionId>/exports/<options hash>.pdf`.
6. Stop is supported (closes the browser); errors are shown in plain words ("Chrome could not be started: ..."). The browser is always closed in a `finally`.

### 6.4 Print stylesheet

- `@page` size and margins; each numbered section starts on a new page; `break-inside: avoid` on cards, table rows and position rows; `thead { display: table-header-group }` so long tables repeat their header; `print-color-adjust: exact`.
- Pictures in the PDF are the thumbnails (the page's `thumb` files), not the originals, so a report with 100 pictures stays small (about 3 to 6 MB). "Without pictures" hides them with the existing `noimg` classes.
- The (i) hover details cannot work on paper. In print mode each image cell shows its short info line (screen type, headline, orientation) as text instead.
- Security: the headless browser loads only the local server URL of this project; other requests are blocked (`page.route`), and the page carries no secrets.

## 7. Migration of the existing reports

- On first open of a project after this change (code only, idempotent, no AI):
  - create `defs/r-pilot.json` "Pilot (United States, English)" with versions = every existing `reports/<timestamp>-pilot/` folder, and `defs/r-core.json` "Full check (United States, English)" with the `-core` folders;
  - versions without `report-data.json` (older format) are shown as today: their markdown rendered as HTML with the "older format" note; their Export PDF uses the same print mode on that HTML;
  - versions without `version.json` get none (they are read-only history); the newer-data badge compares the current data with `latest-<stage>.json`'s `dataHash`, as today.
- **No file is moved or rewritten.** `latest-pilot.json`, `latest-core.json`, `pending/analysis-plan-*.json` and the job journal keep their meaning. `reports/current-pilot/` (written by `npm run report`) is not a version; `npm run report -- <report name or id>` now builds a new version of that report (no AI).
- Saved expansion choices (`increments` with state `chosen`) become drafts: a "Compare countries" draft with the chosen countries and the core pick, and a "United States with more competitors" draft with the chosen competitors. The user is told once: "Your saved expansion choice is now a draft report."
- A dry-run test on a copy of the Rogue Legends workspace proves: the same 8 runs listed, the same Report content for "Now", the same pilot and core approval numbers and `planHash`, and every existing file under `reports/`, `pending/` and `state/` **byte-for-byte unchanged** (hash of each file before and after).
- Fixture tests also cover: an old run folder with only `report.md`, one with a malformed or partial `report-data.json` (shown as the markdown with a note, never a crash), a migration interrupted after the first def and run again (same result, no duplicates), and `latest-*.json` still driving the pilot/core freshness exactly as before.

## 8. Files (each under 300 lines)

| File | What |
|---|---|
| `src/reports/types.ts` (new) | Zod schemas: `ReportScope`, `ReportDef`, `VersionInputs` |
| `src/reports/store.ts` (new) | defs and versions through storage; list, rename, archive, report-only delete |
| `src/reports/scope-plan.ts` (new) | `buildScopePlan` over markets; pilot/core presets delegate to today's logic; English anchors; over-limit drop proposal |
| `src/reports/build.ts` (new) | builds a version: per-country `buildReportData`, localisation, AI parts, markdown; write-once |
| `src/reports/localisation.ts` (new) | deterministic cross-country diff (hash, perceptual hash, order, colours) plus text-layer records |
| `src/reports/stale.ts` (new) | scope fingerprint and the plain-language reasons |
| `src/reports/migrate.ts` (new) | section 7 |
| `src/analysis/layer-diff.ts`, `layer-diff-schema.ts`, prompt file (new) | the text-layer step (2.4) |
| `src/analysis/country-advice.ts` (new) | per-country recommendations (text only) |
| `src/export/pdf.ts` (new) | `playwright-core` launch (chrome, then msedge), print, save |
| `src/jobs/*` | kinds `report-analysis` (AI lane) and `pdf-export` (export lane) |
| `src/server/reports-api.ts` (replaces `report-api.ts`) | list, get version, builder plan, create/update draft, build, regenerate, rename, archive, delete, export, download |
| `src/view/report-list.ts`, `report-builder.ts`, `report-country.ts`, `report-print-css.ts` (new); `gallery-report*.ts` parameterised | the UI |
| `src/analysis/expansion.ts`, `src/view/gallery-expand.ts` | become the prefilled "What next?" entry into the builder |

API (all under `/p/<id>/api/`, bodies Zod-validated, ids validated against the listed reports, never used as paths):
`GET reports`, `POST reports` (draft), `PATCH reports/<id>` (name, scope, archived), `DELETE reports/<id>`, `GET reports/<id>/plan`, `POST reports/<id>/build` (instant or approval), `GET reports/<id>/versions/<vid>`, `POST reports/<id>/versions/<vid>/export`, `GET reports/<id>/versions/<vid>/exports/<hash>.pdf`.

## 9. Tests

- **Planner:** pilot and core scopes give the same plan and `planHash` as today; a competitor with the same image in JP and KR costs one analysis; a near-identical Japanese picture becomes text-layer; the English-anchor choice picks the cheaper option; availability ("not sold in Taiwan") excludes that deck; the over-limit proposal drops the lowest-priority combinations first; chart games excluded unless ticked.
- **Instant build:** a scope with 0 new images and cached AI builds without any provider call (fake provider counts 0).
- **Text-layer step:** schema validation, crops within the image, the assembled combined reading passes the existing pattern code, resumability (records saved per image).
- **Localisation diff:** fixtures for same image, same picture new text, different picture, moved positions, missing deck; our habits vs competitors' shares.
- **Versions:** write-once (a second write is refused), rename and archive do not touch versions, delete removes only the report's files and never a library record, stale reasons for each change kind.
- **Migration:** idempotent, no files moved, the same runs listed, the same pilot/core approval numbers.
- **API:** unknown ids 404, bad scopes 400, deleting pilot/core refused.
- **UI (fake DOM, as today):** two open reports do not share element ids; every action shows busy then success or error; the builder shows the recompute state; escaping of names and texts.
- **Approval and recovery boundaries (job level, fake provider):** no provider call without the matching approval; a text comparison answering "different screen" makes no full call and ends with the escalation approval; the runtime limit stops before passing the approved total and Continue offers only the remaining frozen work; a store or record change during a run does not enter the version (it becomes "Newer data"); country advice and review calls are in the approval total; stopping or failing builds a partial version with all deterministic sections; resuming reads only the frozen manifest.
- **Text-layer key:** redoing the English analysis or changing the crop method makes the old comparison not reusable.
- **Scope exclusions:** budget exclusions are shown as such, and cross-country figures use only competitors present in every compared country.
- **PDF:** print mode opens every section and sets `reportReady` only after images load; the export job with a fake launcher (no browser) passes the right options; one real smoke test, skipped when no Chrome/Edge is found, checks the PDF has pages, bookmarks and the report name.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Perceptual-hash "same picture" wrongly matches a different screen, so a text comparison is used where a full analysis was needed | Early accuracy check with the user (2.4); near-matches with a differing screen fall back to full; the text-layer prompt can answer "different screen", which turns the image into a full analysis in the next approval |
| Country advice drifts from the Full check | It receives the Full check's recommendations as its base and is asked for changes only; cross-family review when on |
| Costs grow with many countries | Tiers, English anchors, cached calls, spending limit per build, drop proposal; counts and approval before every run |
| A headless browser fails on some machine (policy, missing browser) | Chrome then Edge; clear message; the browser's own Save as PDF fallback |
| Large reports make big PDFs | Thumbnails only; "Without pictures" option; size shown after export |
| Renderer refactor (ids per report) breaks the current page | Done first (milestone R1) with the existing UI tests plus the two-reports test |
| Many reports make the Report tab slow | Folded cards load nothing; fingerprints computed by code in milliseconds and cached per request |
| Old runs without data | Shown as today (markdown); never rewritten |

## 11. Milestones and user checkpoints

Each milestone: implement (Opus dev agent), tests + typecheck + Biome, cross-family code review (gpt-5.6-sol or gpt-5.6-terra), then the user checkpoint.

| # | Scope | AI cost | User checkpoint |
|---|---|---|---|
| R1 | Report storage (defs, versions, write-once), migration of pilot and core, the Report tab list (folded cards, open, versions, rename, archive, delete), renderer parameterised per report, stale badge for pilot/core, `npm run report -- <name>` | none | The user sees "Pilot" and "Full check" listed and folded, opens both, sees the same content as before, renames one, archives and restores it |
| R2 | PDF export: print stylesheet, print mode, `playwright-core` export job with progress, the with/without pictures option, browser fallback | none | The user exports the Full check with and without pictures and checks colours, tables, page breaks, contents links and bookmarks |
| R3 | Builder and generalised planner (all four types), English anchors, drop proposal, drafts from saved expansion choices, "What next?" card; **no AI yet**: the builder shows the exact images and cost, and builds instantly when nothing is needed (e.g. a US report with only core competitors). Plus the perceptual-hash accuracy check, and **Suggested next research** (5A: coverage map, signals, ranking, dismissals, report section, Report tab panel, home-card line) | none | The user builds a free One country (United States) report from existing analyses, reviews the Japan/Korea/Taiwan builder numbers and the doubtful picture matches without approving, and checks that the top suggestions and their reasons make sense |
| R4 | Text-layer step and country advice; report AI batches through jobs; One country and Compare countries content (per-country tables, localisation, our habits vs competitors', recommendations per country) | first paid expansion, approved by the user | The user approves a Japan, South Korea and Taiwan comparison with 3 to 5 competitors, watches progress, reads the report and exports it to PDF. Outputs reviewed cross-family (screenshot-side review stays paused per the user) |

## 12. Decisions for the user

- **D1.** Country and comparison reports only after the Full check has recommendations (recommended, follows the expanding circle; Rogue Legends already has one, so this blocks nothing today), or allowed any time (their recommendations would then have no core base)? Implementation encodes the recommended rule unless the user decides otherwise.
- **D2.** When a competitor's English image is not analysed, may the tool add the English image as a full analysis to make the other countries cheaper (recommended; shown in the list with the reason)?
- **D3.** Pilot and Full check can be archived but not deleted (recommended), or deletable too?
- **D4.** PDF default: A4 landscape (recommended, the position tables are wide) or A4 portrait?
- **D5.** Add `playwright-core` as a dependency (recommended; no browser download, uses the installed Chrome or Edge)?
- **D6.** Country advice reviewed cross-family by default (a few cents per country), or only when the user turns review on?
- **D7.** The suggestion points (5A.4) and thresholds (90% reuse = "nothing changes", split vote 40-60%, n below 4, store data older than 30 days): accept as the starting values?

## Review outcome

Cross-family review by gpt-5.6-terra on 2026-09-28 (`docs/reviews/reports-plan-review-terra.md`), covering the whole plan including section 5A. 15 findings; 14 applied, 1 kept as a user decision.

| # | Finding | Outcome |
|---|---|---|
| 1 | Stopped or failed runs would leave no usable report | Applied (2.3): a partial version with all deterministic content at every end of a batch; a live preview while running |
| 2 | A text comparison could escalate to a full analysis after approval | Applied (2.3): marked "needs a full analysis", no call, a separate approval with the exact images |
| 3 | Country advice and review costs not clearly in the approval | Applied (2.3): one approval lists every AI call kind with model, count and cost; review switched on later needs its own approval |
| 4 | The $30 limit only estimated, not enforced | Applied (2.2): worst-case reservation before each call, stop before the limit, Continue with a new approval (builds on the runner's existing budget check) |
| 5 | Snapshot freezing underspecified | Applied (2.3): the approved plan copy is a complete pinned manifest; the job and version read only it |
| 6 | Text-layer record key incomplete | Applied (2.4): key includes the exact English record and version, crop method and crop hashes, prompt, schema and model |
| 7 | Pilot/core scopes drift with the pick | Applied (1.3): each version keeps its resolved pick; "the pick changed" is a newer-data reason; Regenerate names the pick change first |
| 8 | Budget drops make country comparisons uneven | Applied (2.2): explicit exclusions shown everywhere; cross-country figures only over competitors present in every compared country |
| 9 | Coverage map mixed coverage and report use | Applied (5A.1): coverage is the colour, "used in N reports" a separate badge |
| 10 | Suggestions from stale or weak evidence | Applied (5A.2, 5A.4): localisation signal from the planner's hash and perceptual-hash classification instead of the byte-identical rate; stale Full check or store data labelled, and "regenerate first" suggested |
| 11 | Headless PDF on Windows unproven | Applied (6.2): R2 starts with a Windows spike (chrome, msedge, explicit paths); bookmarks optional, contents links required; result shown to the user |
| 12 | Export tied to transient fold state | Applied (6.3): always expanded, all pictures by default; per-section hiding only as an opt-in tick; renderer versions in the export key |
| 13 | Migration checks too narrow | Applied (7): byte-for-byte unchanged files, malformed and partial old runs, interrupted re-run, `latest-*` freshness unchanged |
| 14 | Tests miss approval and recovery boundaries | Applied (9): job-level tests for each boundary with a fake provider |
| 15 | D1 unresolved while R3 depends on it | Kept as user decision D1, now stated as enforced in one function everywhere; the recommended rule is the default, and Rogue Legends already has a Full check with recommendations, so R3 is not blocked |
