# Plan: layout breakdown and wireframes per store image

Date: 2026-09-28. Status: **approved 2026-09-29 (decisions in section 11); benchmark run 2026-09-29: NO-GO (section 12), not merged**. Reviewed by gpt-5.6-sol (review in `docs/reviews/plan-layout-wireframes-review-gpt.md`; what was applied or declined is at the end). No code yet.
Authority: `memory/PILLARS.md`. Builds on `docs/plan-reports.md` (R2b A/B test cards, R3 builder, R4 country step), `docs/analysis-requirements-user-2026-09-27.md`, `docs/report-requirements-user-2026-09-28.md`. Answer key: the four agent breakdowns in `docs/samples/wireframe-*/`.

## 0. Bottom line

- **What we add:** every analysed store image gets a short **layout** on two layers (the in-game screen, and the marketing layer on top): at most 8 boxes per layer from a fixed list of roles, each with its position, draw order, tilt, text (original and English) and what it covers, plus a one-line composition summary (focal point, how much the marketing layer covers, reading order).
- **How:** the layout is asked for **inside the existing per-image Fable 5.1 call** (no second call for new images). A **standard measuring tool in code** then corrects what pixels can measure reliably: band edges, tilt angles, frame insets, band colours. Text height and contrast are measured too, but stay "experimental" until the benchmark shows they are right.
- **No re-analysis of existing images.** The layout is saved as a separate small file next to the image's analysis in the shared library, keyed to that analysis. Existing analyses stay valid and reused. Old images get a layout only through an optional one-off backfill that you approve with its cost (about $5 to $7 for the 58 images analysed today).
- **What you get, in order:** (1) wireframe briefs for every recommended image and every A/B test variant, drawn over our own screenshot, A next to B with the one difference highlighted; (2) layout patterns with numbers ("7 of 8 put the headline in the top fifth") and a typical layout per store position compared with ours; (3) a small-size readability check; (4) a check that Japanese, Korean, Thai and Chinese headlines fit their box; (5) later, layout-change hints in store history. Shown in the (i) popover, the position table and the reports; PDF comes last (low priority).
- **Benchmark first:** one real call on each of the 4 sample images, scored against the agent breakdowns. **Estimated $0.85 to $1.10, hard stop at $1.20 for everything including retries; needs your approval.** Go/no-go rules in section 7.
- **Cost after rollout:** estimated +$0.04 to $0.07 and +10 to 25 seconds per newly analysed image (today: about $0.16 and 29 seconds median). This is an estimate; the benchmark measures it (section 7 explains how exact that measurement is).
- **Decisions for you:** section 10, with a plain summary of what each choice changes.

## 1. What the tests showed, and what changes

