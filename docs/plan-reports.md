# Plan: several reports per project, with PDF export

Date: 2026-09-28. Status: **decisions D1 to D9 answered by the user on 2026-09-28 and applied** (section 12); reviewed by gpt-5.6-terra, findings applied. No code yet.
Authority: `memory/PILLARS.md`. The report format in `docs/report-requirements-user-2026-09-28.md` applies to every report type. Builds on `docs/plan-project-setup.md` (approved: storage, jobs, shared library, expansion increments, 12C "Report only" share), `docs/ui-pages-plan.md` (report data model and Report page) and `docs/analysis-requirements-user-2026-09-27.md`.
Review: gpt-5.6-terra (cross-family), see "Review outcome" at the end.

## 0. Summary

- **Main country, chosen per project** (default: United States, English). The Pilot always runs on the main country; the Full check is the core check of the main country; every "what changed" comparison is against the main country's store page. Set in the new **Settings page** (section 5B).
- **A project holds many reports.** Four types: **Pilot**, **Full check** (the core check), **One country** and **Compare countries**. Each has a name, its countries, its competitors, the date of the store data and analyses it was built from, and its **generation date** (shown in the list and on the report).
- **After the Pilot, every report type is open.** A Full check of the main country is highly recommended, not required: the builder warns with its cost, and reports built on Pilot-only data say so and get a "Newer data" badge once a Full check exists.
- **Bottom line first:** every report opens with a summary block (the short answer, the key recommendations and the A/B tests to run), then the details.
- **One builder, "New report".** The user picks the type, ticks countries and competitors, and names it. The builder immediately shows what the report needs: which images are analysed already (free), which only need their text compared with the same picture in the main country or another country (cheap), and which need a full analysis. It lists the exact images, the count per kind and the cost, and waits for approval. **A report that needs no new AI is built instantly.**
- **Country reports are the expansion step.** There is one mechanism, not two: the expansion question after the Pilot or the Full check ("more competitors in the main country and/or other countries") opens the builder prefilled. The saved expansion choices become report drafts. The `countries`/`competitors` increments in the job journal keep their role as the approval and spend record of a report's AI batch.
- **Compare countries** gives, per country, our deck against the competitors' decks (the position table for that country); across countries, how each game localises (pictures, order, text, colours, genre wording), computed by code first and completed by the cheap text-layer comparisons; where our localisation differs from the competitors'; and recommendations per country.
- **Saved reports are immutable versions.** Each build writes a new version with its inputs, data and markdown. When the data changes, the report shows a **"Newer data"** badge and a Regenerate button (free when no new AI is needed). Reports can be archived or deleted. Reports never copy analyses; they point at the shared library.
- **Report tab:** a list of all reports, each folded, with name, type, countries, date, status and the newer-data badge. Open one to read it. Actions per report: **Export PDF**, **Regenerate**, **Rename**, **Archive**, **Delete**.
- **PDF export (decision):** a print stylesheet shared by all output, plus **server-side PDF by `playwright-core` driving the Chrome or Edge already installed on the computer** (`page.pdf`, with background colours, clickable contents and PDF bookmarks). It runs as a job with progress. The browser's own "Save as PDF" stays available as a fallback when no Chrome or Edge is found.
- **Suggested next research** (section 5A): a free, code-only panel with a coverage map (every game by country) and ranked suggestions of what to research next (value divided by cost). Each opens the builder prefilled; nothing runs without approval. Shown near the end of every report, in the Report tab and on the home card.
- **Words used, per country** (section 3A): all the marketing-layer text (every headline and caption) per country; Opus, text only, decides the concepts and groups the words (no fixed list), and code does the exact counting and tables. The concept map is cached per text set. In One country and Compare countries reports.
- **CMO voice and A/B tests** (section 3B): all synthesis prompts speak as a store-page CMO (new synthesis versions; no image is re-analysed). Every report shows 2 to 5 "A/B tests to run next" in its summary at the top: computed gaps with evidence, written by Opus as a conversion expert, validated by code. The existing pilot picks this up on its next text-only run.
- **Settings page** (section 5B): the user controls the parameters in the tool (main country, review on or off per AI step, early stop, budget limits, models, suggestion thresholds, PDF defaults), with no config editing.
- **Migration:** the existing pilot runs and the core-check run become two listed reports, "Pilot (United States, English)" and "Full check (United States, English)", with every earlier run as an earlier version. No file is moved or rewritten.

## 1. Report types and the "New report" builder

### 1.1 Types

| Type | Plain name in the UI | Countries | Competitors | AI it can need | Cap and budget rule |
|---|---|---|---|---|---|
| `pilot` | Pilot | the main country, fixed | the first picked competitors (as today), fixed | full analyses in the main country | core cap (100 hard, aim ~85), counted in the core |
| `core` | Full check | the main country, fixed | the whole core pick, fixed | full analyses in the main country | core cap, counted in the core |
| `country` | One country | one country (radio), any of the project's countries, including the main country | ticked from the project's list (named competitors; chart games in a folded group, off by default) | full analyses; text-layer comparisons for other countries | expansion: no fixed image cap; spending limit per build (default $30, adjustable in Settings) |
| `compare` | Compare countries | two or more countries (checkboxes). The main country is always used as the reference for "what changed", whether ticked or not | ticked, as above | as above | as above |

- "More competitors in the main country" (the first expansion kind) is a **One country** report for the main country with extra competitors ticked. It does not change the core pick or the Full check.
- Pilot and Full check are **presets**: their countries and competitors come from the project's pick, as today, so the approved pilot/core flow and the core cap stay exactly as they are.
- **Only the Pilot is required** (decision D1). Once the Pilot has a **Ready** version with its recommendations written (not a partial, stopped or failed one), every type is open. Before that, the other cards are greyed with the reason: "Available after the Pilot."
- **Full check highly recommended:** while the main country has no Full check report, the builder shows a warning above the numbers, with the names, counts and cost computed from the project's own main country and pick, e.g. for Rogue Legends: "Highly recommended: run the Full check of the United States first (8 competitors, about $7 to $13). Country advice built on the Pilot alone rests on 3 competitors." The user can continue.
- Reports built without a Full check carry a banner "Built on the Pilot only (3 competitors)", and their country advice uses the Pilot's recommendations as its base. Once a Full check report exists, they show "Newer data: a Full check is now available" (section 4.2).

### 1.2 The builder (one panel in the Report tab)

