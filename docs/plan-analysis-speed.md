# Plan: faster, leaner per-image analysis

Date: 2026-09-29. Status: **draft for user approval** (items 1, 2, 3, 4, 6, 7 approved; items 5 and 8 approved by the user on 2026-09-29, item 5 on condition of no accuracy loss; the 10-image benchmark pre-approved at about $1 to $2, hard cap $3). Reviewed by gpt-5.6-sol (`docs/reviews/plan-analysis-speed-review-gpt.md`; what was applied or declined is in section 14). No code yet.
Authority: `memory/PILLARS.md`. Evidence: `docs/analysis-speed-measurements.md` (all numbers below come from it).

## 0. Bottom line

- **Today:** one full analysis = 28 s and $0.154 (median), one at a time; the 39-image core check took 19 minutes.
- **After this plan (estimates, the benchmark measures them):** about 19 to 20 s and $0.10 to $0.11 per image, 3 images at a time, so the same core check in about 5 minutes and about $1.9 cheaper. Country reports gain the same speed-up, plus, in the 5-country plan, 34 separate "same picture?" questions become one bulk confirmation and 7 questions, and 6 full analyses become cheap text comparisons.
- **Where it comes from:** 3 calls at a time (the biggest win, wall time ÷ about 3); the image sent inside the request instead of a second "read the file" turn (−2.5 s, fewer tokens); an answer about 28% shorter with no field anyone uses removed (−6 s, −$0.025); colours measured by code; a pixel check that finds same-picture-new-text pairs the fingerprint misses.
- **Nothing is re-analysed.** Every existing analysis stays valid; a compatibility rule is written into the analysis key code and tested.
- **Quality gate first:** a paired 10-image benchmark: today's pipeline and the new one on the same 10 already-analysed images, scored field by field against the existing analyses (you settle the few disagreements by looking at the screenshot), plus a check that the inputs of patterns, verdict and recommendations do not change. Estimated $2.60, hard stop at $3 (inside the pre-approved cap, above the "about $1 to $2" estimate). Nothing is switched on for real runs before it passes.
- **Stays on your Claude subscription** (the `claude` CLI). A direct-API provider is described as an option for later (it needs an API key and is billed per use); it is not built now.

## 1. Item 1: several AI calls at the same time

**What changes.** The per-image loops (`src/analysis/run-images.ts` for full analyses, `src/analysis/layer-diff-run.ts` for text comparisons) run a small worker pool instead of one call at a time. Each worker takes the next image, takes its record lock (as today), logs the paid attempt (as today), runs produce → second opinion → settle for that image, saves the record immediately (as today), and takes the next. One AI job at a time stays the global rule (`locks/ai.lock`); the parallel calls live inside that one job.

**Setting.** "AI calls at the same time" on the Settings page: default 3, allowed 1 to 5. 1 gives exactly today's behaviour.

**Spending limit stays exact.** Every paid call (producer, second opinion, settle, text comparison, and each repair or retry of any of them) goes through one reservation step:
- The reservation is the call's ceiling: the highest cost seen for that step plus a margin (full analysis: $0.40; the highest measured was $0.34). It is logged durably as the "started" attempt with `estimateUsd` = the ceiling, before the call. This is the existing attempt log, so after a crash an unfinished call already counts at its ceiling, and a restarted batch reconciles "started" attempts as today.
- The check "spent + open reservations + this ceiling ≤ batch limit" and the reservation itself happen in one synchronous step in the job's single Node process (no `await` between them), so two workers can never read the same balance. Only one AI job runs at a time globally, so there is no second process.
- When the call ends, its attempt is closed with the real cost. A cost above the ceiling is logged as a warning and the ceiling for that step is raised for the rest of the batch; the next start re-checks the balance.
- No new call starts when what is left cannot fund one ceiling. `--max-budget-usd` stays as a second guard, not the main one.

