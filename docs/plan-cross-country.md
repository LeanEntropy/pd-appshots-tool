# Plan: country reports from a comparison, and patterns across groups of countries

Date: 2026-09-29. Status: **draft for user approval, revised after review**. Reviewed by gpt-5.6-sol (full text in `docs/reviews/plan-cross-country-review-gpt.md`; what was applied or declined is at the end). No code yet.
Authority: `memory/PILLARS.md`. Builds on `docs/plan-reports.md` (R4: One country and Compare countries, 3A words used, 3B A/B tests, 3C summary first, 4 versions and "Newer data"), `docs/plan-layout-wireframes.md` (layout capture, wireframes, the 3-games rule) and the R4 code in `src/reports/` (`country-report.ts`, `country-report-types.ts`, `country-facts.ts`, `localisation*.ts`, `ab-section.ts`, `scope-cost.ts`).
Real data used: the finished comparison "Japan, South Korea, Taiwan, Hong Kong, Thailand vs 8 competitors" (`workspace/rogue-legend/reports/2026-09-29T07-08-42-508Z-r-japan-vs-8-competitors-1/`) and the latest Full check (United States).

## 0. Bottom line

- **Country reports at no cost.** When a comparison finishes, the tool also saves a **One country report for each compared country**, made from the comparison's own saved data by code. No AI call, no cost, no approval. Each appears on its country's card in the Reports tab (flag in the card title), marked "From the comparison of 29 Sep", with a link back. **Recommended over "views inside the comparison"**: the user looks for a country on its card, can export or share it alone, and it keeps its own versions.
- **What the comparison did not write for one country:** only A/B tests written for that country alone. We keep the comparison's tests only where their evidence and variant hold for that country alone, and top up with the code-written tests. Paid "write A/B tests for this country alone" is an optional button that creates a new version after approval (about $0.20 to $0.50, cap $1.00 with a retry).
- **Patterns across groups of countries**, computed by code, for groups suggested from region and language and editable by the user. Three kinds of finding, worded differently:
  1. **Our pages differ between countries** (a fact about us, no threshold);
  2. **Common in every country you compared** (a competitor habit that also holds in the main country: roll it out everywhere);
  3. **Different in this group** (the same competitor games do something in the group that they do not do in the main country or the other countries). Only this kind supports "in East Asia, do X".
- **Evidence rules, honest about small numbers:** the unit is a competitor game; a game's pages count once when they are the same (decided per game, not per country); kind 3 needs at least 3 games that changed, none or few the other way, and it must hold in every country of the group; 5 main dimensions can drive recommendations, the other 8 are shown as "exploratory" only. With 8 competitors the tool can show **suggestive** differences worth an A/B test, rarely proven ones, and it says so. It never says "the same" when it only failed to find a difference.
- **Today's data, honestly:** the user's two examples do not show up. Landscape: the same 2 of 8 games (Sword x Staff, Legend of Mushroom) use it in the United States and in all 5 countries. Screenshot inside marketing art in the first three images: 2 to 3 of 8 games everywhere. The strongest finding is about **our own pages**: our United States and Thailand pages open with the title art (with the logo); our Japan, South Korea, Taiwan and Hong Kong pages have no title art, no logo in the first three images, and 12 images (6 pictures shown twice) instead of 7.
- **Wireframe briefs:** without layout capture, a labelled **schematic** per finding with the competitor images behind it; with layout capture (after its L3 step), measured typical layouts per group drawn over our screenshot.
- **Cost:** C0, C1, C2 and C4a are code only ($0). C3 (group evidence in the AI advice and A/B tests) is about **$1.00 to $2.40** for the current comparison, with an **approved maximum of about $6** including repairs and the GPT check's revisions, computed by code from the frozen call list. C4b may need a layout backfill, priced by code and approved separately (at most about $7 to $10 today).
- **Decisions for you:** section 10.

## 1. What the saved comparison already holds (checked on the real data)

| Part of a One country report | In the comparison's `country-report.json`? |
|---|---|
| Verdict per country (code) | Yes: `summary.verdicts` (Japan slightly different 11 of 17 points; South Korea, Taiwan, Hong Kong relatively different; Thailand optimised 19 of 20) |
| Short answer and key actions (AI) | Yes: `advice[].advice.shortAnswer`, `.actions`; `summary.keyActions` by country |
| Recommended deck with local text (AI, GPT-checked) | Yes: `advice[].advice.deck`, `.terms`, `.keepFromMain`, `review`. Its input (`adviceInput` in `country-facts.ts`) is that country plus the main country only, never the other compared countries |
| Position table, patterns, fits or different (code) | Yes: `countries[].data`, a full `ReportData` per country |
| Localisation against the main country | Yes: `localisation.rows` and `localisation.habits` of that country |
| Words used (AI concept map, code counts) | Yes: `terminology[]` of that country |
| How we sort images | Yes: `sorting` |
| A/B tests | **Partly.** AI tests are written once for the whole comparison (3 tests, each naming its countries, citing pooled evidence). Each country also has code-written tests in `countries[].data.abTests` |
| Pattern wording by AI | Not in either report type today (`synthesis: missing`); the code patterns are the content. No change |
| Suggested next research | Recomputed live by code on open |