```
New report
 What kind?  ( ) Pilot   ( ) Full check   ( ) One country   (o) Compare countries

 Countries                                    Competitors (from this project)
  [x] Japan (Japanese)                          [x] Capybara Go        in all 3
  [x] South Korea (Korean)                      [x] Archero 2          in all 3
  [x] Taiwan (Traditional Chinese)              [x] Survivor.io        not sold in Taiwan
  [ ] Hong Kong  [ ] Thailand  ...              [ ] Mini Tales         in Japan only
  The main country (United States, English)     > Chart games (not ticked by default)
  is used as the reference for what changed.
                                               Our game: Rogue Legends (always included)
 Name  [ Japan, South Korea, Taiwan vs 3 competitors ]   (suggested, editable)
 Data  Store pages from 27 Sep 2026 (per game below). Analyses as of now.

 What this report needs                                      updated as you tick
  Already analysed or identical to an analysed image (free):   61
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
  markets: { gl: string; hl: string }[],        // pilot/core: the main country
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

- For every game in the scope and every market in the scope (plus the main country as the reference for `compare` and for `country` reports of another country), take the phone deck (`analysedSlots`) of that country, and turn each position into a `TierInput` with that market's `gl`/`hl`. The existing `assignTiers` then decides the tier, cheapest first:
  1. **Identical (free):** the same image (content hash) already has a usable analysis in the shared library, or appears earlier in this plan. This covers the common case of a competitor using the same image in several countries.
  2. **Text layer only (cheap):** an image whose picture is near-identical (perceptual hash) to an analysed **anchor** image of the same game (below). Only the cropped band and text regions plus the anchor's analysis are sent.
  3. **Full (strong model):** everything else.
- **Anchors (decision D2).** The anchor for a picture is chosen by code, in this order:
  1. whenever the game has the same picture in the **main country**, that image is **always** the anchor: used if it is analysed, otherwise added to this plan as a full analysis (shown with the reason "analysed once in <main country>, so the other countries only need their text compared");
  2. **only** if the game has no main-country version of that picture (not sold there, or the picture exists only abroad), the same picture in **one of the other countries** of the scope: the first by the project's country order gets the full analysis, and the others get a text comparison against it;
  3. if the picture appears nowhere else, a full analysis, marked **"no main-country version"** in the list and in the report.
  Today's `assignTiers` accepts only baseline anchors; it gains the second rule, and each plan item records its anchor and why.
- `pilot` and `core` call the same function with their preset scope; their output is identical to today's plan (same `planHash`), which a test proves.
- The plan also estimates the **text-only AI** the report needs (pattern wording and recommendations for pilot/core as today; country advice for country and compare reports, section 3; the concept map, 3A; the A/B tests, 3B; and the reviews that are on in Settings), using the existing `estimate()`.
- A report is **"instant"** when the plan has 0 new images and all its AI text is cached for this exact input (the synthesis calls are cached by full input already, `objects/`). Then "Build report" is offered.

### 2.2 Scale rules

- **Core cap** (100 hard stop, aim ~85): applies to Pilot and Full check only, exactly as today (`withinCap`, `coreTotal`).
- **Expansions** (One country, Compare countries): no fixed image cap (user's choice), but each build has a spending limit (default $30, set in the Settings page, adjustable in the approval dialog).
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
- **One approval covers every AI call of the build:** full analyses, text-layer comparisons, country advice, pattern wording and recommendations, and the cross-family reviews that are switched on in Settings (per AI step, section 5B). The approval dialog lists each kind with its model, number of calls or images, and cost range, and the total is the maximum the user authorises. If review is switched on after the approval, it needs its own approval.
- **Frozen input:** the approved plan copy (`state/approved/<plan hash>.json`, as for downloads and analysis today) is a complete manifest: the resolved scope and exclusions, the deck and order snapshot per game and country, every image hash and its tier, the exact source analysis record key and version for each "identical" and each English anchor, and the prompt, schema, taxonomy and pipeline versions. The job and the version it produces read only these pinned objects. Store or analysis changes made while it runs do not enter this version; they show as "Newer data" afterwards.
- **A version at every end of a batch:** when the batch finishes, the report builds its version automatically (section 4) and the list shows "Ready". When it is stopped, fails or reaches the limit, a **partial version** is built too, with all the deterministic content (store order, position tables, pixel facts, patterns from what is analysed, the localisation matrix from hashes) and each missing AI part marked with why and how to get it ("12 text comparisons not done: press Continue, about $0.60"). While a batch runs, the open card shows a preview from what is analysed so far.
- **A text comparison that finds a different screen never escalates by itself.** The text-layer answer can say "the screen under the layer is different". That image is then marked "needs a full analysis", no full call is made, and the batch continues with the other images. At the end the card shows "2 images turned out to be different screens: full analysis needed, about $0.40" with the approval button (the exact images listed). Nothing is sent before that approval.

### 2.4 The text-layer comparison step (new AI step; the only new per-image step)

This is the "marketing-layer diff" from the approved plan v2. It is needed by every report of a country other than the main country.

- **Input:** the country image's band and text regions, cropped and resized by code (`sharp`, using the anchor analysis's regions from `regions.ts`), plus the anchor image's analysis as JSON. The whole image is not re-analysed.
- **Output (Zod-validated, versioned prompt):** for each text on the layer: the local text, the anchor's text it replaces, a literal back-translation, whether it is localised or left in the anchor's language, genre terms and wording notes; and changes to the band colour, shape or position and to extra elements (character or item swapped), or "no change".
- **Model:** `models.layerDiff` (currently Opus), changeable in Settings within the allowed models. No Sonnet (user rule).
- **Record:** saved in the shared library like any analysis, the moment it is done (resumable). Its key is the hash of: the country image hash, the anchor image hash, the **exact anchor analysis record key and version** it was compared with, the crop method version and the hashes of the crops sent, and the text-layer prompt, schema and model. The record stores the same values as its provenance. If the anchor analysis is redone or the crop method changes, the old comparison is no longer "identical" and shows as needing a new (cheap) comparison. A combined reading for the country image (the anchor's screenshot layer + the new marketing layer) is **assembled by code**, so the existing pattern, position-table and fit code reads it unchanged.
- **Early accuracy check** (milestone R3): the pilot's "same picture" test is still provisional. Before the first paid run, the perceptual-hash match is checked by code on all Rogue Legends and core competitor images across the project's countries, and the user is shown the matches that look doubtful (a sample of pairs side by side). A near-match with a different underlying screen falls back to "full".

## 3. Compare countries: content

The report keeps the required format: contents, numbered sections, the bottom line first, patterns marked fits or different, position tables (one row per position, ours first), recommendations. Sections:

1. **Summary: the bottom line** (section 3C, the same block in every report type): the short answer, our verdict per country (optimised, on par, slightly / relatively / very different) as coloured cards, the key points to optimise, the key recommendations, and the A/B tests to run next.
2. **Per country** (one folded sub-section per country, in the chosen order):
   - the position table for that country: row N = everyone's Nth image in that country's store, ours first, each cell with screen type, headline, the local text, and the (i);
   - the patterns in that country's competitor decks, each with [V] fits or [X] different and the reason (the existing `findPatterns`, `compareOurs`, `patternFit` run on that country's entries); fewer than 2 competitors in a country gives "not enough competitors here" instead of patterns.
3. **How each game localises** (across countries, against the main country's page):
   - a matrix per game x country: same picture as the main country (count), same picture with new text (count), different picture (count), order changed (moved positions), text left in the main country's language (count), band colour changed, characters or items swapped;
   - the order diff per game and country ("Japan: positions 3 and 4 swapped; a new picture at 5"), computed by code with the existing `compareOrders` over matched images;
   - colour differences from the measured colours (pixel facts, by code);
   - the text and genre wording per country from the text-layer comparisons: the main-country headline, the local one, the back-translation, and genre terms in a table.
   Computed by code first: identical by content hash, same picture by perceptual hash, order by matching. The AI parts (text, wording) come only from the text-layer records.
4. **Our localisation vs the competitors'**, per country: for each localisation habit (translate the text, reorder, swap pictures, change colours, keep the main country's genre terms), the share of competitors who do it and whether we do, marked [V] same or [X] different with the reason. Computed by code.
5. **Words used, per country** (section 3A): the terminology comparison.
6. **Recommendations per country:** the recommended order for that country, per position the screen to capture (usually the same as the Full check's recommendation) and the full marketing-layer spec with the **local text**, genre wording notes (using the terminology table) and anything to change from the main-country deck. Produced by one text-only AI call per country (**"country advice"**), from: the Full check's recommendations (the Pilot's when there is no Full check yet), that country's patterns and position table, the competitors' localisation habits, their local texts and the terminology table. Zod-validated, cached by input, and **reviewed cross-family by GPT** (decision D6: its own switch in Settings, on by default; text only and cheap).
7. **A/B test details** (section 3B): the full spec of each test summarised in section 1.
8. **What to research next** (section 5A).
9. **Appendix: detailed statistics** (folded): per-country pattern tables, as in the current report.

**One country** is the same without section 3's matrix across countries (it keeps the comparison with the main country for that one country, unless it is the main country), and with one country in sections 2, 4, 5 and 6. A One country report for the main country with more competitors has the Full check's sections and its own recommendations.

**Data model:** `ReportData` (today one market) becomes the per-country part. A new `MultiReportData = { def, version, countries: ReportData[], localisation: LocalisationData | null, countryAdvice: Record<gl, CountryAdvice | null>, overview }`. `buildReportData` is reused per country by giving it that country's plan slice; the new code is `localisation.ts` (deterministic diff) and the country-advice call. `MultiReportData` also carries `terminology` (3A), `abTests` (3B) and `suggestions` (5A).

## 3A. Words used, per country (terminology comparison; added 2026-09-28)

Compares the exact local words the games use for the same ideas, across **all the marketing-layer text** (every headline and caption) per country. Examples of such ideas: battle, play, hero, upgrade, summon, free, reward (Japanese バトル vs 戦闘, Korean 전투 vs 배틀); these are examples only, there is **no fixed list** (decision D8). In One country and Compare countries reports (including a One country report of the main country). Free when the concept map for that exact text is cached; otherwise one cheap text-only call per language.

### 3A.1 Sources (no new reading)

- **Marketing-layer text** from the analyses: the main-country full analyses, the full analyses of other countries, and the text-layer comparison records (local text per image and position).
- **Store text** from `docs/plan-store-metadata.md`: the per-country snapshots in `library/store-text/<app>/<gl>-<hl>/<date>.json` (title, short description, full description, tags), and its derived keywords. The version pins the snapshot date it used (section 4.1). The terminology code **reuses** that plan's cleaning and word splitting (`keywords.ts`: `he` for entities, `Intl.Segmenter` per language, `stopwords-iso`), not a second tokeniser.
- If a country has no store-text snapshot yet, the section uses the image texts only and says: "Store text not read yet for 4 games in Japan: read it (free) with Read store text", which runs the store-metadata backfill (a user-started, free job).

### 3A.2 Method

1. **Text set by code:** per country (language), every marketing-layer text of every game in the report (from the full analyses and the text-layer records, with game, position and role: headline, caption, button), plus each game's store title, short description and full description. Normalised (NFKC, entities decoded, whitespace), de-duplicated and sorted, so the same texts always give the same set.
2. **Concept map by AI (Opus, text only, no images):** one call per language reads the whole text set and **decides the concepts and groupings itself**: each concept gets an id, an English label and a short gloss; each member term is an exact string from the input, with loanword or native word, and optional notes on tone or register. The prompt names the user's seven ideas only as examples. Zod-validated, then checked by code: **every member term must appear verbatim** in the text set (invented terms are rejected, one retry with the problems listed), and a term belongs to one concept only.
3. **Cache per text set:** the map is saved in the shared library under the hash of the language, the text set, and the prompt, schema and model (`library/concept-maps/<hl>/<key>.json`, with the same values as provenance), so the same texts are never sent twice, across projects too. When the text set changes (a new game, a new analysis), the new call receives the previous map and is asked to keep its concept ids where they still fit, so tables stay comparable between versions. The key is part of the report's data fingerprint.
4. **Counting by code:** with the map's terms, code counts per game, country, source (image text, title, short description, full description) and concept. Matching on normalised text, on the word segments of `Intl.Segmenter` (the store-metadata tokeniser), longest match first and without overlaps. Korean: the stem plus an allow-list of particle endings (를, 을, 는, 은, 이, 가, 의, 에, 로, 으로, 와, 과, 도), so 전투를 counts as 전투 but the compound 전투력 (combat power) does not. False-positive fixtures for ja, ko, zh-TW and th are part of the tests.
5. **Cost:** counting is free. A concept map is one text-only call per language (about $0.05 to $0.30 with the full descriptions), listed in the approval like every AI call; with the maps cached it is $0 and the report builds instantly.

### 3A.3 Output per country

- **Concept by game table:** rows = the concepts from the map (most used first); columns = our game first, then the competitors; each cell the term used and where (image text, title, short or full description) with its count.
- **Most common term** per concept: counted in **games that use it** (occurrences shown separately), with "n of m games", where m = the competitors with usable text in that country (image texts analysed, or a store-text snapshot). A game that uses several variants counts for each variant it uses; its main term (shown first in its cell) is the one it uses most, ties broken by the title, then the short description, then the images. Ties between terms: more games, then more total uses.
- **Where our wording differs:** [X] when we use a different term than the most common one used by at least half the competitors with n of at least 3 (else "no clear common term"), with the reason ("we use 戦闘 in 2 images; 6 of 8 competitors use バトル"). Also [X] when our own images and our store text use different words for the same concept.
- **Suggestions:** by code, "consider バトル instead of 戦闘 (6 of 8 competitors)" per differing concept; the country advice (section 3, point 6) and the A/B tests (3B) may use them, citing this table.
- In Compare countries, a short cross-country row per concept (the common term in each country) for a quick view.

## 3B. Report voice and "A/B tests to run next" (all reports; added 2026-09-28)

### 3B.0 Where the A/B tests sit

They are part of the summary at the top of every report (3C), not the end.

### 3B.1 Voice

- All synthesis and recommendation prompts are written in one voice (the report text itself too): a **Chief Marketing Officer who is an expert in optimising game store pages** for discoverability (ASO) and for turning page views into installs. One shared block `prompts/analysis/voice-cmo.v1.md` is included in: pattern wording, recommendations, the recommendations review, country advice and the A/B tests. It asks for decisive, prioritised, evidence-led advice in plain words, with the expected effect on discoverability or conversion stated for each recommendation. The concept map (3A) is a neutral lookup and does not use it.
- **Versioning without re-analysing images:** the per-image prompts (full analysis, second opinion, settling) are not touched, so the analysis key (`pipeline.ts`, which covers only per-image steps) stays the same and **no image is analysed again**. The synthesis contract versions move up (`patterns.v2` to `v3`, `recommend.v2` to `v3`, `recommend-review.v1` to `v2`; new `country-advice.v1`, `concept-map.v1`, `ab-tests.v1`), with new prompt files. A test proves the analysis keys of all existing records are unchanged.
- **Existing pilot and Full check:** the synthesis versions are part of the plan's `versions`, so the latest pilot and Full check reports show "AI parts out of date: written in the older style" after the change. Regenerate (or Start analysis) then offers a text-only run: **0 images**, only the pattern wording, recommendations, review and A/B tests, with the cost shown and the approval as usual. The next run of the existing pilot path uses the new voice.

### 3B.2 A/B tests to run next

In **every report** (Pilot, Full check, One country, Compare countries): **at least 2 and at most 5 tests** (decision D9), shown in the summary at the top (section 3C) as short cards, with the full spec in the "A/B test details" section.

Written as an expert in optimising game store pages for **page-view-to-install conversion**:
- **Ranked by conversion leverage:** the first 2 to 3 screenshots (what a visitor sees without scrolling) matter most; a gap there outranks the same gap further down. Code computes the leverage from the position (positions 1 to 3 weigh 3, 2 and 1.5; later positions 1) times the strength of the evidence (share and n), and the AI must keep the tests in that order unless it states why.
- **One variable per test:** one screenshot, or the order of the set, or the text on the images, or the composition, never several at once. A test that changes two things is rejected by the check.
- **A hypothesis tied to one specific gap** with its evidence and n.
- **Metric and guardrail** (section 3B.3).
- **Play Console setup:** a localised experiment (by language, up to five languages) or an experiment on a custom store listing (by country), the variants (Play allows up to 2 per experiment), and the audience share (the percentage of visitors who see a variant, split equally across the variants).
- **Traffic sufficiency:** fewer, bigger tests for low-traffic markets. The tool cannot see traffic, so the Settings page has an optional "store visitors per month" level per country (low, medium, high, don't know; don't know counts as low). For a low-traffic market: at most 2 tests there, only on positions 1 to 3 or the set order, one variant, a larger audience share, and a note that small differences will end as a draw.

1. **Candidates by code** (`ab-candidates.ts`): every gap between our deck and the competitors, from the report's own data, each with an evidence id and its numbers:
   - patterns where we are [X] different (`patternFit`), weighted as today (order and the first positions first);
   - per-country pattern gaps and localisation habits where we differ (section 3, point 4);
   - terminology differences (3A.3);
   - format gaps, e.g. "7 of 9 competitors in Japan, Korea and Taiwan use landscape composites at position 1; we use portrait".
   Each evidence item: a statement, n ("7 of 9 games", "18 of 24 images"), the games, countries and positions, and the image ids.
2. **Written by AI (Opus, text only, CMO voice)**: 2 to 5 tests, from the candidates (in leverage order), the recommendations and our current deck. Each test has:
   - **hypothesis;**
   - **evidence:** the evidence ids it rests on, shown with their n;
   - **variant:** the exact spec: the image order, and for each image its internal structure (orientation, composition, which in-game screen and where it sits, the marketing band, the headline in the local language, extra elements). Example: "Slot 1: landscape composite, the portrait title screen at left, the headline at right on a dark band";
   - **control:** our current deck in that country (filled in by code from our deck, not by the AI);
   - **the one variable** it changes: one screenshot, the set order, the text on the images, or the composition (Google also advises testing one asset at a time);
   - **metric and guardrail:** see 3B.3;
   - **where it runs (resolved by code, not by the AI):** a default graphics experiment, a localised experiment (up to five languages), or an experiment on a custom store listing for specific countries, with the number of variants (1 or 2) and the audience share from the traffic level. Code maps the chosen countries to their listing languages and states the Play Console setup ("localised experiment: Japanese, Korean, Traditional Chinese"). When countries share a language but need different images (Taiwan and Hong Kong both use Traditional Chinese), it says a custom store listing per country is needed. Whether we have custom listings is not visible to the tool, so it is stated as a setup step for the user, not assumed;
   - **expected impact:** direction and a size in words (small, medium, large) with the reason; no invented percentages;
   - **priority** (1 = run first, from the leverage order);
   - **countries** to run it in.
3. **Validated by code** (the existing `validatedCall` with checks, one retry with the problems listed, then drop): every test cites at least one existing evidence id; the n it quotes matches the evidence; **every country and position the test targets is covered by its cited evidence** (evidence from Japan and Korea cannot support a Taiwan test); the metric is one Play offers; the test changes exactly one variable; a low-traffic market has at most 2 tests; its countries are in the report; its positions exist; the variant's length is within the competitors' deck-length range; the control equals our deck. Tests that still fail are dropped and listed as "left out: no matching evidence". **Minimum of 2:** if fewer than 2 valid tests remain, the next candidates by leverage are shown as code-written tests ("Gap worth testing", with the evidence, the one variable, the control and the setup, without the AI wording). If the report has fewer than 2 real gaps at all, it says so ("Only 1 gap found; we do not invent a second test"): evidence comes before the count. If the AI part is missing, the section lists the code-written tests the same way.
4. **Cost:** one text-only call per report (about the size of the recommendations call), in the approval total; cached by input.

### 3B.3 Play Console metrics (verified 2026-09-28)

Checked against Google's current help pages on 2026-09-28: "Run A/B tests on your store listing" (support.google.com/googleplay/android-developer/answer/6227309) and the store listing experiments guide (answer/12053285). The target metric can be:
- **Unique user install clicks:** "The number of users who installed your app, who didn't have it installed on any other devices at the time." **Primary metric of every test.**
- **Unique user open clicks:** "The number of installed users who opened your app." **The guardrail**, as a check for the user, not a claim about what Play reports alongside the target metric: each test says "after the test, compare opens as well as installs for the winning variant in Play Console; more installs with fewer opens suggests the images over-promise". The tool does not read Play Console results.
- **Unique user pre-registration clicks:** only for games in pre-registration; offered only then.

A reply on the decisions page named "first-time installers" and "retained first-time installers (1-day)". Those names are not on Google's current pages; they appear to be the older names of these metrics (the install-clicks definition above describes first-time installers). The tool uses the current names and keeps them in one constant with the source and the date, so a later change is one edit.

Also from those pages: up to 2 variants per experiment; the audience share is split equally across the variants; localised experiments cover up to five languages; experiments can run on the default and on custom store listings; confidence level and minimum detectable effect are advanced settings (the tool shows Play's defaults and does not change them).

## 3C. Summary first (every report)

Every report, of every type, opens with one summary block before any detail (the user's "bottom line first"; it replaces today's Overview as section 1):

- **The short answer** (3 to 5 sentences, CMO voice): how our store page stands and the single most important change. The verdict word (optimised, on par, slightly / relatively / very different) is computed by code as today; the AI only words it and must keep that verdict.
- **Key points to optimise**, prioritised (computed by code, worded by AI when current, as today).
- **Key recommendations:** the top 3 to 5 changes, each one line with its position and country, linking to the full spec in the recommendations section.
- **A/B tests to run next:** 2 to 5 short cards (hypothesis, the one variable, priority, countries, the setup in one line), linking to "A/B test details".
- The generation date, the store-data date and the analyses date, and any banner ("Built on the Pilot only", "AI parts out of date").

The contents list follows the summary. In the PDF the summary is page 1 after the title page.

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
- `version.json` (write-once, `putJsonOnce`): the **generation date** (`generatedAt`, also shown in the list and at the top of the report), the main country, the scope as resolved (exact games, countries, positions), the pick used, the order snapshot date per deck, the record keys and versions per image (including text-layer records), taxonomy, prompt, schema and pattern-fit versions, the approved plan hash (if AI ran), the data fingerprint (below), the AI run id, and `createdAt`.
- **Immutable:** a version is never edited. Rename and archive change only `defs/<reportId>.json`.

### 4.2 Newer data (stale badge)

- The data fingerprint generalises `batchDataHash` to all countries of the scope: games, positions, image ids, usable record versions (including text-layer records), order snapshots, versions and taxonomy.
- The Report tab computes the current fingerprint for each report's scope (code only, cached per request) and compares it with the latest version's. Different means the badge **"Newer data"** with the reason in plain words: "3 new analyses", "Survivor.io's Japanese page changed on 30 Sep", "the pick changed", "the screen-type list was updated", "a Full check is now available" (for reports built on the Pilot only), "the main country changed".
- A version whose AI parts were written from other data keeps today's rule: AI text is shown as current only when its fingerprint matches, otherwise under "From an earlier version (older data)".
- **Regenerate** recomputes the plan: with nothing new to analyse it builds a new version instantly (free; cached AI calls cost nothing); otherwise it opens the approval with the exact images and cost.
- Store data is never refreshed by a report. Store refresh stays the user-triggered project action (plan 12D). A report pinned to an older store snapshot stays readable as it was.

### 4.3 Archive and delete

- **Archive:** hides the report from the list (shown under "Show archived"); nothing is deleted; it can be restored.
- **Delete:** asks for confirmation ("Delete the report 'Japan, South Korea, Taiwan vs 3 competitors' and its 2 versions? The analyses stay in the library and are reused by other reports."). It removes the report's own files (`defs/<id>.json` and its version folders) through a small, report-only delete in the storage module. **Analyses in the shared library are never deleted by a report.** Pilot and Full check can be archived but **not deleted** (decision D3; they carry the analysis freshness pointers).
- **Re-doing a Pilot or Full check** (decision D3) saves a new version and **automatically archives the previous version**: it moves to "Earlier versions (archived)" in the card, stays readable and exportable, and is never deleted. Other report types are not auto-archived: their earlier versions are listed under "Earlier versions" in the selector, readable and exportable.
- Deleting a single version is not offered in V1.

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

- **List:** every report as a folded `<details>` card, newest first (drafts at the top). The summary line: name, a coloured type pill (four colours, each with its text), countries (plain names, codes only when there are more than three), competitor count, the **generation date** of the latest version, status (Draft, Waiting for approval, Analysing 5 of 38, Building, Ready, Stopped with Continue, Failed with the reason) and the "Newer data" badge.
- **Open and expand:** opening a card loads that report (lazy: nothing is fetched for folded cards) and renders it with the existing report renderer, inside the card. The existing section folding, the global image toggle and per-section image folding keep working per report.
- **Actions** per report, each with immediate feedback (busy state, progress, success or error message, the card updates): Export PDF (section 6), Regenerate (busy, then either "Built a new version" or the approval dialog), Rename (inline, autosaved), Archive / Restore, Delete (confirmation).
- **Versions:** a selector in the open card (replaces today's run selector): newest first; older ones read-only with their date.
- **New report** opens the builder (section 1.2) above the list. The expansion question after the Pilot or the Full check becomes a "What next?" card with three buttons, "Run the Full check" (highly recommended while there is none), "Compare countries" and "Add more competitors in the main country", that open the builder prefilled.
- **Deep links:** `#report/<reportId>` opens the Report tab with that card open (hash routing extends `pageFromHash`).
- Plain language everywhere; no internal codes.