**Stop means "start nothing new, finish what is running".** The button turns into "Stopping… 3 images in progress (up to $1.20 more)", the maximum being the open reservations. Calls running finish and are saved; everything finished is kept, as today. Stop during a back-off wait ends the wait at once. A separate "cancel now" (killing running calls) is not added: it would pay for answers that are thrown away.

**Errors.** The "same error N times in a row" stop counts results in the order they finish. On a rate-limit or overload answer from the CLI (detected from its error text), the pool drops to 1 call at a time for the rest of the batch, retries that image once after the wait the error names (or 60 s), and shows "The AI service asked us to slow down; continuing one image at a time."

**Prompt cache.** The first call of a batch runs alone until it returns; then the others start. Whether separate CLI processes then read the fixed part from the cache is checked in the benchmark (cache-read tokens per call); if it brings nothing, the first call no longer waits.

**Windows processes.** Each worker starts its own `claude.exe` through the existing `src/util/proc.ts` (`spawn` with `shell: false`, the executable resolved directly, never `cmd.exe`, no command string), with its own stdin/stdout and the existing timeout. A test starts 3 fake processes at once and checks each gets its own input and output, and that a timed-out process is ended.

**Progress.** "Analysing images 5 to 7 of 80 (3 at a time): Archero 2 #2, #3; Capybara Go #1", counts move when an image is saved. The (i) and the list update per image as today.

**Small fixes this needs.** Codex's temporary output file name (`src/analysis/providers.ts`) gets a random part (today pid + milliseconds can collide). Records never depended on finishing order (they are saved by image and sorted by store order); a test proves it.

**Parallel with the second opinion (when you resume it).** The review for an image runs in the same worker right after its producer call, so producer and reviewer calls of different images overlap naturally.

## 2. Item 2: remove the `claude -p` overhead

Options compared (numbers per full analysis, from the measurements):

| Option | Time saved | Cost | What it needs | Verdict |
|---|---|---|---|---|
| A. Keep `claude -p`, send the image inside the request (`--input-format stream-json` with an image block), no tools (`--tools ""`), no Read turn | about 2.5 s plus about 8,000 cached tokens a call | about −$0.01 | nothing new; stays on the subscription | **do now** |
| A+. Also stop the CLI adding its memory file, session context (e-mail) and saving a 400 KB transcript per call | small | small | CLI switches if they exist (checked in milestone S1, see the risk below) | do what the CLI allows |
| B. Direct Messages API through `@anthropic-ai/sdk` as a new provider `anthropic:` behind the same `Provider` interface | also the 2.3 s start-up and the 7% of answers written twice (the API constrains the output to the schema); image billed as plain input, not as a 2× cache write | about −$0.03 more per image | an API key; billed per use, separate from the subscription | **later, your choice**; the interface keeps it cheap to add |
| C. Claude Agent SDK in-process | none: it starts the same CLI | – | – | no |

**Also in S1:** read `usage`, `modelUsage` and `duration_ms` from the CLI's JSON result and store them with each cached answer and attempt (input, output, cache read/write tokens, seconds). Today tokens are not recorded at all; the numbers in the measurements came from the CLI's own transcripts. The layout plan (L0) asks for the same change in `providers.ts`; it is done once, here.

**Proven first, by one paid call.** Whether the installed CLI accepts an image block on stdin together with `--json-schema` and `--tools ""` is not known yet. The very first paid action of this plan is one spike call (part of the benchmark budget): `claude -p --input-format stream-json --output-format stream-json --verbose --model claude-fable-5-1 --setting-sources "" --system-prompt-file … --tools "" --json-schema … --max-budget-usd 0.40` with one stdin line `{"type":"user","message":{"role":"user","content":[{"type":"text","text":<task>},{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":…}}]}}`. The command, the CLI version and the result are saved with the benchmark. Only if it returns a valid structured answer with one model turn is the inline path built; until then today's Read path stays the default and remains as the fallback.