## 2. Country reports from a comparison

### 2.1 Options

| | (a) Separate One country reports, made automatically (recommended) | (b) Views inside the comparison |
|---|---|---|
| Where the user finds Japan | On the Japan card of the Reports tab (one card per country, `feat/reports-type-cards`) | Only by opening the comparison and picking Japan |
| Export PDF, "Report only" share | Per country, as for any report | Needs a new "print one country" mode |
| Versions, "Newer data", archive | Reuses the report machinery | Tied to the comparison's version |
| Storage | One copy per country (about 0.4 MB each today) | None |
| Clutter | More reports, but on existing country cards, not new cards | None |

**Recommended: (a)**, and the comparison keeps an "Open as its own report" link on each country's section.

### 2.2 How a country report is made from a comparison (code only)

- **Trigger:** after a comparison version is saved as **Ready**, a small step called from `country-version.ts` (not `report-run.ts`, which `feat/layout-capture` changes). Partial, stopped or failed versions make none automatically; the comparison offers "Make country reports now", and those carry the partial banner.
- **Which countries:** every compared country. For the **main country**, only when no Ready report exists with the same competitors and the same data fingerprint (then the card links to that report instead). The Full check is not assumed to be the same thing.
- **One derived report per comparison and country:** id `<comparison id>-<gl>`, name "Japan vs 8 competitors (from the comparison)". Each new Ready comparison version adds a version to each of them.
- **A defined projection, not a raw slice** (`derive-country.ts`, versioned `projection.v1`): the version's `country-report.json` has `type: "country"` and is built field by field:
  - kept as saved: that country's `ReportData`, localisation rows and habits, terminology, advice and its review, sorting;
  - recomputed by code: the summary (verdict, that country's key actions, short answer from its advice), headings, the Play setup, controls and every n shown;
  - dropped: `crossTerms`, `localisation.across`, the group section, any comparison-level prose;
  - A/B tests: see 2.3;
  - a check by code that nothing kept names another compared country (country names and codes in kept text). A hit drops that item to "missing" with the reason, never silently. Today's advice is written from that country and the main country only, so this should never fire; after C3 the group facts it cites are rewritten as "shared with East Asia (Japan, South Korea, Taiwan, Hong Kong)", which is valid because the group evidence covers this country.
  Rebuilding the country with cached AI instead was rejected: the words-used map and the A/B call take the whole comparison as input, so a rebuild misses the cache and would show parts as missing that the comparison has.
- **Two scopes in `version.json`** (write-once): `displayScope` (that country) and `dependencyScope` (every pinned input that shaped the content: that country's decks and records, the main country's decks and records used for localisation and advice, the recommendations run the advice rests on, the concept-map key, the comparison's A/B evidence ids), plus `derivedFrom: { reportId, versionId, gl, projection: "projection.v1" }`. "Newer data" is computed on the dependency scope, with separate reasons ("Japan's pages changed", "the United States baseline changed").
- **Relation record:** one project-level file `reports/derived.json` lists each comparison, its expected country reports and their state (`active`, `suppressed` by the user, `detached`), and per comparison version whether derivation is complete. On project open, code reconciles it idempotently (makes what is missing, never duplicates). A comparison is shown as "Country reports: 3 of 5 made, finishing" until it is complete.
- **Backfill:** the same reconcile makes the country reports for existing Ready comparisons (today: the JP, KR, TW, HK, TH one), after the user says yes (decision D2).

### 2.3 What a stand-alone country report needs that the comparison did not write

| Need | Rule | Cost |
|---|---|---|
| A/B tests for this country | A comparison test is kept only if (1) each evidence item it cites has a value for this country on its own (not only a pooled number), (2) its variant makes sense for this country alone, and (3) the existing checks pass for this country (one variable, control = our deck here, positions exist). Its n, control, evidence lines and Play setup are recomputed from this country's data ("Localised experiment: Japanese"). Otherwise the country's code-written test is used. Top up to 2, never more than 5, "only 1 gap found" as today | Free |
| AI tests for this country alone | Optional button "Write A/B tests for Japan alone": the usual approval with the one call and its capped maximum; the result is a **new immutable version** ("Built alone") with its own approved manifest, run id, prompt and schema versions and fingerprint. The derived version is never changed | About $0.20 to $0.50; cap $1.00 with one repair |
| Advice, words used, verdict, tables | In the projection | Free |
| A/B test that contradicts the advice (open R4 question) | Inherited as the comparison handles it. New group recommendations are checked against each country's advice (3.8) | Free |

### 2.4 Versions, links, deletion

- **Regenerate** on a country report runs the normal One country planner first. It is "free, instant" only when every exact input of every AI step is already cached; otherwise the approval lists the missing AI work (advice, words used, A/B tests) and its cost. The result is a "Built alone" version. The version selector says which kind each version is.
- **Links:** a band at the top, after the summary: "Part of the comparison 'Japan, South Korea, Taiwan, Hong Kong, Thailand vs 8 competitors' (29 Sep, 07:08). Open the comparison. Also in it: South Korea, Taiwan, Hong Kong, Thailand." The comparison's country sections get "Open as its own report". Deep links `#report/<id>`.
- **Cards** (after `feat/reports-type-cards` merges): the country card's dropdown lists its reports newest first with a small "from comparison" chip. No new card kind.
- **Deletion, kept simple:** once made, a country report stands on its own (it has its own copy). Deleting the comparison leaves its country reports; their band then says "The comparison was deleted". Deleting a country report marks it `suppressed` in `derived.json`: later versions of that comparison do not recreate it; "Make country reports now" on the comparison makes it `active` again. Archive and restore do not change the relation. Library analyses are never touched.
- **Same pages:** when every game's images in a country are the same files as in another compared country (Hong Kong and Taiwan today: all 8 competitors and our own), the Hong Kong report says at the top "Hong Kong shows the same images as Taiwan for every game: this report repeats Taiwan's findings". Whether to make it at all is decision D3.

## 3. Patterns across groups of countries

### 3.1 Terms (each explained in the report where it appears, with an example)

- **Group:** compared countries treated together, e.g. "East Asia: Japan, South Korea, Taiwan, Hong Kong".
- **Same pages (per game):** for one game, countries where it shows the same pictures in the same order. Decided **per game**: exact file match first, then the existing picture match (perceptual hash with the anchor rules and the doubtful-match list of R3/R4); doubtful matches count as different pages. Taiwan and Hong Kong are the same pages for every game today, but that is found game by game, not assumed.
- **Changed the same way:** a competitor game that does something on all its pages in the group and does not do it in the main country (or the reverse).

### 3.2 Choosing groups (recommended: suggested by rule, edited by the user; similarity only as a hint)

| Option | For | Against |
|---|---|---|
| Automatic by region and language | Explainable; matches how Play localised experiments and custom store listings are set up | Can group countries that behave differently |
| User-defined | Matches the user's own listings and plans | A UI step |
| Data-driven clustering | Finds unexpected similarity | With 5 countries and 8 games it is noise and changes between runs |

**Recommended:**
1. **Suggest by rule** from a region table in config (game-agnostic; e.g. East Asia: JP, KR, TW, HK, CN; Southeast Asia: TH, VN, ID, PH, MY, SG) and shared listing language. "All compared countries" is always there.
2. **The user edits** groups in the comparison builder (tick countries, rename), autosaved in the report scope (`groups: { name, countries[] }[]`). At most 4 groups; each needs at least 2 countries that are not the same pages for most games (Taiwan plus Hong Kong alone is refused as a group today, with the reason).
3. **Similarity hint by code**, never forming groups: "Thailand's competitors look more like their United States pages than their Japanese ones (on 4 of 5 main dimensions)".
4. **Overlapping groups:** a finding that holds in "All compared countries" is shown there once, not repeated in each smaller group.

### 3.3 Dimensions (fixed list, versioned)

**Main dimensions** (can drive recommendations and A/B tests):

| # | Dimension | Value per game and page | Source | Layout capture adds |
|---|---|---|---|---|
| M1 | Landscape | landscape image at position 1; any landscape image | pixels, every image | |
| M2 | Opening image | title screen / full-screen art at position 1 | analysis | |
| M3 | Screenshot inside marketing art (framed or inset) | used in positions 1 to 3; portrait screenshot inside a landscape image | analysis | inset size and position, frame, measured |
| M4 | Marketing layer size in positions 1 to 3 | small band, large layer, or small screenshot inside a marketing image (the existing labels; most used on the page) | analysis | coverage "up to N %", measured |
| M5 | Logo | logo in positions 1 to 3 | analysis (logo is a first-class attribute) | logo corner |

**Exploratory dimensions** (shown in a folded table with their numbers; never a recommendation or A/B test on their own; the user can ask for a test from one):

| # | Dimension | Value | Source |
|---|---|---|---|
| X1 | Deck length | number of different screens (after duplicate removal, 3.4 rule 6) | manifest + `feat/deck-duplicate-check` |
| X2 | Text amount | text blocks per image in positions 1 to 3 (not words: word counts do not compare across scripts) | analysis |
| X3 | Headline position | top, middle or bottom, most used in positions 1 to 3 | analysis |
| X4 | Order | category sequence in positions 1 to 3 | analysis + store order |
| X5 | Composition mix | the composition kinds in positions 1 to 3 | analysis |
| X6 | Title art message | logo only, headline or benefit, event or offer, character showcase | analysis |
| X7 | Localisation depth | translate, keep main-language text, new pictures, reorder, band colours (existing habits) | localisation |
| X8 | Colour | dominant hue family, positions 1 to 3: **information only, never a finding** | pixels |

- Mood is not a dimension (not reliable).
- A value from the analysis exists for a game only where the positions it needs are **analysed**. Today 130 of 402 competitor positions in the comparison are not analysed, all at position 6 or later, so positions 1 to 3 are complete and "anywhere in the deck" is used only for pixel values (M1).
- Categories become yes/no questions ("opens with title art: yes or no"); deck length and text amount compare the median per game.

### 3.4 Counting and evidence rules (all code, every threshold in Settings)

1. **Unit:** a competitor game. Per game, its pages in the group are merged into "same pages" clusters (3.1). The report shows the number of different pages behind each finding.
2. **A game's value in a group:** "yes" when yes on every one of its pages there, "no" when no on every one, otherwise **"mixed"**. Mixed games stay in the count and are shown as such ("5 yes, 1 mixed, 2 no"); they never count as yes.
3. **Holds in every country:** for each page of the group, the share of games with "yes" there is shown; a finding reports its **weakest country** ("lowest: South Korea, 4 of 8").
4. **Kind 3, different in this group** (paired, against the main country or against the other compared countries): count the games that changed toward (b) and away (c), among games with a known value in both.
   - **Suggestive difference:** b at least 3, c at most 1, and the finding holds in every country of the group (rule 3, at least half the games there). Worded "worth testing: 3 of 8 games changed this way here, 0 the other way".
   - **Clear difference:** b at least 5 and c = 0 (an exact two-sided sign test puts the chance of this by coincidence at about 1 in 16). Worded "clear: 5 of 8 games changed this way, none the other way".
   - Anything else: **"no difference found"** with the counts. Never "the same" or "not an Asian habit". The only exception is a descriptive fact: when the same games have the same value on every page ("the same 2 games use landscape in the United States and in all 5 countries").
   - One-game check: if removing any single game turns a finding from clear to suggestive or from suggestive to nothing, it is labelled "rests on few games".
5. **Kind 2, common in every country you compared:** at least 3 different games and at least 60 % "yes" in every compared country and in the main country. Worded as a roll-out ("in all 6 countries, 5 to 7 of 8 competitors open with title art"), not as a group habit.
6. **Duplicates, per dimension:** exact duplicate files are removed everywhere. Screen-level duplicates from `feat/deck-duplicate-check` (the same screen with a different marketing layer) are removed **only for deck length**; they stay for every marketing-layer dimension (text, logo, layer size, composition, localisation). A deck that repeats screens is itself reported ("our Japanese page shows 6 pictures twice").
7. **Many questions, few games:** only the 5 main dimensions can drive a recommendation; the exploratory table is labelled so; at most 5 findings per group (positions 1 to 3 first, then clear before suggestive, then the larger b minus c); below-threshold numbers go to the folded appendix labelled "not a pattern". A formal correction across all questions is not applied (with 8 games it would reject everything); instead every group recommendation is framed as **an A/B test to run**, which is the real check.
8. **Minimum data:** at least 5 games with a known value in the group, else "not enough games here".
9. **Every number shows n and the games.**

### 3.5 Our deck in the group

- **Ours per country**, [V] fits or [X] different with the reason, from our deck on each page (never assumed equal to the main country).
- **Kind 1, our pages differ:** when our own pages differ between compared countries (and the main country) on a main dimension or on deck length, a finding with the images side by side. No competitor threshold: it is a fact about us. It is shown first when it exists, because it is the cheapest fix (reuse our own images).

### 3.6 What today's comparison would show (computed from the saved data)

| Dimension | United States (main) | Japan | South Korea | Taiwan | Hong Kong (same pages as Taiwan for every game) | Thailand | Result |
|---|---|---|---|---|---|---|---|
| Any landscape image | 2 of 8 (Sword x Staff, Legend of Mushroom); ours no | same 2 games; ours no | same 2 games; ours no | same 2 games; ours no | same | same 2 games; ours no | Descriptive: the same 2 games everywhere. No group finding |
| Opens with title / full-screen art | 5 of 8; **ours yes** | 5 of 8; ours no | 5 of 8; ours no | 7 of 8; ours no | same | 6 of 8; **ours yes** | Kind 2 (common in every country, 5 to 7 of 8). Kind 3 for East Asia: no difference found (Overgeared Hero and Clash of Critters open with title art only in Taiwan: mixed). Kind 1: our pages differ |
| Logo in positions 1 to 3 | 4 of 8; **ours yes** | 4 of 8; ours no | 4 of 8; ours no | 6 of 8; ours no | same | 5 of 8; **ours yes** | Not common enough for kind 2 (4 of 8 is 50 %). Kind 1: our pages differ |
| Screenshot inside marketing art, positions 1 to 3 | 2 of 8 | 3 of 8 | 2 of 8 | 2 of 8 | same | 2 of 8 | No finding |
| Different images in our deck | 7 | 12 (6 pictures twice) | 12 (6 twice) | 12 (6 twice) | same | 7 | Kind 1: our pages differ |

The group section would open: "**Competitors' pages in these countries mostly follow their United States pages; what differs is ours.** In Japan, South Korea, Taiwan and Hong Kong our page has no title art and no logo in the first three images, and shows each picture twice; our United States and Thailand pages do not." Then the kind 2 roll-out (title art first, 5 to 7 of 8 in every country). Group habits like the user's examples will appear when the data supports them (more competitors, or those countries' top-grossing games).

### 3.7 Group recommendations and A/B tests

- **Wording by kind:** kind 1 "Use our own [title art] on these pages as on our United States page"; kind 2 "Applies in every country you compared"; kind 3 "In East Asia (Japan, South Korea, Taiwan, Hong Kong) … (suggestive / clear)". Local headlines stay per country (each country's advice).
- **One variable per test (unchanged rule).** A test changes one asset, the set order, the text, or one composition element. Replacing image 1 with our existing title-art image is **one screenshot** (as in today's comparison test "Open with the title screen and game logo"); adding a logo to an existing image is a separate test. The schematic and any wireframe variant must change exactly the declared element, else the variant is rejected (layout plan 5.1).
- **Group A/B candidate** in `ab-candidates.ts` with the finding's evidence; the existing validation applies (every targeted country covered by the cited evidence, control per country filled by code).
- **Play Console setup, resolved by code** (extends `play-context.ts`; facts verified in plan-reports 3B.3):
  - the group's listing languages are used only by the group and are at most five → a **localised experiment** in those languages;
  - otherwise (e.g. the group has Taiwan but not Hong Kong, which share Traditional Chinese) → a **custom store listing** for the group's countries and an experiment on that listing, stated as a setup step for the user (the tool cannot see their listings).
- **Traffic:** unchanged rule. A group test on one listing collects the visitors of all its countries in one experiment, but the tool does not claim that is enough; low or unset traffic keeps the low-traffic limits, and Play Console decides when a result is significant.

### 3.8 Consistency checks (code)

- A group recommendation must not contradict a country's advice in the group (same position, opposite change). A contradiction is shown with both sources for the user to decide.
- A kind 3 recommendation is never made from a kind 2 or exploratory finding.

### 3.9 Wireframe briefs for a finding

| Without layout capture (C4a, free) | With layout capture (C4b, after the layout plan's L3) |
|---|---|
| A **schematic** drawn by code from the coarse facts (orientation, composition kind, headline top / middle / bottom, band or large layer, logo yes/no), labelled "schematic, not measured", with 3 to 6 thumbnails of the competitor images behind the finding | A **typical layout for the group** from measured boxes (consensus per role used by at least half the games, at least 3 games), a heatmap, and A (our image) next to B (one declared change) drawn over our own screenshot, as in the layout plan 5.1 |
| Enough for "portrait screenshot inside a landscape marketing image, headline at the top, logo top left" | Adds inset size and position, band height and tilt, coverage "up to N %", headline box in fifths |

- Images whose text was compared against a main-country anchor use **the anchor's layout** for composition only (inset, frame, band present), never for headline geometry, labelled so.
- The layout backfill for C4b is priced by code (only full-analysis images in positions 1 to 3 of the group's pages without a layout) and approved separately. Upper bound today: 80 distinct images in positions 1 to 3 are not on any United States page; at the layout-only price (about $0.09 to $0.12) that is **at most about $7 to $10**, likely much less after anchors.

## 4. Report wording (every report type touched here)

- **Bottom line first:** the comparison's summary gains one line for the group section ("Across your countries: …"), after the per-country verdicts. A country report opens with its own summary (verdict, short answer, key actions, A/B tests); the "Part of the comparison" band follows it.
- **Explain every category (all of them, not only new ones):** C0 audits every label the country and comparison reports render (screen types, compositions, layer sizes, localisation habits) and the new ones (group, same pages, changed the same way, the three finding kinds). Definitions sit in one module with a one-line definition, what sets it apart, and an example: one thumbnail for an image category; **two thumbnails side by side** for a change concept (same pages, changed the same way, our pages differ). "How we sort images" gains the new labels. A difference the user cannot see explained does not drive a finding.
- **Flags only in titles:** a real flag image component (with the country name as its alt text) next to a country name in headings, card titles and group headings only; never in tables, running text or key actions. Country codes are never shown as words. A test checks the page HTML, the markdown and the PDF print view: flags outside headings, flag emoji anywhere, bracketed country codes, and internal codes (milestone or decision codes) are failures.
- **Plain words:** "same pages as Taiwan", "3 games changed this way here", "worth testing", "no difference found"; groups by name, never ids.
- **Quality bar:** each finding gives its numbers with n and games, what it means for our page, and one action; "no difference found" gets one line, not a table.

## 5. What the user sees

```
Reports
 [Full check] [Compare countries] [Japan] [South Korea] [Taiwan] [Hong Kong] [Thailand] [Pilot]
   (flag images in the country card titles; each card: title, one line, chip, Open)
   Japan: 29 Sep · Ready · from comparison

Open: Japan vs 8 competitors (from the comparison)
 Summary: slightly different (11 of 17). Open with the title art ...
 A/B tests: 1. Open with the title screen and game logo (localised experiment: Japanese)
 Part of "Japan, South Korea, Taiwan, Hong Kong, Thailand vs 8 competitors" (29 Sep 07:08) · Open the comparison
 Also in it: South Korea · Taiwan · Hong Kong · Thailand

Compare countries builder
 Groups (suggested)                                   [Edit]
  East Asia: Japan, South Korea, Taiwan, Hong Kong    Hong Kong shows the same pages as Taiwan for every game
  All compared countries
  Hint: Thailand's competitors look more like their United States pages (4 of 5 main dimensions)

Comparison report, new section "Across your countries"
 Bottom line: competitors' pages mostly follow their United States pages; what differs is ours.
 > Our pages differ: no title art or logo in Japan, South Korea, Taiwan, Hong Kong; 12 images instead of 7 (images side by side)
 > In every country: 5 to 7 of 8 competitors open with title art
 > East Asia: no difference found on the 5 main dimensions (folded: the numbers)
 > A/B test: our title art first in Japan, South Korea, Taiwan, Hong Kong (localised experiment: Japanese, Korean, Traditional Chinese)
```

## 6. Milestones

Each: implement (Opus dev agent in its own worktree branch), tests + typecheck + Biome, cross-family code review (gpt-5.6-sol), then the user checkpoint.

| # | Name | Scope | AI cost | Depends on | What the user sees |
|---|---|---|---|---|---|
| C0 | Wording | Definitions module for every label, paired examples for change concepts, "How we sort images" additions, the flag, code and emoji checks on page, markdown and print view | none | nothing | Definitions everywhere; flags only in titles |
| C1 | Country reports from a comparison | Projection `projection.v1`, the two scopes, `derived.json` with reconcile on open, trigger on Ready, "Make country reports now", A/B reuse rules, "Built alone" paid path (approval), links both ways, deletion rules, same-pages note, backfill, card chip | none (the optional paid button uses the existing approval) | `feat/reports-type-cards` merged; rebased on `perf/project-open` | 5 country cards filled from the existing comparison; each opens with its own summary and a link back |
| C2 | Groups and findings | Region table in config, group suggestion and editor, per-game page clusters, 5 main + 8 exploratory dimensions, the three finding kinds with the paired rule, ours per country, section in page and markdown, group A/B candidates, Play setup per group, consistency check, Settings fields | none | C1; the `distinctSlots` contract agreed with `feat/deck-duplicate-check` (X1 deck length waits for it; everything else does not) | "Across your countries" with today's honest result |
| C3 | Group evidence in the AI parts | Group findings added to the country advice input and the report's A/B input (new versions `country-advice.v2`, `ab-tests.v3`); the comparison shows "AI parts out of date" and offers the usual text-only regenerate | About $1.00 to $2.40; **approved maximum about $6** (5 x advice with one repair, its GPT check and revision; A/B tests with one repair), computed by code from the frozen call list | C2; `feat/layout-capture` merged (it changes `prompts.ts`) | Advice and A/B tests that cite group evidence |
| C4a | Schematic briefs | Code-drawn schematic per finding with evidence thumbnails | none | C2 | A drawing next to each finding |
| C4b | Measured briefs | Group typical layout, heatmap, A/B drawn over our screenshot | layout backfill if needed, priced and approved separately (at most about $7 to $10 today) | layout plan L1 to L3; C4a | Measured wireframes per group |

Order: C0 and C1 first (free, immediately useful), then C2, then C3 and C4 by the user's choice. PDF for the new parts uses the existing print path.

## 7. Files (each under 300 lines)

| File | What |
|---|---|
| `src/reports/derive-country.ts` (new) | The projection; A/B reuse; same-pages check; other-country name check |
| `src/reports/derived-relations.ts` (new) | `derived.json`: states, reconcile on open, backfill |
| `src/reports/country-version.ts` | Call the derive step after a Ready comparison version |
| `src/reports/types.ts` | `derivedFrom`, `displayScope`, `dependencyScope` (optional in Zod, old files stay valid) |
| `src/reports/stale.ts` | Fingerprint on the dependency scope; the new reasons |
| `src/reports/groups.ts` (new) | Region table, suggestions, per-game page clusters, similarity hint |
| `src/reports/group-dims.ts` (new) | The 13 extractors per game and page |
| `src/reports/group-findings.ts` (new) | The three kinds, paired counts, sign test, one-game check, ranking |
| `src/reports/group-ours.ts` (new) | Ours per country; "our pages differ" |
| `src/reports/group-md.ts`, `src/view/report-groups.ts` (new) | Section in markdown and page |
| `src/reports/ab-candidates.ts`, `play-context.ts` | Group evidence; group Play setup |
| `src/reports/country-report-types.ts` | `groups` part; `version: 2` (v1 files still render) |
| `src/reports/labels-explained.ts` (new, C0) | All definitions and examples |
| `src/config/*`, `src/settings/*` | Region table; group thresholds |
| `src/view/report-cards.ts`, `report-country.ts` | Chip; "Part of the comparison" band and links |
| `src/layout/group-brief.ts` (new, C4) | Schematic and measured briefs |

No change to `src/storage/types.ts` or `src/analysis/report-run.ts` in C1 and C2.

## 8. Tests

- **Projection:** a derived Japan version equals the comparison's Japan parts field by field for everything kept; the summary, n, controls and setup are recomputed; no kept text names another compared country (fixture with a planted name drops the item with its reason); no provider call (fake provider counts 0); write-once; partial versions make nothing unless asked; the main country is derived only when no equivalent report exists.
- **Dependency staleness:** a change to a main-country record used for Japan's localisation marks the Japan report "Newer data: the United States baseline changed"; a change in Korea does not.
- **A/B reuse:** a test citing only pooled Japan + Korea evidence is not kept for Japan; a test with a Japan-only value is kept with n, control and setup recomputed; top-up to 2; "only 1 gap".
- **Approval boundaries (fake provider, fail closed):** the "Write A/B tests for Japan alone" button, Regenerate with missing AI, C3's regenerate, a repair, a review, a revision and a layout backfill make no provider call without a matching approval; the approved maximum stops the run; stop and resume offer only the remaining frozen work; a paid result is a new version and never patches the derived one.
- **Lifecycle:** new comparison version adds a version to each active country report; a suppressed one is not recreated; "Make country reports now" restores it; deleting the comparison leaves the country reports with the band text; reconcile after a crash at each write step ends with each report exactly once; old defs load.
- **Same pages:** clusters per game (a fixture where Taiwan and Hong Kong match for 6 games and differ for 2 gives 2 pages for those 2); doubtful picture matches count as different; a Taiwan + Hong Kong-only group is refused today.
- **Group rules:** mixed games counted as mixed; weakest country shown; b = 3, c = 0 is suggestive, b = 5, c = 0 clear, b = 3, c = 2 "no difference found"; the one-game check labels "rests on few games"; missing positions (not analysed) never count as "no"; overlapping groups show a finding once at the widest group; exploratory dimensions never produce a recommendation; at most 5 findings; colour never a finding.
- **Duplicates per dimension:** a repeated screen with a different headline is removed for deck length only.
- **Real data regression** (read-only copy of the Rogue Legends workspace): landscape gives the descriptive "same 2 games"; kind 1 lists title art, logo and 12 vs 7 for Japan, South Korea, Taiwan, Hong Kong; title art first is kind 2.
- **Play setup:** Japanese + Korean group → localised experiment; a group with Taiwan but not Hong Kong → custom store listing step.
- **One variable:** a group variant that also changes the logo is rejected.
- **Consistency:** a group recommendation opposite to a country's advice is shown as a contradiction.
- **Wording:** every rendered label has a definition and example; flag, emoji, code checks on page, markdown and print view.
- **Performance:** project open with 5 extra country reports stays within `perf/project-open`'s budget (the list reads defs only).
- **Prompt versions (C3):** all existing analysis keys unchanged.

## 9. Conflicts with work in progress

| Branch | Overlap | Handling |
|---|---|---|
| `feat/reports-type-cards` (uncommitted: `report-cards.ts`, `report-list.ts`, `report-list-row.ts`, `report-style-a.ts`, `gallery-expand.ts`, `report-export.ts`) | Country reports appear on its per-country cards | C1 starts after it merges; `type: "country"` reports already land on the country card, so only a chip and the dropdown label are added |
| `feat/deck-duplicate-check` (no code yet) | Deck length (X1) and "our page shows pictures twice" | Agree the output contract with that branch before C2 (distinct screens per deck, each duplicate with what it duplicates and whether only the marketing layer differs). C2 does not code against a guessed function: X1 and the duplicate finding wait for it; exact duplicate files are handled by C2 itself |
| `feat/layout-capture` (uncommitted: `analysis/call.ts`, `run*.ts`, `prompts.ts`, `library/layout.ts`, `reports/report-run.ts`, `storage/types.ts`, `storage/local-fs.ts`, settings schema) | `prompts.ts`, settings schema, report run, storage types | C1 and C2 avoid `report-run.ts` and `storage/types.ts`; C2's settings fields and C3's prompt versions land after it merges (or rebase); C4b needs its L1 to L3 |
| `perf/project-open` (uncommitted: `record-store.ts`, `storage/local-fs.ts`, `storage/types.ts`) | More report files at open | C1 is rebased after it merges; the list reads defs only; the performance test above |

Rule: shared interfaces (the report save hook in `country-version.ts`, the storage keys for `derived.json`, the duplicate contract) are agreed and merged before the milestone that uses them.

## 10. Decisions for you

In plain words: C0, C1, C2 and C4a cost nothing. Only C3 (about $1.00 to $2.40, approved maximum about $6) and a possible layout backfill for C4b cost money, each with its own approval.

| # | Question | Recommended |
|---|---|---|
| D1 | Country reports from a comparison: separate reports on the country cards, or views inside the comparison? | Separate reports, made automatically, linked both ways |
| D2 | Make them now for the finished JP, KR, TW, HK, TH comparison (free)? | Yes |
| D3 | Hong Kong shows the same pages as Taiwan for every game: still make a Hong Kong report? | Yes, with the note at the top |
| D4 | A/B tests in a country report: reuse the comparison's tests only where they hold for that country alone, code-written tests otherwise, and an optional paid "write for this country alone"? | Yes |
| D5 | Groups: suggested by region and language, editable by you, similarity only as a hint? | Yes |
| D6 | Evidence rules: suggestive = 3 games changed and at most 1 the other way, holding in every country; clear = 5 games and none the other way; only the 5 main dimensions drive advice; at most 5 findings per group | Yes (adjustable in Settings) |
| D7 | Colour: information only, never a recommendation? | Yes |
| D8 | C3: add group evidence to the advice and A/B tests (about $1.00 to $2.40, maximum about $6)? | After you have seen C2's result |
| D9 | C4b measured briefs: wait for layout capture L3, backfill priced then? | Yes |

## Review outcome (gpt-5.6-sol, 2026-09-29)

The sandbox was not used for reading; the plan, pillar excerpts, the relevant parts of the reports and layout plans, the R4 code excerpts and the in-flight branch file lists were passed inline. 24 findings; the reviewer judged the first draft not ready (unsound provenance of the derived reports and weak group statistics). 20 applied, 4 partly applied; the declined parts of those 4 are stated with the reason.

| # | Finding (short) | Outcome |
|---|---|---|
| 1 | "Main country never derived" contradicts the request; the Full check is not equivalent | **Applied** (2.2): derived unless an equivalent Ready report exists, then linked |
| 2 | Narrowed provenance makes staleness unsound | **Applied** (2.2): display scope and dependency scope; staleness on the dependency scope with separate reasons |
| 3 | A raw slice may carry cross-country prose | **Applied** (2.2): a versioned projection, field by field; other-country name check |
| 4 | Paid single-country A/B would patch an immutable version | **Applied** (2.3): a new "Built alone" version with its own manifest |
| 5 | Thresholds not statistically defensible; multiple comparisons | **Partly applied** (3.3, 3.4): 5 main vs 8 exploratory dimensions, suggestive vs clear with an exact sign test, one-game check, cap, every group recommendation framed as an A/B test. **Declined:** a formal correction (Benjamini–Hochberg) as a gate; with 5 to 8 games it would reject every finding and make the feature useless. Uncertainty is stated in words instead |
| 6 | "No difference found" wrongly worded as "the same" | **Applied** (3.4, 3.6): three outcomes; only a descriptive "same games, same values" statement |
| 7 | Net change ignores discordant counts | **Applied** (3.4): b and c counted and shown; sign test for "clear"; medians for counts |
| 8 | Mixed estimands; mixed games dropped | **Applied** (3.4): game x page table, mixed counted and shown, weakest country reported |
| 9 | Same-page merge must be per game | **Applied** (3.1): clusters per game; exact then picture match; doubtful = different |
| 10 | Duplicate removal biases marketing-layer dimensions | **Applied** (3.4 rule 6): screen duplicates removed for deck length only |
| 11 | "Title art and logo" breaks the one-variable rule | **Partly applied** (3.7): the rule is stated at asset level; replacing image 1 with our existing title-art image is one screenshot (as in today's approved test); adding a logo to an image is its own test; variants that change more are rejected. **Declined:** splitting the title-art test, since it swaps one existing asset |
| 12 | A habit common everywhere is not a group habit | **Applied** (0, 3.4, 3.7): three finding kinds with different wording; only kind 3 supports group advice |
| 13 | Traffic pooling claim | **Applied** (3.7): stated as a fact about one experiment, no sufficiency claim; low-traffic rule kept |
| 14 | Approval total must include retries and reviews | **Applied** (0, 6): approved maximum computed from the frozen call list, about $6 for C3; cap for the single-country A/B button |
| 15 | Fail-closed approval tests missing | **Applied** (8) |
| 16 | Reused A/B tests may rest on pooled evidence | **Applied** (2.3): kept only with a country-specific value; n, control, setup recomputed |
| 17 | "Free when cached" claim | **Applied** (2.4): the planner runs first; free only when every exact input is cached |
| 18 | Multi-report creation not crash-safe | **Applied** (2.2): `derived.json` with reconcile on open; tests per write step |
| 19 | `derivedOff` in the parent is ambiguous | **Applied** (2.2, 2.4): project-level relation record with active, suppressed, detached |
| 20 | Storage overlap understated; guessed duplicate API | **Applied** (7, 9): no storage-type changes; rebase after both storage branches; the duplicate contract agreed first |
| 21 | Missing statistical tests | **Partly applied** (8): missing positions, per-game clusters, overlapping groups, sign-test outcomes, one-game check. **Declined:** property-based tests; fixtures cover the rules at this size |
| 22 | Category explanations only for new labels | **Applied** (4): audit of every label; paired thumbnails for change concepts |
| 23 | `[JP]` tokens; PDF not checked | **Applied** (4, 5): flag image component with alt text; checks on page, markdown and print view |
| 24 | Copied reports over-engineered; use projections referencing the parent | **Partly applied** (2.4): lifecycle simplified (no cascade delete; children stand alone). **Declined:** reference-only projections; a self-contained copy (about 0.4 MB) keeps PDF export, "Report only" share and deletion of the comparison simple, and the list reads defs only |