**Renderer changes:** today's report script uses fixed element ids (`report`, `rep-overview`, `reportRun`) and one global `reportData`. It becomes parameterised by a container and report id (ids prefixed with the report id), so several open reports do not clash. The per-country sections reuse the position-table and pattern functions with a country's data.

## 5A. Suggested next research (added at the user's request, 2026-09-28)

A panel that suggests the most valuable gaps to fill next. **It is computed by code only, with no AI and no cost to show.** It never starts anything: each suggestion opens the builder prefilled, and the builder still shows the exact images and waits for approval.

### 5A.1 Coverage map

A grid of every game (ours first, then the project's competitors in priority order, then chart games folded) by every project country (the main country first). Each cell has one state, as a colour with its word:

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
| Picked competitors not analysed yet | the pick (`fitFor`) and the library records | "Analyse Heroll's deck in the United States (your main country): it is in your pick but not analysed" (Full check, or One country of the main country) |
| Countries where competitors localise | the planner's own classification per competitor image against the same game's main-country deck (identical by content hash, same picture with a changed layer by perceptual hash, different picture), code only. This separates "the same file" from "same picture, new text", which the overview's byte-identical rate (`reusedFromUs`, generalised to the main country) cannot | "Competitors change 70% of their Japanese images (50% new text, 20% new pictures): a Japan report is worth it" |
| Countries where nothing changes | at least 90% of competitor images reused from the main country (identical) | "Skip the Philippines: 95% of images are reused from the United States, so a report would repeat the Full check" (information, no button except "Show anyway") |
| Weak patterns | `findPatterns` / `patternFit` of the latest Full check (or the Pilot while there is none): a pattern with n below 4 at a position, or a split vote (top share between 40% and 60%) | "The 3rd image is split between battle and hero list (4 vs 3 games): analysing Mini Tales and Heroll would settle it" (names the unanalysed project competitors whose decks cover that position) |
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
| A country where competitors localise | 1 + 4 x (share of competitor images not reused from the main country) |
| A country in the project's default country list (JP, KR, TW, HK, TH, VN, ID, PH) | +1 |
| The main country has no Full check yet ("Run the Full check") | 8 (it strengthens every other report) |
| Our game charts in that country | +2 in the top 10, +1 in the top 50 |
| Already covered by a Ready report with no "Newer data" | x 0 (not suggested) |

- Ties: free first, then the project's country order, then competitor priority.
- **Stale evidence:** weak-pattern suggestions come from the latest Full check only when it has no "Newer data" badge. If it has, the top suggestion becomes "Regenerate the Full check first (free / about $X)", and suggestions derived from it are labelled "based on older data". Suggestions from store data older than 30 days carry the same label.
- Each card shows its reason for its rank in words ("High value: 7 of 8 competitors change their Japanese images; low cost: $2.10").
- The points and thresholds are defaults in one module (`suggest.ts`), versioned, shown in a "How are these ranked?" note, and **adjustable in the Settings page** (decision D7).

### 5A.5 Where it shows

- **Near the end of every report**, as the section "What to research next", before the appendix (top 5, with "Show all"). The saved version keeps the list as it was at build time (so the PDF has it); the open card shows the live list, labelled "Now", when it differs.
- **In the Report tab**, above the list: the coverage map (folded) and the top 3 suggestions.
- **On the project's home card**, the top suggestion as the "Next" line with its button (after any interrupted job, which keeps priority).
- **Dismissed** suggestions stay dismissed, stored per project in `state/suggestions.json` (by a stable id: kind plus games plus countries). A "Show dismissed (2)" link restores them. A dismissed suggestion is shown again only if its kind of signal changes category (e.g. a country from "nothing changes" to "competitors localise" after a store refresh).

### 5A.6 Files and tests

- `src/reports/coverage.ts` (the map), `src/reports/suggest.ts` (signals, points, ranking, dismissals), `src/view/report-suggest.ts` (panel, map, home-card line); API `GET suggestions`, `POST suggestions/<id>/dismiss`, `POST suggestions/<id>/restore`.
- Tests: each signal on fixtures (unanalysed pick member, no Full check yet, localising country, 95% reuse country, split vote, charting rank, stale dates); the ranking order and the tie rules; a covered, current report removes its suggestion; dismissals persist and restore; the costs shown equal the builder's plan for the same scope; no provider is ever called (fake provider counts 0); wording has no internal codes.

## 5B. Settings page (new requirement, 2026-09-28)

The user controls the tool's parameters in its own page; **no config file is ever edited by hand**. It extends the project Settings screen of `docs/plan-project-setup.md` (1.4) with an "Analysis and reports" part.

### 5B.1 What is on it

| Group | Settings (plain labels) | Default |
|---|---|---|
| Main country | Main country and its language (from the project's countries) | United States, English |
| AI steps | Per AI step (screenshot analysis, text-layer comparison, pattern wording, recommendations, country advice, concept map, A/B tests): its model, and a separate **second opinion** switch with the reviewer model (the other family), each with its cost per use. The steps themselves are part of each report and are not switched off here | second opinions: screenshot analysis **off** (the user paused it), **country advice on** (GPT, D6), recommendations on, the others off |
| Early stop | Minimum decks before stopping, decks in a row with no change, the largest share movement allowed | 5, 2, 10 points |
| Spending limits | Per Pilot or Full check batch; per report build (expansions) | today's values; $30 |
| Core size | Aim and hard stop for the core | 85 and 100 |
| Suggestions | The points and thresholds of 5A.4 (reuse share for "nothing changes", split vote range, weak n, store data age) | 90%, 40-60%, 4, 30 days |
| A/B tests | Store visitors per month per country (low, medium, high, don't know) | don't know |
| PDF | Paper and orientation | A4 landscape (D4) |

### 5B.2 How it behaves

- **One main-country resolver.** Today `coreMarket(config)` and `baselineMarket(config)` are two functions that both return the United States (English). They become one `mainMarket(config)`, read from the setting, used by the Pilot and Full check plans, the anchor rules, the "what changed" comparisons and the suggestions; the two old names remain as thin aliases during the change and are then removed. `ConfigSchema`'s "one baseline, core market" rules check the main country. A test proves every caller gets the same market after a change.

- **Autosave** on every change, with immediate feedback ("Saved", or the error next to the field). A "Back to default" link on each changed value.
- Saved in the project's `project.json` under `overrides` (the field `docs/plan-project-setup.md` 2.2 reserved) through storage, and validated by the existing `ConfigSchema` cross-field rules on every save: one main country, the reviewer from the other model family, no GPT-6 Astra outside special review, no Sonnet for screenshot analysis, Haiku not offered for anything that matters. A refused value keeps the old one and says why in plain words.
- **Consequences shown before saving**, when a change has a cost:
  - a model change for a per-image step: "Images analysed with the old model are not reused: 85 images would be analysed again (about $17) the next time you run the Full check." The user confirms;
  - a main-country change: "The Pilot and the Full check will be for Japan from now on. Your United States reports stay as they are." Existing Pilot and Full check reports stay listed with their country in the name; new ones are created for the new main country;
  - switching a review on: its cost per use is shown, and it enters the next approval.
- Any saved change that affects a plan changes its fingerprint, so an approval shown earlier is refused ("The settings changed since the approval screen was shown. Review the new numbers.", already the rule).

### 5B.3 Files and tests

- `src/settings/overrides.ts` (read, validate and save overrides), `src/server/routes-settings.ts`, `src/view/settings-analysis.ts`.
- Tests: every field saves and reloads; refused values (Astra as reviewer, same-family reviewer, Sonnet for screenshots) keep the old value; the consequences text for a model change counts the right images; a settings change refuses an earlier approval; the main-country change keeps old reports and creates new Pilot and Full check reports.

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

1. **Export PDF** opens a small dialog: "With pictures" / "Without pictures" (preselected from the report's global image toggle, so it matches what the user sees), paper A4 or Letter, and landscape (default A4 landscape, decision D4, changeable in Settings). Every section is always printed expanded, and "With pictures" includes every picture. An optional tick "Also hide the pictures I hid in single sections" carries the per-section choices over (off by default). [Export].
2. The server enqueues an **export job** (new kind `pdf-export`, in a new third lane "export", one at a time across projects, independent of the AI and store lanes). Input: `{ reportId, versionId, images, perSectionHidden, paper, orientation }`. The job key is the hash of the input plus the renderer and print-stylesheet versions: the same export requested again returns the saved file at once, and a changed renderer makes a new file.
3. The job opens `GET /p/<id>/reports/<reportId>/<versionId>/print?...` in a headless browser. The print view is the **same report renderer** in print mode: every section and sub-section expanded, no buttons, the contents as real anchor links, images eager-loaded, light colours forced, a title page (report name, type, countries, competitors, the generation date, the date of the store data and analyses, version), then the summary block (3C). The page sets `window.reportReady = true` when all images have loaded or failed.
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
  - create `defs/r-pilot.json` "Pilot (United States, English)" with versions = every existing `reports/<timestamp>-pilot/` folder, and `defs/r-core.json` "Full check (United States, English)" with the `-core` folders; all but the newest version of each are marked archived (D3);
  - versions without `report-data.json` (older format) are shown as today: their markdown rendered as HTML with the "older format" note; their Export PDF uses the same print mode on that HTML;
  - versions without `version.json` get none (they are read-only history); their generation date is taken from the run id's timestamp; the newer-data badge compares the current data with `latest-<stage>.json`'s `dataHash`, as today.
- **No file is moved or rewritten.** `latest-pilot.json`, `latest-core.json`, `pending/analysis-plan-*.json` and the job journal keep their meaning. `reports/current-pilot/` (written by `npm run report`) is not a version; `npm run report -- <report name or id>` now builds a new version of that report (no AI).
- The main country of existing projects is set to their current core market (United States, English for Rogue Legends), so nothing changes for them.
- Saved expansion choices (`increments` with state `chosen`) become drafts: a "Compare countries" draft with the chosen countries and the core pick, and a "United States with more competitors" draft with the chosen competitors. The user is told once: "Your saved expansion choice is now a draft report."
- A dry-run test on a copy of the Rogue Legends workspace proves: the same 8 runs listed, the same Report content for "Now", the same pilot and core approval numbers and `planHash`, and every existing file under `reports/`, `pending/` and `state/` **byte-for-byte unchanged** (hash of each file before and after).
- Fixture tests also cover: an old run folder with only `report.md`, one with a malformed or partial `report-data.json` (shown as the markdown with a note, never a crash), a migration interrupted after the first def and run again (same result, no duplicates), and `latest-*.json` still driving the pilot/core freshness exactly as before.

## 8. Files (each under 300 lines)

| File | What |
|---|---|
| `src/reports/types.ts` (new) | Zod schemas: `ReportScope`, `ReportDef`, `VersionInputs` |
| `src/reports/store.ts` (new) | defs and versions through storage; list, rename, archive, report-only delete |
| `src/reports/scope-plan.ts` (new) | `buildScopePlan` over markets; pilot/core presets delegate to today's logic; anchors (main country, then another country); over-limit drop proposal; eligibility (Pilot required) and the Full check warning |
| `src/reports/build.ts` (new) | builds a version: per-country `buildReportData`, localisation, AI parts, markdown; write-once |
| `src/reports/localisation.ts` (new) | deterministic cross-country diff (hash, perceptual hash, order, colours) plus text-layer records |
| `src/reports/stale.ts` (new) | scope fingerprint and the plain-language reasons |
| `src/reports/migrate.ts` (new) | section 7 |
| `src/analysis/layer-diff.ts`, `layer-diff-schema.ts`, prompt file (new) | the text-layer step (2.4) |
| `src/analysis/country-advice.ts` (new) | per-country recommendations (text only) |
| `src/reports/terminology.ts`, `src/analysis/concept-map.ts` (new) | 3A: text set and counting by code; the text-only concept map with its verbatim check and cache |
| `src/reports/ab-candidates.ts` (gaps, leverage, code-written tests), `src/analysis/ab-tests.ts`, `src/analysis/play-experiments.ts` (metrics and setup constants, with source and date) (new); `prompts/analysis/voice-cmo.v1.md` and new synthesis prompt files; `src/analysis/prompts.ts` versions | 3B |
| `src/export/pdf.ts` (new) | `playwright-core` launch (chrome, then msedge), print, save |
| `src/jobs/*` | kinds `report-analysis` (AI lane) and `pdf-export` (export lane) |
| `src/server/reports-api.ts` (replaces `report-api.ts`) | list, get version, builder plan, create/update draft, build, regenerate, rename, archive, delete, export, download |
| `src/view/report-list.ts`, `report-builder.ts`, `report-country.ts`, `report-summary.ts`, `report-print-css.ts` (new); `gallery-report*.ts` parameterised | the UI, including the summary block (3C) |
| `src/settings/overrides.ts`, `src/server/routes-settings.ts`, `src/view/settings-analysis.ts` (new); `src/core/targets.ts` (main country from settings) | the Settings page (5B) |
| `src/analysis/expansion.ts`, `src/view/gallery-expand.ts` | become the prefilled "What next?" entry into the builder |

API (all under `/p/<id>/api/`, bodies Zod-validated, ids validated against the listed reports, never used as paths):
`GET reports`, `POST reports` (draft), `PATCH reports/<id>` (name, scope, archived), `DELETE reports/<id>`, `GET reports/<id>/plan`, `POST reports/<id>/build` (instant or approval), `GET reports/<id>/versions/<vid>`, `POST reports/<id>/versions/<vid>/export`, `GET reports/<id>/versions/<vid>/exports/<hash>.pdf`.

## 9. Tests

- **Planner:** pilot and core scopes give the same plan and `planHash` as today (main country United States); a competitor with the same image in JP and KR costs one analysis; a near-identical Japanese picture becomes text-layer; the main-country anchor is used when it exists and added when cheaper; with no main-country version, one other country's copy is the anchor and the rest are text comparisons; a unique picture is a full analysis marked "no main-country version"; every type is refused before a Pilot report exists and allowed after; the Full check warning shows while there is none; availability ("not sold in Taiwan") excludes that deck; the over-limit proposal drops the lowest-priority combinations first; chart games excluded unless ticked.
- **Instant build:** a scope with 0 new images and cached AI builds without any provider call (fake provider counts 0).
- **Text-layer step:** schema validation, crops within the image, the assembled combined reading passes the existing pattern code, resumability (records saved per image).
- **Localisation diff:** fixtures for same image, same picture new text, different picture, moved positions, missing deck; our habits vs competitors' shares.
- **Versions:** write-once (a second write is refused), rename and archive do not touch versions, delete removes only the report's files and never a library record, stale reasons for each change kind.
- **Migration:** idempotent, no files moved, the same runs listed, the same pilot/core approval numbers.
- **API:** unknown ids 404, bad scopes 400, deleting pilot/core refused.
- **UI (fake DOM, as today):** two open reports do not share element ids; every action shows busy then success or error; the builder shows the recompute state; escaping of names and texts.
- **Approval and recovery boundaries (job level, fake provider):** no provider call without the matching approval; a text comparison answering "different screen" makes no full call and ends with the escalation approval; the runtime limit stops before passing the approved total and Continue offers only the remaining frozen work; a store or record change during a run does not enter the version (it becomes "Newer data"); country advice and review calls are in the approval total; stopping or failing builds a partial version with all deterministic sections; resuming reads only the frozen manifest.
- **Text-layer key:** redoing the anchor analysis or changing the crop method makes the old comparison not reusable.
- **Scope exclusions:** budget exclusions are shown as such, and cross-country figures use only competitors present in every compared country.
- **Terminology:** the text set is the same for the same texts in any order; a concept map with a term not in the text is rejected; one term in two concepts is rejected; the cached map makes the build call no provider; a changed text set passes the previous map; counting on fixtures in ja, ko (with particles), zh-TW, th and en; most common term and ties; the "we differ" rule with n thresholds; our images vs our store text; missing store text falls back to image text with the message.
- **Voice and A/B tests:** the analysis keys of all existing records are unchanged after the prompt versions move; the pilot shows "written in the older style" and offers a 0-image run that schedules no image call but reruns every out-of-date text part (patterns, recommendations, review when on, A/B tests); A/B validation drops a test citing an unknown evidence id or a wrong n, or changing two variables; fills the control from our deck; tops up to 2 with code-written tests; never goes above 5; says "only 1 gap found" instead of inventing one; keeps a low-traffic market to 2 tests on positions 1 to 3 or the order; offers only the three Play metrics (pre-registration only for pre-registration games) and flags the open-clicks guardrail.
- **Summary first and dates:** every report type renders the summary block first (page, markdown, PDF page 1 after the title), with the generation date; the list shows the generation date; migrated runs take it from the run id.
- **Versions (D3):** re-doing a Pilot or Full check archives the previous version, which stays readable and exportable and cannot be deleted.
- **PDF:** print mode opens every section and sets `reportReady` only after images load; the export job with a fake launcher (no browser) passes the right options; one real smoke test, skipped when no Chrome/Edge is found, checks the PDF has pages, bookmarks and the report name.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Perceptual-hash "same picture" wrongly matches a different screen, so a text comparison is used where a full analysis was needed | Early accuracy check with the user (2.4); near-matches with a differing screen fall back to full; the text-layer prompt can answer "different screen", which turns the image into a full analysis in the next approval |
| Country advice drifts from the Full check | It receives the Full check's recommendations (or the Pilot's) as its base and is asked for changes only; GPT review on by default |
| Reports built on the Pilot only rest on few competitors | Builder warning with the Full check's cost; banner on the report; "Newer data" once a Full check exists; the Full check ranks first in the suggestions |
| The AI-made concept map shifts between versions and makes tables hard to compare | Previous map passed in to keep concept ids; verbatim check on every term; cached per text set |
| A settings change silently raises costs (a new model means re-analysis) | Consequences with counts and cost shown before saving; the next approval shows the numbers again |
| Costs grow with many countries | Tiers, anchors, cached calls, spending limit per build, drop proposal; counts and approval before every run |
| A headless browser fails on some machine (policy, missing browser) | Chrome then Edge; clear message; the browser's own Save as PDF fallback |
| Large reports make big PDFs | Thumbnails only; "Without pictures" option; size shown after export |
| Renderer refactor (ids per report) breaks the current page | Done first (milestone R1) with the existing UI tests plus the two-reports test |
| Many reports make the Report tab slow | Folded cards load nothing; fingerprints computed by code in milliseconds and cached per request |
| Old runs without data | Shown as today (markdown); never rewritten |
| A/B tests that Play Console cannot run as written (wrong metric, countries sharing a language) | Metrics limited to Play's current targets (verified 2026-09-28, kept in one constant with the source); the setup (default, localised, custom listing) resolved by code with the language mapping; custom listings stated as a user step |
| A/B tests or country advice claim evidence that is not there | Code-built candidates with evidence ids; code checks every citation and n; failing tests dropped and listed; the control filled by code |
| Term counting mismatches (a variant inside a longer word, Korean particles) | Segment-aware longest-match counting, particle allow-list; counts shown with n and source; "no clear common term" below the threshold; AI mapping text only and cached |
| The new voice changes the tone of existing reports | Only synthesis versions move; image analyses untouched; old versions stay readable; the user approves the text-only rerun |

## 11. Milestones and user checkpoints

Each milestone: implement (Opus dev agent), tests + typecheck + Biome, cross-family code review (gpt-5.6-sol or gpt-5.6-terra), then the user checkpoint.

| # | Scope | AI cost | User checkpoint |
|---|---|---|---|
| R0 | Settings page (5B): main country (default United States; Rogue Legends unchanged), review switch per AI step, early stop, spending limits, core size, models, suggestion values, visitors per country, PDF defaults; saved as project overrides with the schema rules and the consequences shown | none | The user opens Settings, changes a spending limit and a review switch, sees them saved, tries a refused model and sees why, and sees that nothing else changed |
| R1 | Report storage (defs, versions, write-once, generation date, auto-archive of the previous Pilot/Full check version), migration of pilot and core, the Report tab list (folded cards, open, versions, rename, archive, delete), renderer parameterised per report, stale badge for pilot/core, `npm run report -- <name>` | none | The user sees "Pilot" and "Full check" listed and folded, opens both, sees the same content as before, renames one, archives and restores it |
| R2 | PDF export: print stylesheet, print mode, `playwright-core` export job with progress, the with/without pictures option, browser fallback | none | The user exports the Full check with and without pictures and checks colours, tables, page breaks, contents links and bookmarks |
| R2b | Summary first (3C), report voice and A/B tests (3B) for the existing Pilot and Full check: CMO voice block, new synthesis versions, candidates and leverage by code, 2 to 5 tests with one variable each, Play metrics and setup, validation, summary block and details in page, markdown and PDF | a text-only run per report, 0 images: pattern wording, recommendations, the recommendations review when on, and the A/B tests (4 calls, each cached), with the call list and cost range on the approval | The user approves the Pilot's text-only run, reads the new summary and its A/B tests, and checks that each test's evidence is real and its setup matches Play Console |
| R3 | Builder and generalised planner (all four types, open after the Pilot, with the Full check warning), anchors (main country, then another country), drop proposal, drafts from saved expansion choices, "What next?" card; **no AI yet**: the builder shows the exact images and cost, and builds instantly when nothing is needed (e.g. a main-country report with only core competitors). Plus the perceptual-hash accuracy check, and **Suggested next research** (5A: coverage map, signals, ranking, dismissals, report section, Report tab panel, home-card line) | none | The user builds a free One country report of the main country from existing analyses, reviews the Japan/Korea/Taiwan builder numbers and the doubtful picture matches without approving, and checks that the top suggestions and their reasons make sense |
| R4 | Text-layer step and country advice with its GPT review; words used per country (3A: concept map by Opus, counting by code; store text from the store-metadata plan); report AI batches through jobs; One country and Compare countries content (per-country tables, localisation, our habits vs competitors', recommendations per country) | first paid expansion, approved by the user | The user approves a Japan, South Korea and Taiwan comparison with 3 to 5 competitors, watches progress, reads the report and exports it to PDF. Outputs reviewed cross-family (screenshot-side review stays paused per the user) |

## 12. Decisions (answered by the user on 2026-09-28)

| # | Question | Answer, applied in |
|---|---|---|
| D1 | When are country and comparison reports allowed? | After the Pilot; only the Pilot is required. A Full check of the main country is highly recommended: builder warning with its cost, a banner on Pilot-only reports, "Newer data" once a Full check exists (1.1, 4.2) |
| D2 | May the tool add an anchor image to make other countries cheaper? | Yes, where possible: the main-country image when it exists; with no equivalent, a full analysis marked "no main-country version"; the same picture in several other countries is anchored on one of them (2.1) |
| D3 | Can Pilot and Full check be deleted? | No, archive only. Re-doing one saves a new version and automatically archives the previous one, which stays viewable and is never deleted (4.3) |
| D4 | PDF paper | A4 landscape (6.3; changeable in Settings) |
| D5 | Add `playwright-core` | Approved (6.2) |
| D6 | Review of country advice | Yes, GPT review; a switch per AI step in the Settings page; country advice on by default (3, 5B) |
| D7 | Suggestion points and thresholds | Approved as starting values, adjustable in Settings; "reused from the main country" (5A.4, 5B) |
| D8 | Concept list for the terminology | Changed: all marketing-layer text per country; Opus decides the concepts and groupings, no fixed list; code counts; the map is cached per text set (3A) |
| D9 | Number and form of A/B tests | At least 2, at most 5 per report, impact in words, written for page-view-to-install conversion: ranked by leverage (first 2 to 3 screenshots), one variable per test, hypothesis with evidence, metric and guardrail, Play Console setup, traffic sufficiency (3B) |

Also decided with them: a **main country** per project (default United States), **generation date** on every report and version, **summary first** in every report (3C), and the **Settings page** (5B, milestone R0).

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

### Review of the additions (3A, 3B)

Short cross-family review by gpt-5.6-terra on 2026-09-28 (appended to `docs/reviews/reports-plan-review-terra.md`). 9 findings, all applied. The metric finding was checked against Google's Play Console help page for store listing experiments before it was applied.

| # | Finding | Outcome |
|---|---|---|
| 1 | Wrong Play Console metrics | Applied: unique user install clicks (default) or unique user open clicks only |
| 2 | "Countries" is not how experiments are targeted | Applied: code resolves default, localised (up to five languages) or custom-listing setup; shared-language countries flagged |
| 3 | Term-mapping cache key too thin | Applied: key covers the language, the term, the concept-list version and the prompt, schema and model; part of the report fingerprint |
| 4 | Term discovery missed rare but important terms | Applied: every term our game uses plus the words shared by competitors, with a stated limit and a list of what was left out |
| 5 | Substring and prefix matching overcounts | Applied: word segments, longest match without overlaps, Korean particle allow-list, false-positive fixtures |
| 6 | "Most common" lacked a denominator | Applied: games with usable text as the base; games using several variants and ties defined |
| 7 | Citations not checked against the targets | Applied: every targeted country and position must be covered by the cited evidence |
| 8 | Whole-deck variants blur the cause | Applied: a test unit, one asset or set by default (Google's own advice) |
| 9 | "One run" hid several calls | Applied: the call list and cost on the approval; the test checks no image call and every stale text part rerun |

### Review of the decision changes

Short cross-family review by gpt-5.6-terra on 2026-09-28 of the changes made after the user's decisions (appended to `docs/reviews/reports-plan-review-terra.md`). 8 findings, all applied. The Play Console metrics were re-verified against Google's current help pages first (3B.3). Finding 3 of the additions review (the term-mapping cache) is superseded by D8: the concept map is now cached per text set.

| # | Finding | Outcome |
|---|---|---|
| 1 | "United States" hard-coded in runtime messages | Applied: messages are built from the project's main country and pick; the United States appears only as the Rogue Legends example |
| 2 | A main-country picture could be skipped as anchor | Applied: when the main country has the picture it is always the anchor; another country is used only when it does not |
| 3 | A partial or failed Pilot could unlock everything | Applied: a Ready Pilot version with recommendations is required |
| 4 | Core and baseline market not reconciled with the main country | Applied: one `mainMarket(config)` resolver; the old functions become aliases, then go; a test checks every caller |
| 5 | Open clicks promised as a Play-reported guardrail | Applied: stated as a check for the user after the test; the tool does not read Play results |
| 6 | Settings mixed "run a step" with "review a step" | Applied: per step a model and a separate second-opinion switch; steps are not switched off there |
| 7 | Auto-archive could read as applying to every report | Applied: only Pilot and Full check auto-archive; other types list earlier versions |
| 8 | Full descriptions counted but never mapped | Applied: they are part of the text set sent for the concept map; cost range updated |