## 3. Item 3: prompt caching, fixed instructions first, image last

- **Per-image calls:** the order becomes schema → system prompt (with taxonomy) → fixed task text → the image last. Today the per-call file path sits in the task text; with the image inline, nothing varies before the image. The analysis cache key does not change (the task text in the key is already the fixed `DECK_TASK`).
- **Text comparisons:** fixed instructions in the system prompt; the per-image anchor text and crops last.
- **Report text steps (a measured win):** the revision call today starts with "Revise… findings" and then repeats the facts, so it re-writes 23,000 to 52,000 tokens to the cache and reads only 2,400. New order for recommendations, review and revision: the shared facts first (how we sort, computed patterns, ours vs patterns, pattern check, the screenshot lines), then the step's own instruction and material last. Saves about $0.18 (median) to $0.40 per report on the revision call. This changes those steps' answer-cache keys, so an existing report's AI text is regenerated only if you re-run that report's written parts (as with any prompt change); built reports are untouched.
- **Limit of the CLI:** it stores the per-call part (image) at the 1-hour cache price although it is never re-read; only option B can avoid that.

## 4. Item 4: images at the size the model uses

- Measured: the model copy is 882 × 1568 (about 1,790 image tokens); Fable 5.1 reads up to 2576 px, so the copy is used as sent. **No change for full analysis:** going to 1280 would save only about $0.006 to $0.012 per image and risks small Japanese, Korean and Thai glyphs.
- The image bytes are sent inline (item 2) instead of as a file path; `ModelImage.bytes()` already exists.
- Text comparisons: crops at native resolution capped at 1024 px (as designed); the small whole-image copy (384 px) is dropped when the pixel check (item 8) has already shown it is the same screen, since that copy only exists to spot a different screen.
- Test: no call ever sends an image over 1568 px on the long edge.

## 5. Item 5: shorter answers (approved on condition of no accuracy loss)

Plain-language explanation and the field-by-field usage table: `docs/analysis-speed-measurements.md` sections 8 and 9.

**Cut (never read by anything):** `captures[].description` (9.4% of the answer), `elements[].scale`, `elements[].breaksFrame`, `confidence` (2.6%).
**Derived by code:** `captureAreaPercent` = the captures' areas added up, capped at 100 (0.8%).
**Compressed, meaning kept:** `notes` only when something is uncertain or the type is "other", else empty (today always about 200 characters: about 5%).
**Not touched:** descriptions, action, mood, element descriptions and positions, text styling, text and mask boxes, headline, all enums.
**Rejected:** shorter key names, free text to fixed lists, a cap on the description (section 9 of the measurements says why).

**How records stay valid (the compatibility rule, one direction only).**
- New prompt file `full-analysis.v7` with contract `full-analysis.v5`, and `analysis-schema.v4` (the lean answer).
- The record type makes the cut fields optional: `captures[].description`, `elements[].scale`, `elements[].breaksFrame`, `confidence`. A lean record simply does not have them; nothing is invented (no default "medium", no confidence 1). `captureAreaPercent` is computed by code and stored with the note "computed". Every consumer was checked not to read the cut fields (measurements section 8); a code test proves it (section 11).
- `src/analysis/pipeline.ts` gets `acceptedKeys(spec)`: the lean pipeline accepts its own key and the key of today's pipeline, because today's records are a complete superset of the lean answer. The reverse is never true: a project still on today's settings does not accept lean records (its key differs, as today). Each record keeps its own key and `pipeline` block, so the library always knows which kind it is. The record lookup (`src/analysis/record-store.ts`) treats a record under an accepted key as current, so all 86 existing analyses stay reused and shared; nothing shows as out of date. Tests cover both directions and two projects with different settings sharing the library.
- The (i) popover shows the note only when it is not empty; "Measured colours" stays.

## 6. Item 6: don't ask the model for facts code measures