The four agent tests (Archero 2 #4, Rogue Legends #1, Legend of Mushroom #3, Survivor.io Japan #4) produced strong breakdowns: UI screens, key art, a landscape image and a text-heavy Japanese image, with angles, band edges and overlay share measured from pixels and Japanese transcribed and translated. The problems were process, not judgement:

| Problem in the tests | Change in this plan |
|---|---|
| 6 to 16 minutes and 77k to 175k tokens per image; only a third to a half was the analysis | The layout rides in the per-image call the tool already pays for; finding the image, loading examples and drawing are done by code |
| Each agent wrote its own measuring script | One standard measuring tool, versioned, tested, run by code |
| 21 to 47 elements per image: too fine to compare across games | Fixed short list of roles, at most 8 boxes per layer; only coarse positions used for patterns |
| Drawing by hand | Wireframes drawn by code on demand from the saved layout |

## 2. The layout reading

### 2.1 Roles (fixed list in code, shown to the model)

**In-game screen layer:** `hud` (status bars, currencies, button strips), `nav-bar` (tab bar, bottom navigation), `main-scene` (world, battle field, stage, showcase), `character` (a prominent in-game hero, unit or boss), `panel` (list, grid, inventory, roster, shop), `dialog` (popup, tooltip, reward or result window), `game-text` (an in-game text block worth reading), `other` (needs a note).

**Marketing layer:** `band` (straight, tilted, torn or fading band or banner), `headline`, `subline`, `logo`, `badge` (sticker, burst, ribbon, number), `cut-out` (character or item placed on top), `frame` (card, device frame, rounded box around a capture), `callout` (arrow, bubble or label pointing at the screen), `backdrop` (marketing art behind a shrunk capture), `other` (needs a note).

The same role may appear more than once (two cut-outs, two badges); ids keep them apart.

### 2.2 Exact fields (strict JSON, every field required, "none" as `null`)

Per element:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | `S1`..`S8` (in-game layer), `M1`..`M8` (marketing layer) |
| `role` | one of the roles above | |
| `box` | x, y, w, h, numbers 0 to 100 | Percent of the whole image, origin top-left. For a tilted element: the box of the **unrotated** element, rotated by `tiltDeg` around the box centre |
| `tiltDeg` | number, -45 to 45 | 0 when level; negative = rising to the right |
| `z` | integer from 0 | Draw order within its layer, higher on top |
| `capture` | integer (0-based index into the core reading's capture list) or `null` | Required for in-game elements when the image has captures; `null` for marketing elements and for full-screen art |
| `textRef` | integer (0-based index into the core reading's marketing texts) or `null` | For `headline`, `subline`, `badge` and `logo` text: points at the text already transcribed; no second transcription |
| `text` | string or `null` | In-game text only (original script). `null` when `textRef` is set |
| `textEn` | string or `null` | English meaning of the element's text (either source); `null` when it has no text |
| `covers` | array of in-game ids | Marketing elements only: which in-game elements it hides (empty when none) |
| `note` | string, at most 80 characters | Required for `other`, otherwise may be empty |

Composition: `focal` (x, y, element id), `readingOrder` (up to 5 ids), `overlaySharePercent` (the model's estimate), `summary` (one sentence).

Examples in the prompt and in tests: one full capture with a band; a composite (landscape, 3 captures); full-screen art (no captures, `capture` null); no marketing layer (marketing list empty).

**Element cap:** at most 8 per layer. Enforced by the schema (array maximum) and the prompt ("merge smaller parts into their parent").

### 2.3 Who owns which fact (no double truth)

- **The core reading owns** the transcription of marketing text, the capture list, whether a marketing layer exists and the headline. The layout **refers** to them (`textRef`, `capture`) and never repeats them.
- **The layout owns** the roles, draw order, what covers what, reading order and the focal point.
- **The measuring tool owns** measured geometry (band edges, tilt, insets, colours) wherever its quality check passes.
- **Checks by code** (layout problems): every `textRef` and `capture` exists; a marketing layer marked absent means an empty marketing list, and a present one means at least one marketing element; every in-game element in a composite names its capture; `covers` points at in-game ids only.

### 2.4 How it is captured without breaking the current analysis

- **Prompt:** the producer's prompt is the current full-analysis prompt plus a separate block file `prompts/analysis/layout-block.v1.md`. The second opinion (GPT, paused today) keeps the current prompt without the block. Both prompts are hashed into their answer-cache keys as today, so they are cached separately.
- **Answer:** `{ images: [ { ...core reading, layout } ] }`. The core part keeps its schema (`analysis-schema.v3`) and meaning.
- **Validation in two parts.** The answer is first checked with a permissive outer shape, then the core part with today's checks and the layout part with its own checks. `validatedCall` gets an option for this (a split check that returns core problems and layout problems separately, and returns the valid core even when the layout is invalid):
  - A **core problem** behaves exactly as today (up to 2 repair attempts, then failed).
  - **Layout problems** are added to the repair request **only while the core also needs a repair, or once on their own** (so at most one extra call is spent on the layout alone). If they remain, the core reading is saved as usual and the layout is saved as "missing" with the problems.
  - The raw answer is cached as soon as the core is valid, so a layout failure never costs a second full call later.
- **The analysis key does not change.** The key (`pipeline.ts`) stays the hash of the core settings, so existing records stay current and shared. New rule, written in `pipeline.ts`: "an add-on with its own version and its own file never changes the analysis key". A test proves the analysis keys of all existing records are unchanged.
- **Risk:** asking for the layout in the same call could shift the core answers. The benchmark checks this (section 7). If it shifts, the layout moves to its own call (no-go path B).
- **When the second opinion wins:** if a disputed reading is settled in favour of the reviewer's core reading, the producer's layout is checked again against the settled reading (its `capture` and `textRef` must still point at the right things). If it no longer fits, it is marked "missing" and can be backfilled.

### 2.5 Where the layout is saved (a separate write-once file)

- **File:** `library/layout/<image>/<layout key>.json`, where the layout key is the hash of: the image's core analysis record key, the layout contract (`layout.v1`) and the layout schema version (`layout-schema.v1`). The file holds the layout, its source ("same call" or "backfill"), the model, the cached answer key, the date, and its status.
- **Why not inside the analysis record:** the record is rewritten as a whole today (no merge), so adding a layout into it later (backfill) could overwrite another writer's changes, and one record key would then hold records with and without layouts. A separate write-once file (the storage's `putJsonOnce`) avoids both: the first valid layout wins, later writers keep it, and a new layout version is simply a new file. It stays in the shared library, content-addressed, reused by every project and never recomputed. The (i) popover, reports and exports read it together with the record.
- **Status per image**, computed by code: current (a layout file for today's version), missing (never captured, or failed checks), outdated (only an older layout version exists). Backfill and the reports use this status; the core "done" check (`isUsable`) is unchanged.
- **Key helpers:** new typed functions in `src/library/layout.ts` for the layout file and the measurement file, for both library projects and projects not yet moved to the library (their project folder). No direct file access from feature code.

### 2.6 Backfill for images analysed before the layout existed

- A separate **layout-only call** (prompt `layout-only.v1`, same layout schema), one image per call, with the image's core reading given as text so the roles line up with its captures and texts. The same checks, and at most one repair.
- Offered, never automatic: the tool shows the exact images by game, visually marked, the count and the cost, and waits for approval, like every AI step. Saved per image the moment it is done, resumable, with progress ("Adding layout to image 5 / 58"). Only images whose status is missing or outdated are offered.
- The images reports and briefs need come first: our own deck, then the competitors' first 3 positions, then the rest. You can approve only the first group.

## 3. The measuring tool (code, sharp)

One module, `src/layout/measure/` (small files, each under 300 lines), version `layout-measure.v1`. It is seeded by the model's boxes (it searches near them) and never invents elements.

**Reliable measurements (used for patterns and briefs):**

| Measure | How |
|---|---|
| Band edges and tilt | Edge strength on a grey copy (long edge 1024 px) in a strip around the band's top and bottom edge; a straight-line fit with outlier rejection gives the edge at the left and right border and the angle |
| Frame insets | Uniform-colour margins around a capture (rows and columns with low variance) |
| Snap to edges | Rectangular roles (band, frame, dialog, panel, nav-bar) snap each box edge to the strongest edge within 3 percent |
| Band colour | Median colour inside the band polygon |
| Marketing coverage | Union of the refined band polygons plus the other marketing boxes. Cut-outs count by their box, so this is an **upper bound** and always labelled "up to" |

**Experimental (shown per image, not used for recommendations or patterns until the benchmark validates them):** headline tilt and glyph height (text pixels separated from the band by colour distance; outlined, shadowed or gradient text often fails this, so a low-confidence result is dropped), and text contrast.

- **Quality rule:** each measured value carries a quality score (line-fit error, edge strength). Below the threshold, no measured value is saved; the model's value stays and is labelled "estimated". Values are rounded (positions to 1 percent, angles to 0.5 degrees).
- **Which values may be used where:**

| Use | Measured values | Model estimates |
|---|---|---|
| Wireframe of one image | Yes | Yes, drawn dashed and labelled "estimated" |
| Layout patterns, typical layout, A/B evidence | Yes | Only for coarse zones (which fifth of the image, which side) and roles present; never for angles, edges or coverage numbers |
| Minimum n for a numeric pattern | At least 3 different competitor games with a measured value | |

- **Storage:** `library/images/pixels/<image>.layout-measure.v1.<layout key>.json` through the new key helper (2.5), write-once; on a collision the existing file is kept. Computed by code once per image after its layout exists (well under a second per image).
- **Tests:** synthetic images drawn by sharp with known bands, angles, insets and text (exact expected values), plus the 4 samples with their answer-key numbers as regression tests (±1.5 percent, ±1 degree).

## 4. Storage summary

| What | Where | Rule |
|---|---|---|
| Layout | `library/layout/<image>/<layout key>.json` | Write-once, keyed to the core analysis record, shared across projects, never recomputed |
| Raw model answer | Answer cache as today (`library/objects/full-analysis/`; backfill under `layout-only`) | As today |
| Pixel measurements | `library/images/pixels/` | Write-once per measuring version and layout |
| SVG wireframes | Not stored | Drawn by code on demand; a saved report version embeds the SVGs it showed, so it never changes afterwards |
| Trial files `structure-test-v0.json` (3 images) | Removed from `library/analysis/<image>/` after a byte-for-byte check against `docs/samples/*/structure.json` (identical today) | A one-off cleanup command through the storage interface with a narrow allow-listed key pattern. The record reader currently opens every `.json` in that folder, so these files are read as candidate records (harmless today, removed by the cleanup). The samples in `docs/samples/` stay as the benchmark answer key |

Share and import (planned milestone 3b): Full, Core and Light packages carry the layout and measurement files for their images (small JSON); "Report only" carries the report's embedded SVGs.

## 5. Uses (in priority order)

### 5.1 Wireframe briefs (recommendations and A/B variants)

- **Drawer:** `src/layout/wireframe-svg.ts` draws three views: in-game layer, marketing layer, combined. Roles have fixed colours and hatching; tilted bands are real polygons; labels are plain words ("Headline", "Character cut-out"); text shown in the original and English; estimated values dashed.
- **Background, first available:** (1) a fresh capture of that screen supplied by you (the existing own-assets folder); (2) our current store image at that position, dimmed, with its marketing layer faded out using our layout boxes; (3) a grey placeholder with the screen name. The brief says which one it used.
- **Recommended images:** each recommended position gets a brief. Its layout starts from the typical layout for that position (5.2), adapted by code to our screen (headline from the recommendation, our logo, our character if named). The brief lists what an artist needs: band height and angle, headline box, cut-out size and side, coverage.
- **A/B variants (R2b cards):** A = our current image and its layout. B = our layout with **only the change the test declares**:
  - "composition": exactly one composition change, the one the cited evidence is about (e.g. move the headline to the top fifth, add a cut-out on the right, switch to a framed card). Code applies it to our layout; nothing else moves.
  - "text": our layout, new text only.
  - "screen": our marketing layer over the new screen.
  - Code compares A and B. **If B differs in more than the declared change, the variant is rejected** (not warned) and the next candidate is used, in line with R2b's one-variable rule. The changed elements are outlined in a strong colour and listed in plain words ("Headline moved from the bottom to the top").
- **Optional later (decision D6):** a structured layout field in the A/B test answer so the AI states the variant layout itself (new A/B prompt version, text only, no image re-analysed).

### 5.2 Layout patterns and the typical layout per position

- **Stats by code, with n:** headline zone (top, upper, middle, lower or bottom fifth), band present and where, band tilt (level / slight / steep, measured only), coverage range (measured only), cut-out used and which side, frame or full bleed, logo corner. Per store position and overall.
- **Counting rule:** games, not images; a game counts once per position. A layout pattern is shown only when **at least 3 different competitor games** share it and it passes the existing pattern thresholds from Settings.
- **Typical layout per position:** a heatmap (how often each area is covered by a band, headline or cut-out) and a consensus wireframe (the median box per role that at least half the games use). Drawn by code.
- **Ours vs typical:** in the Patterns section each layout pattern gets the existing fits / different marker with the reason ("our headline is in the bottom fifth; 6 of 8 put it in the top fifth"). In the position table each row starts with a small "typical" cell before our image, and every image can show its wireframe (a toggle, off by default).
- **A/B evidence:** layout gaps become evidence items for the R2b candidates (with n, games and positions).

### 5.3 Small-size readability check

- Store search results and the store page show screenshots small. The tool makes a small copy (default 200 px tall for portrait, 200 px wide for landscape; an assumption, changeable in Settings) and shows it next to the numbers: headline glyph height at that size (default at least 8 px) and how many text blocks compete (default at most 2). Contrast is added once the benchmark validates it.
- Result: readable / borderline / too small, for our images, the briefs, and the competitors as a pattern ("5 of 8 headlines stay readable at small size"). Until glyph height is validated, the result is labelled "experimental" and does not drive recommendations.

### 5.4 Language fit

- For a headline box and a text in Japanese, Korean, Thai, Traditional Chinese or English: code renders the text with a system font for that script (Windows: Yu Gothic, Malgun Gothic, Leelawadee UI, Microsoft JhengHei; per script in Settings) through sharp's text rendering (which shapes Thai and CJK text), at the box's glyph height, and measures the width. Result: "fits on one line", "needs two lines" or "about 30% too long".
- The result names the font used and is always labelled "approximate": the artist's font will differ. With no font for the script, a per-script average character width is used, the result says "rough estimate" and gives no shrink percentage.
- Texts come from the recommendations (main country) and from the country step in R4 (local headlines).

### 5.5 Store history (later)

When store history exists (a future milestone in the pillars), a replaced image at the same position is compared layout to layout by code ("band moved from bottom to top, cut-out added"). A competitor that replaces an image and keeps the new one may have run a test; the change log shows this as a hint, never as a fact.

### 5.6 Where it shows

(i) popover: a small combined wireframe and 3 lines (summary, coverage, readability). Position table and reports: the typical cell, the toggle, the briefs in Recommendations and in the A/B test details. PDF: the same SVGs, added last. Share and import: section 4.

## 6. Noise controls

- Patterns use coarse zones (fifths, thirds, sides), never exact coordinates. Numbers are rounded to 5 percent unless measured.
- Only patterns shared by at least 3 different competitor games (and the Settings thresholds) become recommendations or A/B evidence. One game's habit is shown as an example only.
- Element cap per layer (default 8).
- Measured vs estimated as in the table in section 3; every layout number shows its n and whether it was measured.

## 7. Benchmark before rollout

**Needs your approval: 4 images, estimated $0.85 to $1.10. One budget for the whole benchmark, retries included, checked before every call; it stops at $1.20.**

- **Images:** Archero 2 #4, Rogue Legends #1, Legend of Mushroom #3 (landscape, one capture inside marketing art), Survivor.io Japan #4. None is a multi-capture composite; composites are covered by free synthetic and fake-model tests, and the first production batch reports its composites separately. (Option in D1: add one real composite, about +$0.25.)
- **Run:** the production prompt, schema and model copy (Fable 5.1), one image per call as the tool does today, then the measuring tool. An isolated harness (section 8, L0) writes only to `docs/samples/layout-benchmark/`, never to the library or any project.
- **Answer key, made and frozen before the run:**
  1. Written reduction rules first (which detailed elements merge into which role, how many boxes at most, how to handle nested parts), saved with the key.
  2. One Opus agent applies the rules to the 4 agent breakdowns; gpt-5.6-sol checks the result against the rules (cross-family). Saved as `docs/samples/layout-benchmark/answer-keys/<image>.json`.
  3. Reference English meanings for every headline, subline and logo are part of the frozen key (taken from the agent breakdowns).
- **Measured per image:** input and output tokens (from the CLI's usage report), time, cost, repairs, and the score.
- **Cost comparison:** total cost per image is exact. The increase is measured against the cached core answers of the same 3 images (same model; those were made with the core prompt of their date), so it is an **approximate** increase. Option in D1: a paired run of the core-only prompt on the same 4 images (about +$0.70) for an exact increase.

**Accuracy score** (per image; reported model-only and after measurement):

| Part | Points | How |
|---|---|---|
| Elements | 30 | Per layer: one-to-one matching of same-role elements by overlap (largest overlap first; overlap over union at least 0.25; each answer-key element matched at most once; extra elements count as wrong). F1 per layer, averaged. A layer empty in both = full points |
| Placement | 20 | Mean edge error of matched boxes: 3 points or less = 20, 12 or more = 0, linear |
| Text | 20 | Headline, subline, logo: character error rate of the original (5% or less = full, 30% or more = 0), 15 points; English meaning matches the frozen reference (gpt-5.6-sol, yes/no against the reference), 5 points. A text absent in both = full; present in one only = 0 |
| Measurements | 20 | Tilt (1 degree or less = full, 5 or more = 0), band edge (1.5 points or less = full, 6 or more = 0), coverage (3 points or less = full, 12 or more = 0). A part that does not apply is left out and reported as "n/a" |
| Composition | 10 | Focal point within 10% of the diagonal = 7, 30% or more = 0; first reading-order element has the right role = 3 |

**Go if all hold:**
1. Each part separately: elements F1 at least 0.7, placement error at most 6 points, text character error at most 10%, and every measurable tilt and band edge within tolerance on at least 80% of the cases.
2. Total at least 75 on average after measurement, no image below 60.
3. The core reading unchanged on the 3 images with a baseline: same screen type, composition, marketing layer present or not, and headline text.
4. Increase at most $0.07 per image on average and at most 25 seconds per image on average.
5. Valid answers for all 4 within the repair rules of 2.4; the element cap respected.
6. The measuring tool never makes a value worse than the model's by more than 2 points.
7. Experimental measurements (glyph height, contrast) are reported against the answer key; they become "validated" only if within tolerance on all images where they apply.

**If not:**
- A. Cost or time too high: capture the layout only on demand with the layout-only call, for our deck and the competitors' first 3 positions.
- B. Core reading changed: the layout moves to its own call for all images (about +$0.10 per image instead of +$0.05).
- C. Accuracy low on in-game screens only: shrink the in-game roles to 4 (hud, main-scene, panel, dialog) and rerun (about $1, new approval).

With 4 images this is a sanity gate, not statistics; the first production batch logs the same numbers and you see them before the backfill question.

## 8. Milestones

Each: implement (Opus dev agent in its own worktree branch), tests + typecheck + Biome, cross-family code review (gpt-5.6-sol), then your checkpoint. **Nothing starts before R2b and R3 are merged into master.** Order follows the pillars: analysis and reports first, PDF last.

| # | Name | Scope | Files and areas | Conflict risk | AI cost | What you see |
|---|---|---|---|---|---|---|
| L0 | Benchmark | Isolated harness: layout schema, prompt block, measuring tool v1, answer keys and rules, scoring, result page. It calls the provider directly with its own copy of the call loop; the production analysis path, records and library are not changed | New: `src/layout/schema.ts`, `vocab.ts`, `measure/*`, `wireframe-svg.ts`, `prompts/analysis/layout-block.v1.md`, `scripts/layout-bench/*`, `docs/samples/layout-benchmark/`. Changed: `src/analysis/providers.ts` (also return the token counts; additive) | Low | $0.85 to $1.10 (stop at $1.20), approved | A page with the 4 images: model-only and measured wireframes next to the agent breakdowns, the scores per part, the cost and time table; then go/no-go |
| L1 | Capture and backfill | Split validation in `validatedCall`, combined producer prompt, layout file and status, re-check after a settled dispute, measuring after each layout, approval screen cost line ("includes layout: about +$0.05 per image"), trial-file cleanup, backfill with its approval panel, Settings: element cap | `src/analysis/call.ts`, `run-images.ts`, `run-chunk.ts`, `settle.ts`, `prompts.ts`, `pipeline.ts` (rule and key test), `estimate.ts`, `src/library/layout.ts`, `src/storage/types.ts` (allow-listed cleanup key), `src/settings/schema.ts`, `fields.ts`, new `src/layout/store.ts`, `prompts/analysis/layout-only.v1.md` | **Medium**: R2b touched `estimate.ts` and `run.ts`; R4 adds its own per-image step in the same area. Land L1 before R4 starts, or rebase R4 on it | None to ship; backfill only if approved (about $5 to $7 for 58 images) | New analyses carry layouts; the backfill panel lists the images and cost and waits |
| L2 | Wireframes on screen | The drawer in the (i) popover, image detail and the position-table toggle (HTML only) | `src/view/gallery-info.ts`, `gallery-report.ts`, `gallery-report-parts.ts`, `src/analysis/report-sections.ts` | Medium: R2b and R3 changed `gallery-report.ts` and `gallery-html.ts` | None | Wireframes next to every analysed image with a layout |
| L3 | Layout patterns and typical layout | Stats with n, the 3-games rule, measured-only numbers, heatmap and consensus per position, fits / different markers, layout gaps as A/B evidence | New `src/layout/patterns.ts`, `consensus.ts`; changed `src/analysis/pattern-fit.ts`, `pattern-fit-parts.ts`, `report-data.ts`, `report-md.ts`, `src/reports/ab-candidates.ts` | Medium: all changed by R2b | None; the report's AI wording shows "out of date" and offers the usual approved text-only rerun | Layout patterns in Patterns, a typical cell per position-table row, layout gaps in the A/B tests |
| L4 | Briefs, readability, language fit | Briefs for recommended positions and A/B cards (one declared change, rejected otherwise, drawn over our screenshot), small-size check, language fit (main country now; other languages after R4) | New `src/layout/brief.ts`, `diff.ts`, `legibility.ts`, `text-fit.ts`; changed `src/reports/ab-cards.ts`, `ab-section.ts`, `src/view/report-summary.ts`, Settings fields | Medium with R4 | None | Each recommended position and each A/B card has a wireframe brief; readability and fit badges |
| L4b | PDF | The same SVGs in the PDF export | `src/view/report-print.ts`, `report-print-css.ts` | Low | None | Wireframes in exported PDFs |
| L5 | Store history hints | Layout diff on replaced images, change-log lines | `src/layout/diff.ts`, store-history code when it exists | Waits for store history | None | "Archero 2 moved its band to the top" in the change log |

## 9. Tests

- Split validation: an invalid layout never drops a valid core; repair counts as in 2.4; the cached answer is reused without a new call.
- Keys: all existing analysis keys unchanged; a new layout version is a new file; write-once (two writers, the first valid layout kept).
- Ownership checks: `textRef`, `capture`, marketing present or absent, `covers`.
- Settled dispute: a layout that no longer fits the settled reading is marked missing.
- Measuring tool: synthetic images with known values; the 4 samples as regression tests; low-quality fits save nothing.
- Drawer: SVG snapshots for the 4 samples, a composite, full-screen art and an image without marketing layer.
- Patterns: 3-games rule, one game per position, estimated values excluded from numbers, n shown.
- Briefs: B differs from A by exactly the declared change; a variant with more is rejected.
- Language fit: known strings and font give known widths; missing-font fallback gives no percentage.
- The fake provider (test helper from R2b) for the combined call and the backfill, so no test pays.

## 10. Decisions for you

What changes, in plain words:
- The benchmark and the backfill are the only things that cost money in this plan. Everything else is code.
- A layout is saved once per image and reused by every project. It becomes "outdated" only if we change the layout questions later; then the backfill offers to redo just the layouts, never the main analysis.
- If a layout fails, the main analysis is still saved; the image just shows "layout missing" and can be backfilled.

| # | Question | Recommended |
|---|---|---|
| D1 | Approve the benchmark: 4 images, about $0.85 to $1.10, stop at $1.20. Options: (a) add one layout-only call to price the backfill (about +$0.10); (b) add one real multi-capture composite (about +$0.25); (c) a paired core-only run for an exact cost increase (about +$0.70) | Approve with (a); (b) and (c) not needed now |
| D2 | Keep existing analyses as they are (layout added separately), rather than redoing all images with the new prompt (about $9 for today's 58)? | Keep them |
| D3 | Backfill layouts for old images (about $5 to $7 today): none; only our deck and the competitors' first 3 positions; or all | Our deck and first 3 positions now, the rest later if patterns need them |
| D4 | Maximum boxes per layer: 8 or 10? | 8 |
| D5 | Small-size check starting values: 200 px preview, headline at least 8 px, at most 2 competing text blocks | Yes (changeable in Settings) |
| D6 | Later, let the A/B test AI state the variant layout itself? | Not now; code-built variants first |
| D7 | Minimum number of competitor games for a layout pattern | 3 |

## Review outcome (gpt-5.6-sol, 2026-09-28)

The sandbox could not read files, so the plan, the pillars, plan-reports 3B, 3C and 11, and the relevant code were passed in directly. 20 findings. The full text is in `docs/reviews/plan-layout-wireframes-review-gpt.md`.

| # | Finding (short) | Outcome |
|---|---|---|
| 1 | A strict combined schema fails as one unit, so an invalid layout would drop a valid core | **Applied:** permissive outer shape, core and layout checked separately, core saved when the layout fails (2.4) |
| 2 | "One repair" contradicted the existing loop (2 repairs, whole answer) | **Applied:** repair rules stated exactly (2.4); benchmark criterion uses them |
| 3 | Same key would hold records with and without layouts | **Applied:** layout moved to its own write-once file keyed to the core record and the layout version (2.5). This departs from "inside the analysis record" in the brainstorm; it stays in the shared library, next to the record |
| 4 | Whole-record rewrite is unsafe for a later backfill | **Applied:** write-once layout file; the record is never rewritten for a layout |
| 5 | Producer and reviewer prompts; layout after a settled dispute | **Applied:** separate prompts and cache keys; re-check against the settled reading (2.4) |
| 6 | A/B "warn on more than one change" contradicts R2b | **Applied:** one declared change; variants with more are rejected (5.1) |
| 7 | 4 images miss composites and edge cases | **Partly applied:** synthetic and fake-model tests for composites, pure art and no-marketing images; composites reported separately in the first batch; a real composite offered as option D1(b). **Declined** as a default: it would push the benchmark over the $1 the user set |
| 8 | Matching and missing-value scoring underspecified | **Applied:** one-to-one matching, extras penalised, absent-in-both rules, per-part minimums (7) |
| 9 | Answer key not independent | **Partly applied:** written reduction rules first, frozen key, fixed reference translations, cross-family check of the key. **Declined:** two independent reductions, too heavy for a 4-image sanity gate |
| 10 | Increase in cost not measured exactly | **Partly applied:** one budget for the whole benchmark including retries; the increase labelled approximate; an exact paired run offered as D1(c). **Declined** as a default for cost |
| 11 | Text height, contrast and coverage claims too strong | **Applied:** text height and contrast "experimental" until validated; coverage labelled "up to" (3) |
| 12 | Measured vs estimated use was contradictory | **Applied:** one table of which values may be used where, minimum n (3) |
| 13 | Core and layout could disagree | **Applied:** ownership rules and checks (2.3) |
| 14 | Schema details ambiguous | **Applied:** exact field table, indexing, nulls, rotation, examples (2.2) |
| 15 | Pixel storage keys incomplete | **Applied:** typed key helpers for library and non-library projects, write-once, keep on collision (2.5, 3) |
| 16 | Backfill detection not designed | **Applied:** status current / missing / outdated, independent of the core "done" check (2.5, 2.6) |
| 17 | L0 not isolated as described | **Applied:** L0 is an isolated harness writing only to the benchmark folder; production path unchanged |
| 18 | Language fit not typographically exact | **Partly applied:** font named, always "approximate", no shrink percentage on the fallback. **Declined:** a separate shaping engine; sharp's text rendering already shapes Thai and CJK |
| 19 | Internal terms and decisions without consequences | **Applied:** plain summary above the decisions; D4 as one choice (8 or 10). Milestone codes are kept only as short handles in this plan, next to plain names; the tool's own text uses plain words |
| 20 | PDF too early | **Applied:** PDF moved to its own last step (L4b) |

## 11. User decisions (2026-09-29)

All recommended options accepted:

| # | Decision |
|---|---|
| D1 | Run the 4-image benchmark first, about $0.85 to $1.10, hard cap $1.20 for everything. The optional extras (a layout-only pricing call, a real composite, a paired core-only run) are NOT approved. |
| D2 | Keep existing analyses; the layout is its own write-once file next to the image's analysis in the shared library. |
| D3 | Backfill later, only our images and the competitors' first 3 positions. Not approved to spend yet: the exact count and cost come first (section 12). |
| D4 | At most 8 boxes per layer. |
| D5 | Small-size check with the default thresholds (200 px preview, headline at least 8 px, at most 2 competing text blocks). |
| D6 | The A/B test AI does not draw variant layouts now. |
| D7 | A layout pattern needs at least 3 different competitor games. |

## 12. Benchmark result (2026-09-29) and how the build differs from this plan

**Verdict: NO-GO, not merged.** Spent $0.92 of the $1.20 cap: 4 calls, all valid on the first call, no repairs. Result page: `docs/samples/layout-benchmark/index.html`; numbers in `results.json`, `scores.json`, `spend.json`; frozen answer keys and their rules in `answer-keys/` (checked by gpt-5.6-sol, `key-check-gpt.md`).

| Gate | Result | Numbers |
|---|---|---|
| 1. Each part | FAIL | Elements F1 0.93, placement error 1.5 points: pass. Text character error 14%: the only error is Survivor.io's logo, which the core reading does not transcribe as a text and the layout contract gives no text of its own (headlines and sublines: 0% on all 4). Band tilt and edges within tolerance 2 of 7: Survivor.io has two bands (a slab at -7.7 degrees and a purple band at -11.2); the model drew one band, and its measured top edge equals the slab's (-7.5 degrees, 0.6 points off) |
| 2. Total | pass | 84.9 on average after measuring (92.0, 90.9, 85.4, 71.1) |
| 3. Core reading unchanged | FAIL | Archero 2: headline now joins the subline ("Beyond All Limits Deep progression, maximum fun"). Rogue Legends: composition full-screen art instead of one capture, headline empty instead of "ROGUE LEGEND". Legend of Mushroom: composition one capture instead of capture inside marketing art. Survivor.io: unchanged. All 4 saved records predate the current prompt (text-reading rules, full-analysis.v8, 2026-09-29 08:00), so the layout block, the newer prompt and run-to-run variation cannot be told apart without a paired run |
| 4. Cost and time | pass | Added by the layout (its share of each answer's output tokens): +$0.050 and +12 s per image (991 output tokens). Against the measured baseline ($0.154, 28 s): +$0.076 on average, of which about $0.05 is the one-time cache write of the longer prompt on the first call (+$0.025 without it); +9 s wall |
| 5. Valid answers, cap | pass | 4 of 4 valid, at most 7 boxes per layer |
| 6. Measuring never worse by more than 2 points | FAIL | Legend of Mushroom coverage: the model's estimate was exact (40%), the measured upper bound 42.3% (2.3 points off). All band edges, tilts and snapped boxes improved or stayed within 0.6 points |
| 7. Experimental | not validated | The key has a glyph height for one image only (Survivor.io), where the tool found none |

Ways forward (each needs your decision): (a) a paired core-only run of the current prompt on the 3 changed images (about $0.45) to see whether the layout block or the newer prompt moved the core reading; (b) path B of section 7: the layout in its own call (about +$0.10 to $0.12 per image, core never touched); (c) a layout contract v2 that lets logo and badge elements carry their own text (fixes the text gate) and asks for every band separately.

**Backfill scope for D3 (counted, not spent):** 84 images with a usable analysis and no layout: 34 of ours (all countries) and 50 at competitors' positions 1 to 3 (Overgeared Hero 14, Survivor.io 8, Clash of Critters 8, Sword x Staff 6, Capybara Go 4, Archero 2 4, Legend of Mushroom 3, Path of Kings 3), out of 142 analysed images. At about $0.125 per image (measured: ~1,000 layout output tokens plus the image and core reading written to the cache) that is about $10.50 (range $8.40 to $12.60). `scripts/layout-bench/backfill-count.ts`, `backfill-scope.json`.

**Built on branch feat/layout-capture (capture is switched off by default):**
- Layout vocabulary, schema and ownership checks (`src/layout/vocab.ts`, `schema.ts`, `checks.ts`); prompt block `prompts/analysis/layout-block.v1.md` added after the producer's prompt only.
- Split validation (`SplitCheck` in `src/analysis/call.ts`, used by `src/analysis/call-images.ts`): a bad layout never drops a valid core; one repair of its own; the raw answer is cached as soon as the core is valid.
- Layout file and status (`src/layout/store.ts`), measuring tool (`src/layout/measure/`), both written once after every record save (`src/layout/capture.ts`, called from `recordWriter`); wireframe drawer `src/layout/wireframe-svg.ts`.
- Settings switch "Layout breakdown for new analyses" (`options.speed.layoutCapture`, default off after this result).
- Trial-file cleanup: `npm run cleanup-trials` removes `library/analysis/<sha>/structure-test-v0.json` only when it equals its copy in `docs/samples/`; the record reader now only reads record-named files.

**Differences from this plan (adapted to master after the speed-up and R4):**
1. The benchmark runs the production call path (split validation, image inside the request) against a scratch copy, instead of a separate copy of the call loop; tokens and time come from the per-call records the speed-up added (no provider change needed).
2. Time and cost increase: the measured baseline of `docs/analysis-speed-measurements.md`, no paired run (D1); the layout's own share is computed from each answer's output tokens.
3. Calls ran one at a time (each reserves a $0.45 ceiling under the $1.20 cap); per-call times are unaffected.
4. The layout is read from the producer's cached answer when the record is saved, and checked against the record's final reading: this also covers the settled-dispute re-check (2.4). A failed or missing layout writes no file (a write-once "missing" file would block a later backfill); its status is computed.
5. Measured values are stored at 0.1 point and 0.5 degree (scoring needs more than whole points).
6. Two measuring-tool changes after the paid run, both free and disclosed: edges are found by colour step (bands of the same brightness as the screen), and a frame or backdrop counts for coverage only outside the capture (a full-image frame had counted 100%). Neither changed a gate result.
7. The answer keys were made by a separate agent while the paid calls ran, with no access to the answers, and frozen before scoring (the plan had them frozen before the run).
8. Not built yet: the layout-only backfill call (D3 not approved), the approval-screen cost line and the (i) popover wireframe (both wait for a go), the element cap as a setting (fixed at 8, D4).

## 13. Follow-up (2026-09-29, approved: layout contract v2, paired check up to $0.60)

**Verdict: still NO-GO, not merged.** Paired check spent $0.50 of its $0.60 cap (3 calls, `spend-paired.json`, `paired.json`). Benchmark total so far: $1.42.

**Gate 3, now against a paired run** (the same 3 images, today's main-analysis prompt, same model and path, without the layout request):

| Image | With layout vs without | Without layout vs the saved record |
|---|---|---|
| Archero 2 | unchanged | headline now joins the subline (newer text-reading rules) |
| Rogue Legend | **headline "ROGUE LEGEND" becomes empty** | composition full-screen art instead of one capture |
| Legend of Mushroom | unchanged | composition one capture instead of capture inside marketing art |
| Survivor.io | (no paired run; unchanged vs saved) | unchanged |

So 3 of the 4 earlier differences come from the newer prompt or run-to-run variation, not from the layout. One remains and points at the layout request: on our own title image the logo became a layout "logo" element and the headline was left empty. One sample cannot rule out variation, but the headline feeds patterns, terminology and A/B cards, so gate 3 fails.

**Proposal: the layout in its own call (plan path B).** The main analysis runs exactly as today (its prompt and answer never change); a second, layout-only call per new image gets the image and the finished reading as text. Estimated cost per image: about 1,000 to 1,300 layout output tokens ($0.05 to $0.065) plus the image and reading written to the prompt cache (about 3,600 tokens, $0.07): **about $0.12 to $0.14 per image**, against **+$0.064** for the same-call version (measured, see below). Time: about 15 to 20 s per image in the second call; run 3 at a time next to the main analyses, it adds little to a batch's wall time. The same call serves the backfill (84 images, about $10 to $12, D3). A 4-image benchmark of the separate call would cost about $0.60 (cap $0.80).

**Gate 4, exact on the paired images:** +1,266 output tokens, **+$0.064 per image** with a warm prompt cache (+$0.059 once per batch for writing the longer prompt to the cache), **+11.9 s** per image (model writing time). Passes ($0.07, 25 s), with little headroom.

**Gate 1 (contract v2 built, not yet re-measured):** layout contract `layout.v2` and prompt block `layout-block.v2.md`: a logo or badge element carries its own text in the original script when no marketing text holds it (a headline or subline must still point at the transcribed text), and every band is asked for separately (two bands of different colour or angle are two boxes, even when they touch); at most 8 boxes per layer as before. Re-scoring the existing answers cannot show the effect: they were made with v1. Checking it needs new layout calls (Survivor.io alone about $0.35 with a cold cache; all 4 about $0.90).

**Gate 6, which coverage is right for Legend of Mushroom:** neither is exact. The key's 40% is the agent's rounded area budget (card margin ~6 + headline ~7 + pill ~4 + cat ~10 + knight ~3.5 + chick ~1.5 + blurred foreground ~8), not a pixel count; only the cat was measured (8.9%). The tool's 42.3% is an upper bound by design: cut-outs count by their rectangle (the cat's box is 34% x 68% of the image), and the blurred foreground has no box. The model's 40% equals the key's rounded estimate. The 2.3-point gap is within the key's own rounding, so this gate result says little either way; a pixel-mask coverage for the key (free) would settle it.