- **Main colours per layer** (about 10% of the answer): code measures them with the existing colour tools (`src/analysis/image-facts.ts`, `colours.ts`): screen colours from the pixels inside the captures minus the text/mask boxes (the whole image for pure art); layer colours from the pixels inside the mask and text boxes. Names come from the tool's colour list, hex values are exact.
- **Mask colour hex:** measured as the median colour inside the mask box; the model keeps the mask's colour name and shape.
- **Capture share:** item 5.
- **Kept with the model:** text fill and outline colours (text strokes are too thin to measure reliably), orientation of captures (the boxes are not precise enough).
- **Stored apart from the analysis, with its own version.** Measured layer colours are an image-level fact (`colour-measure.v1`), kept next to the image facts and keyed by the image and the analysis record whose boxes it used. The analysis record is not changed; old records keep the model's colours for display only.
- **One source for stats:** the colour patterns (`patterns.ts`, `pattern-fit.ts`, `ours-vs.ts`) and the screenshot lines for the recommendation prompt use the measured colours for all images, old and new, so model and code colours never mix. Measuring is free and runs for all analysed images when the feature ships.
- **What becomes out of date, exactly:** analysis records: none. Reports: the deterministic parts are rebuilt as always; a report's AI-written parts are marked out of date when their input changes, which the existing answer cache already detects (it is keyed by the full input). Because the colours in the screenshot lines change, every report built before the switch will show its AI parts as out of date; re-running them is the usual approved text-only step (about $0.5 to $1 per report). This is listed on the approval screen of S4 before the switch, and you can choose to switch colours later.
- **Gate:** the benchmark compares measured colour families with the answer key. Below 80% agreement, colours stay with the model (item 6 no-go for colours only).

## 7. Item 7: text comparisons with only the text areas

The text comparison (`src/analysis/layer-diff.ts`) already sends crops and the anchor's layer as JSON; it has never run yet. Changes:
- The crop is the union of the anchor's text boxes and the areas the pixel check found changed (item 8), padded, instead of one box around the whole layer. Several small crops when the areas are far apart (at most 3).
- The whole-image copy (384 px) is dropped when the pixel check has shown the same screen.
- The anchor JSON keeps only what the comparison needs: each text (role, text, language, position) and the headline. Masks, elements and the screen description are sent only when the pixel check found changes in those areas; otherwise code fills "band: none" and "elements: none".
- Model stays Opus 5.5 as already approved for the text comparison (PILLARS: "a lighter model is OK here"; it is not Sonnet). Key: `CROP_VERSION` becomes `layer-crop.v2`; no text comparison exists yet, so nothing is invalidated.
- Checked on real data in S5 before it is used: 4 Japan images that are same-picture-new-text pairs and were fully analysed in the stopped Japan run (Rogue Legends Japan #4, #5, Capybara Go Japan #1, one Clash of Critters) are compared as text comparisons, with their full analyses as the answer key (every Japanese text found, character error ≤ 5%, headline right). About $0.15 to $0.25; it needs your approval then (it is not part of the pre-approved $3).

## 8. Item 8: near-duplicates across countries (approved)

Plain-language explanation, numbers and risks: `docs/analysis-speed-measurements.md` sections 7 and 10.

**Pixel check (code, free, new `src/store/pixel-diff.ts`).** For a country image and its candidate anchor (same shape within 3%, fingerprint within 14 bits): both scaled to 320 px, grey; a pixel counts as changed above 40/255; result = share of changed pixels inside and outside the anchor's text and mask boxes (+3% margin), plus the changed areas as boxes. Versioned `pixel-check.v1`, cached per image pair.

**Thresholds (Settings, with these defaults):**

| Outside the text/band boxes | Fingerprint | Treated as | Asked? |
|---|---|---|---|
| ≤ 0.5% | ≤ 14 bits | same picture, new text: text comparison | no |
| 0.5% to 5% | ≤ 14 bits | same screen, in-game text also translated: text comparison with the changed areas in the crop | yes (default answer "same") |
| > 5% | ≤ 10 bits | different picture: full analysis | yes |
| > 5% | 11 to 14 bits | different picture: full analysis | no |
| anchor not analysed yet | – | today's rules (fingerprint only) | as today |

**You stay in control: suggest first, decide automatically only when you say so.** The evidence so far has 34 answered pairs, all "same"; it has too few known different pairs to prove the rule never calls a different picture "same". So the rule starts in **suggest** mode:
- The R4 question groups the pairs the pixel check calls "same picture, new text" into one block, "27 pairs changed only in the text or band (outlined): Confirm all / review one by one". One click answers them; any pair can be opened and marked different. The other pairs are asked one by one as today, with the changed areas outlined.
- The 6 images that would move from full analysis to text comparison are in the same block (they are listed as "moved to text comparison by the pixel check"), so nothing moves without your confirmation.
- After S5, the check is validated on labelled pairs: the answered "same" pairs, the pairs already known to be different (e.g. Survivor.io #3/#6 across countries: 22% to 26% changed outside), and made-up test pairs (a badge or a small character added on the band, a price tag changed outside it, a recoloured band). The false "same" and false "different" counts are shown in the Settings help text. Only then can you switch the rule to **automatic** in Settings; in automatic mode the approval screen still lists "Decided by the pixel check: 27 pairs (show)", and each can be re-opened.
- Your saved answer for a pair always wins over the rule, in both modes.

**Where it plugs in.** `tierScope` (`src/reports/anchors.ts`) takes the pixel verdict as one more input (in suggest mode only after your confirmation); identical-file reuse and the "main-country version first" rule are unchanged. `doubtfulInPlan` and `matchCheck` (`src/reports/match-check.ts`) get the grouping and the outlines. A Settings switch turns the check off (fingerprint only, as today).

**Expected effect in the 5-country plan:** 34 separate questions become 1 bulk confirmation plus 7 separate questions; after confirmation 6 full analyses become text comparisons.

## 9. Quality benchmark (pre-approved: hard stop $3)

**What it can and cannot show.** It is a limited acceptance check on 10 images, not a statistical proof. "No accuracy loss" rests on two legs: (a) a free code test proving that the fields we cut feed nothing downstream (section 11), and (b) this benchmark showing that the fields we keep are not read worse with the lean prompt and the new call path.

**Images (10, already analysed with today's contract, stratified):** 2 of ours (Rogue Legends), 2 multi-capture composites, 2 full-screen art (one title with logo), 1 landscape, 2 with Japanese text, 1 heavy-band screen.

**Arms, paired on all 10 images.**
- Control: today's pipeline re-run on the 10 (about $0.155 each). Fable does not answer identically twice; this is the noise floor, image by image.
- New: lean prompt and schema (5, 6) with the image inline in one turn (2, 3, 4), 3 calls at a time (1) (about $0.10 each). The first New call is the CLI spike of section 2; if the spike fails, New runs on today's Read path and item 2 is reported as not proven.
- Estimate: $1.55 + $1.05 = about $2.60; the harness stops at $3.00 including repairs. This is above the "about $1 to $2" you pre-approved but inside the $3 cap; the cheaper variant (Control on 6 images, about $2.0) gives a weaker noise floor. The text-comparison check moved to S5 (section 7) with its own approval.
- Model roles: Fable 5.1 for both arms; no Sonnet; no GPT call in the benchmark.

**Answer key and adjudication.** The existing final records are the starting key. Where Control, New and the key do not all agree on a scored field, the result page shows the screenshot with the three answers side by side (which answer is which is hidden) and you pick the right one or "several are fine"; your pick becomes the key for that field. Expected: a handful of fields.

**Score, per image, field by field.**
- Critical (zero regressions allowed): category (composition + screen type), marketing layer present, every marketing text (normalised, character error ≤ 5%), headline, the logo tag and the art message (derived by code), text language.
- Standard: subtype, number and types of captures, capture orientation and framing, text roles, mask count, shape and location, element kinds, relation to screen.
- Numbers: coverage, capture share and capture areas within ±10 points; text and mask boxes overlap (IoU) ≥ 0.5 (they place the text-comparison crops).
- Colours (item 6): measured colour family = the key's family for the first screen colour, the first layer colour and each mask.
- Free text (description, action, mood, element descriptions): shown side by side for your reading, not machine-scored; the downstream check covers their use.
- Coverage: the page lists how many times each field occurred (a field seen once or never is marked "not tested").

**Downstream check (code, free).** For each arm, the 10 readings replace the old ones in a copy of the core-check data, and the tool builds the normalised inputs of every downstream step: categories, image tags, pattern stats, the pattern check (verdict, key points, fits/different per pattern), ours vs patterns, the screenshot lines for the recommendation prompt, terminology inputs and the text-comparison anchors. The objects are compared field by field: New vs key and Control vs key.

**Go/no-go gates.**
1. Critical fields: New has no error on any image where Control is right (after your adjudication).
2. Standard fields and numbers: per field group, New's errors ≤ Control's errors + 1 (on 10 images).
3. Downstream inputs: every difference between New's and the key's objects must also appear in Control's (model variation), or come from the measured colours (approved change). Any other difference is a no-go for the field group that caused it.
4. Colours: measured family agreement ≥ 80%, else colours stay with the model.
5. Speed and cost: New median ≤ 22 s per call and ≤ $0.12 per image; 3 at a time gives at least 2.5× Control's images per minute; no answer fails validation twice; cache-read tokens show whether parallel calls share the cache.

**No-go paths.** Each cut is a separate switch in the lean schema: a failed group gets its fields back and only the affected images are re-run, inside the $3 cap. A failed spike keeps the Read path. Results page: `docs/samples/speed-benchmark/` with the 10 images, the scores per group, both arms side by side, the adjudication, and the time and cost table.

**After launch (optional, needs your approval then):** a shadow check on the next 10 new images (both prompts, about $1.5) before calling "no loss" settled.

## 10. Milestones

| # | What | Main files | Cost | You see |
|---|---|---|---|---|
| S0 | Pixel check module; token and time recording from the CLI's JSON result (stored with answers and attempts); tests | new `src/store/pixel-diff.ts`; `src/analysis/providers.ts`, `call.ts`, `attempts.ts` | free | nothing yet |
| S1 | Worker pool with reservations, stop and back-off; Settings field; Codex temp names; prompt order for report text steps; the inline-image path behind a switch (off) | `run-images.ts`, `layer-diff-run.ts`, `call.ts`, `providers.ts`, `synthesis.ts`, `src/settings/schema.ts`, `fields.ts`, progress text | free | Settings "AI calls at the same time" (default 1 until S4) |
| S2 | Lean prompt and schema behind a switch (off), optional cut fields, accepted keys, measured layer colours (`colour-measure.v1`) | `prompts/analysis/full-analysis.v7.md`, `schema.ts`, `pipeline.ts`, `record-store.ts`, `records.ts`, `colours.ts`, `patterns.ts`, `pattern-fit.ts`, `ours-vs.ts`, `synthesis.ts`, `gallery-info.ts` | free | nothing yet |
| S3 | Benchmark harness and run: spike first, then the paired arms; result page with adjudication | `scripts/speed-bench/*`, `docs/samples/speed-benchmark/` | about $2.60, stop $3 (pre-approved) | the result page; you adjudicate disagreements; go/no-go |
| S4 | Switch on what passed: pool default 3, inline image, lean answer, measured colours. The approval screen lists which reports' AI parts become out of date | settings defaults, pipeline | free | faster, cheaper analyses; notes only when useful; measured colours |
| S5 | Pixel check in the planner and R4 (suggest mode), text-comparison crops, the 4-image text-comparison check, labelled-pairs validation | `src/reports/anchors.ts`, `match-check.ts`, `layer-diff.ts`, `layer-diff-schema.ts`, approval view | free; the text-comparison check about $0.15 to $0.25 with its own approval | one bulk confirmation instead of 27 questions, changed areas outlined; fewer full analyses in country plans |

Cross-family review (GPT) of the code after S2 and after S5, as usual. Commit and push after each milestone with tests passing.

**Acceptance criteria for every milestone (checked in its review):** every AI run still shows the exact images and counts per tier and waits for approval; runs stay resumable (a crash mid-pool leaves only "started" attempts, which the next run reconciles, and never re-pays a saved image); the shared library behaves as today when two projects use it (record locks unchanged); all model access through the `Provider` interface, storage through `Storage`, jobs through the job runner (no direct filesystem calls in feature code); every button gives immediate feedback and progress; files ≤ 300 lines, TypeScript strict, Biome clean, `npm test` green.

## 11. Tests (all free, no AI)

- Pool: with a fake provider, N images finish with exactly the records and attempts of the one-at-a-time run; simultaneous starts never pass the spending limit (slow, failing and over-ceiling fake calls, repairs and retries included); a crash mid-pool leaves "started" attempts counted at their ceiling and the next run does not re-pay saved images; Stop during producer, review, settle, back-off and retry starts nothing new and saves what runs, with the "up to $X more" shown; the same-error stop works in finishing order; a rate-limit error drops to one at a time and retries once; concurrency 1 behaves exactly like today.
- Processes: 3 fake processes at once through `proc.ts` (no shell, own stdin/stdout, timeout ends the process); Codex temp names never collide.
- Provider: the CLI arguments of the inline path (no Read tool, stream-json input with an image block), usage and duration parsed and stored; fallback to the Read path.
- Keys: the lean pipeline accepts today's records; a project on today's settings does not accept lean records; two projects with different settings share the library correctly; the answer-cache key of a per-image call is unchanged by S1.
- Cut fields feed nothing (the free leg of "no loss"): for every fixture record, removing `captures[].description`, `scale`, `breaksFrame`, `confidence` and recomputing `captureAreaPercent` gives identical categories, tags, pattern stats, pattern check, ours-vs, screenshot lines, terminology inputs, text-comparison task, compare and settle results.
- Colours: measured per-layer colours on fixture images (band, pure art, composite); provenance and version stored.
- Pixel check: identical pictures → 0; a changed band → inside only; a changed capture → outside; a badge added on the band; a tiny change outside; different sizes and shapes; thresholds; the user's saved answer winning; suggest vs automatic mode.
- Planner: in suggest mode nothing moves before confirmation; after confirmation the 6 fixture pairs become text comparisons; `doubtfulInPlan` groups the suggested pairs.
- Images: nothing sent above 1568 px; crops ≤ 1024 px.
- Report steps: the new prompt order keeps every input section (snapshot of the parts).

## 12. Conflicts with work in progress

- **Layout wireframes plan (`docs/plan-layout-wireframes.md`, draft):** it adds a layout block to the same per-image call (more output: +10 to 25 s), changes `validatedCall` (split validation), `providers.ts` (token counts) and `pipeline.ts` (an "add-on never changes the key" rule, with the layout in its own versioned write-once file and its own current/missing/outdated status). Proposal: land S0 to S2 first; token recording is done once in S0 and reused by the layout benchmark; the layout block then rides on the lean prompt and its benchmark runs on the lean prompt. The two key rules are compatible: the layout's status comes from its own file, never from the analysis key, so a lean or old record never looks as if it had a layout. Both rules are written and tested together in `pipeline.ts`.
- **Text comparison work in flight (the layer-diff agent) and R4:** item 7 and S5 touch `layer-diff.ts`, `layer-diff-run.ts`, `layer-diff-schema.ts`, `anchors.ts` and `match-check.ts`. S1's pool change to `layer-diff-run.ts` and all of S5 start only after that work is merged; S0's pixel module has no dependency on it.
- **Terminology work in flight:** reads texts and headlines, which do not change.
- **Settings page:** S1 adds one field, S5 two thresholds, a mode and a switch; all in `src/settings/schema.ts` and `fields.ts`.

## 13. Decisions for you

1. Benchmark: paired on all 10 images (about $2.60, stop $3; recommended) or Control on 6 (about $2.0, weaker).
2. Pool default of 3 after the benchmark (1 to 5 in Settings).
3. Measured colours: switch on with S4 (every earlier report's AI parts then show as out of date until re-run), or later.
4. Pixel check: suggest mode with thresholds 0.5% and 5%; automatic mode only after the labelled-pairs validation and your switch.
5. Option B (direct API, billed per use with an API key): later or never. Not needed for this plan.

## 14. Review by gpt-5.6-sol

Review: `docs/reviews/plan-analysis-speed-review-gpt.md` (verdict: "no-go as written"; 12 findings, 11 major). All applied or partly applied except finding 9:

| # | Finding | Decision |
|---|---|---|
| 1 | Spend cap not provably exact under concurrency | **Applied:** one synchronous reserve step in the single job process, reservation = step ceiling logged as the "started" attempt (crash-safe, reconciled as today), all repairs and retries included, over-ceiling costs raise the ceiling (section 1) |
| 2 | Stop is "drain", not immediate | **Applied:** defined as start nothing new, finish running calls; shows "up to $X more"; no kill action (section 1) |
| 3 | Inline-image path speculative, sequenced before the spike | **Applied:** exact command and envelope written; the spike is the first paid action; the path ships behind a switch and only goes on after it passes (sections 2, 9, 10) |
| 4 | Windows process handling missing | **Applied:** through `proc.ts`, no shell, per-process stdin/stdout, timeout; tested (section 1, 11) |
| 5 | Cache-key compatibility unsafe; fabricated defaults | **Applied:** one-direction rule, cut fields optional and absent (no invented values), record keeps its own key and pipeline; tests both directions (section 5) |
| 6 | Colour recomputation vs "records stay valid" | **Applied:** measured colours stored apart with their own version; records unchanged; stated exactly which reports go out of date, shown before the switch, and colours can be switched later (section 6) |
| 7 | Benchmark cannot prove no loss | **Applied:** paired arms on all 10; your blind adjudication of disagreements; zero-regression gate for critical fields; field coverage shown; named a limited acceptance check with an optional post-launch shadow check (section 9) |
| 8 | Downstream gate weaker than the requirement | **Partly applied:** downstream inputs are compared field by field; a free code test proves the cut fields change no downstream input at all; with fresh model calls, byte-identical inputs are impossible (Control itself differs), so a difference is accepted only when Control shows the same difference or it is the approved colour change (section 9 gate 3) |
| 9 | Text comparison should use Fable 5.1, not Opus 5.5 | **Declined:** the text comparison reads a crop against a fully analysed anchor, which PILLARS names as the tier where "a lighter model is OK"; the rules forbid Sonnet, not Opus; Opus 5.5 is the model the approved R4 plan already uses. The S5 check on 4 Japan images tests it |
| 10 | Thresholds fitted, not validated for false "same" | **Applied:** suggest mode by default (one bulk confirmation), labelled-pairs validation including made-up badge and tiny-change pairs, automatic only by your switch (section 8) |
| 11 | Cache warm-up asserted | **Applied:** measured in the benchmark; dropped if it brings nothing (section 1) |
| 12 | Governing constraints not acceptance criteria; layout conflict understated | **Applied:** acceptance criteria per milestone (section 10); layout status from its own file, never from the analysis key (section 12) |
