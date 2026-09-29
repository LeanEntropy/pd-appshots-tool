# Analysis speed: measurements, and what items 5 and 8 change

Date: 2026-09-29. Free measurement only: no AI calls, nothing written to `workspace/`.
Sources: the 108 `claude -p` session transcripts the tool left in `~/.claude/projects/C--projects-ai-pd-appstore-tool/` (per-turn token usage, timings, cost, the exact system prompt and tool definitions), the 107 cached model answers in `workspace/_library/objects/`, the paid-attempt logs in `workspace/_library/attempts/`, the frozen 5-country plan `workspace/rogue-legend/state/approved/analysis-30fe…json`, image facts and model copies in `workspace/_library/images/`, and the picture-match answers in `workspace/rogue-legend/state/picture-checks.json`. Prices are the ones the records imply, which match the published rates: Fable 5.1 $10 in / $50 out / $20 cache write (1-hour) / $0.25 cache read per million tokens; Opus 5.5 $4 / $20 / $8 / $0.20.

## 1. Bottom line

- **Time goes into the model writing its answer, one image at a time.** A full analysis takes 28 s (median; 36 s p90). About 21 s of that is the model writing about 1,800 output tokens at about 77 tokens a second. Calls run strictly one after another: in the 39-image core check, 97% of the 19 minutes was spent inside model calls.
- **Money goes into output (59%) and cache writes (38%).** A median full analysis costs $0.154: $0.091 output, $0.059 for writing the image and per-call text to the 1-hour cache at double price (that copy is never read again), $0.004 for the rest.
- **`claude -p` adds about 5 s and a second model turn to every call.** The CLI starts in about 2.3 s; then the model spends a whole turn (about 2.5 s) calling the Read tool to open the image file. It also resends about 7,900 tokens of fixed context twice per call (cheap, cached), of which about 3,400 are the CLI's own additions (hidden agent instructions, the Read tool, reminders including the user's e-mail address and `MEMORY.md`), not our prompt.
- **7% of calls answer twice.** The CLI's JSON-schema check is a tool, not constrained output. In 6 of 86 calls the first answer missed a required field (`strokeColour`) or used a wrong enum value, and the model wrote the whole answer again (+15 s, +$0.09 each).
- **The answer is 34% free text and 19% colours.** Largest fields: screen description 11.5%, capture descriptions 9.4% (never read by any code), notes 7.5% (only shown in the (i) popover), colours in every form about 19%.
- **Near-duplicates across countries are almost never true duplicates.** None of the 101 same-shape near-identical pairs is pixel-identical; every one has changed text (0.6% to 43% of pixels). "Reuse without AI" would save nothing and would put English text on Japanese images. The gain is a pixel check that moves 6 images of the 5-country plan from full analysis to the cheap text comparison and pre-answers 27 of the 34 doubtful-match questions (you confirm them in one click).

## 2. Per call, by step

Median / p90 per call. "Cache read" and "cache write" are input tokens served from or written to the prompt cache.

| Step | Model | n | Wall time s | Input (uncached) | Cache read | Cache write | Output | Cost $ |
|---|---|---|---|---|---|---|---|---|
| Full analysis (1 image per call) | Fable 5.1 | 86 | 28 / 36 | 34 / 34 | 14,865 / 15,050 | 2,927 / 4,492 | 1,816 / 2,435 | 0.154 / 0.235 |
| Second opinion (paused since 09-27) | gpt-5.6-sol (Codex) | 18 | about 22 / 28 | not recorded | – | – | – | not recorded |
| Settle a disagreement | Opus 5.5 | 3 | 10 / 11 | 4 | 8,678 / 8,822 | 5,381 / 8,298 | 588 / 609 | 0.057 / 0.080 |
| Text comparison (layer diff) | Opus 5.5 | 0 | never run yet | | | | | |
| Pattern interpretation | Opus 5.5 | 5 | 19 / 37 | 2 | 0 / 1,589 | 8,890 / 14,977 | 1,771 / 2,361 | 0.109 / 0.167 |
| Recommendations | Opus 5.5 | 6 | 57 / 89 | 2 | 1,559 / 47,452 | 19,285 / 50,598 | 6,249 / 10,910 | 0.280 / 0.621 |
| Revised recommendations | Opus 5.5 | 5 | 59 / 70 | 2 | 2,410 / 3,304 | 23,280 / 52,273 | 6,674 / 7,864 | 0.322 / 0.576 |
| A/B tests | Opus 5.5 | 1 | 36 | 2 | 0 | 9,740 | 4,032 | 0.159 |

Second-opinion times are the gap between the stored producer and reviewer answers (Codex runs `--ephemeral`: no token or cost record). No text comparison has run yet: the Japan report was stopped after 28 full analyses and its 121 planned text comparisons never started. The paid-attempt log agrees with the transcripts: attempt time minus call time is under 1 s, so the tool's own work between calls is negligible. Full analyses are sent one image per call (the deck-per-call option is not in use).

## 3. Where one full analysis spends its time (median 28 s)

| Part | Seconds | Share |
|---|---|---|
| CLI start-up (process start to first request) | 2.3 | 8% |
| Turn 1: the model asks to read the image file (Read tool round trip) | 2.5 (p90 7.2) | 9% |
| Turn 2: the model writes the answer (1,816 tokens at 77 tokens/s; p10 71, p90 82) | 21.0 (p90 26.5) | 75% |
| Process exit, JSON parsing, validation, saving | about 2 | 8% |

**Waiting vs parallelisable.** Every per-image call (full analysis, second opinion, settle, text comparison) is independent; only the budget check and the per-image record lock connect them. Today they run one after another: core check 39 images = 1,152 s wall, 1,116 s inside calls (97%); Japan report 28 images = 867 s wall, 837 s inside calls. The report text steps (patterns → recommendations → review → revision → A/B tests) are a real chain of about 3 to 4 minutes per report and stay sequential.

## 4. What the input of one full analysis is made of

Per call the model processes about 17,800 input tokens (median): the fixed context twice (once per turn, 2 × about 7,900, cached) plus about 2,000 new tokens.

| Part | Tokens (approx.) | Whose |
|---|---|---|
| Our system prompt (full-analysis.v6 with the taxonomy), 8,272 characters | about 2,100 | ours |
| The answer schema (sent by the CLI as a `StructuredOutput` tool), 8,444 characters | about 2,400 | ours (needed in any design) |
| The Read tool definition, 2,459 characters | about 600 | CLI |
| CLI reminders (environment, model, token count, budget, `MEMORY.md`, session context with the e-mail address, date) plus hidden agent instructions | about 2,800 | CLI |
| Task text | about 100 | ours |
| **Turn 1 total (cached)** | **7,905** | |
| The image (882 × 1568, about 1,800 tokens) plus the Read call and a budget reminder | about 2,000 (written to cache) | |

The CLI floor was measured directly: a ping with a 78-character system prompt and no tools cost 845 input tokens. `--setting-sources ""` does not stop the auto-memory file and session context from being added.

Cost split of the median call: output $0.091 (59%), cache write $0.059 (38%), cache read $0.004 (2%), uncached input about $0. The cache write is the image and per-call text stored at the 1-hour price (2× input); it is never read back, because each image is sent once.

## 5. Images sent vs originals

| | Median | Notes |
|---|---|---|
| Original download | 1,539 KB, e.g. 1242 × 2208 PNG | 85 images with a model copy |
| Model copy sent today | 266 KB JPEG q90, long edge 1568 (882 × 1568) | `MODEL_COPY` in `src/analysis/pipeline.ts` |
| Image tokens at 1568 | about 1,790 | Fable 5.1 reads up to 2576 px, so the 1568 copy is used as sent (no hidden downscale, no wasted pixels) |
| Image tokens at 1280 | about 1,200 | would save about 600 input tokens ($0.006 to $0.012) per call: small against output, and a risk for small Asian glyphs |

Text comparisons (not yet run) are designed to send the marketing-layer crop at up to 1024 px plus the whole image at 384 px.

## 6. What the answer is made of (86 cached full analyses, 2,902 characters per image)

Output tokens run at about 0.6 per character. Key names are 28% of the characters, values 63%, punctuation 9%.

| Field group | Share of answer | Used where (section 8) |
|---|---|---|
| `screenshot.description` | 11.5% | (i) popover, recommendation prompt, text-comparison anchor |
| `captures[].description` | 9.4% | nowhere |
| `notes` | 7.5% (206 characters median, never empty) | (i) popover only |
| `screenshot.action` + `atmosphere` | 6.3% | (i) popover, recommendation prompt |
| Colours: screenshot and layer main colours, mask colours, text colour and outline, element colours | about 19% | patterns, ours-vs, pattern fit, (i), prompts |
| Element details (`what`, `position`, `pose`, `colours`, `kind`) | about 12% | image tags (logo, hero), patterns, prompts, (i) |
| `elements[].scale` + `breaksFrame` | 2.0% | nowhere |
| `confidence` | 0.6% | nowhere (only range-checked) |
| All boxes (`region` on captures, masks, texts, elements) | about 8% | text and mask boxes place the text-comparison crop; capture and element boxes are only clamped |
| Everything else (types, enums, texts, headline, percentages) | about 23% | needed |

## 7. Near-duplicates across countries (the 5-country plan: Japan, South Korea, Taiwan, Hong Kong, Thailand)

327 country images. Each was matched with the closest main-country (US) image of the same game by perceptual hash, then compared pixel by pixel (320 px, grey, a pixel counts as changed above 40/255), and the changed pixels were split into inside vs outside the anchor's analysed text and band boxes (+3% margin).

| Group | Images | What the pixels show |
|---|---|---|
| Same file as the US image (byte-identical) | 87 | nothing changed; reused today |
| Same shape, hash within 14 bits: unique image–anchor pairs | 101 | none is a pure re-encode: the smallest change is 0.6% of pixels (a translated title) |
| of which: changes only inside the text/band boxes (≤ 0.5% outside) | 70 | same picture, new text |
| of which: 0.5% to 5% changed outside the boxes | 20 | same screen, in-game UI text translated too (e.g. skill-card labels) |
| of which: over 5% changed outside | 11 | a different picture (or anchored to another country's copy) |
| Different shape or hash over 14 bits | 117 | different pictures |

Two findings drive item 8:

1. **Missed text comparisons.** 6 images are planned as full analyses only because their hash is 7 to 14 bits away (over today's 6-bit limit), although every changed pixel lies inside the anchor's text/band boxes: Rogue Legends Japan #4, #5, #6, Capybara Go Japan #1, Capybara Go South Korea #1, Path of Kings South Korea #5. Our own Japanese deck is also in a different order (Japan #4 = US #5).
2. **Doubtful questions.** The plan's text comparisons 4 or more bits from their anchor (the ones the approval asks about) are 34 unique pairs. The user answered "same screen" to all 34. The pixel rule would have answered 27 of them itself (all changes inside the text/band boxes) with zero disagreement; the other 7 have in-game text translated outside the band (e.g. Archero 2 Thailand #3: 8% outside), and the user still called them the same screen.

## 8. Where each answer field is used

"Needed" = read by code, stats, reports or AI prompts. "Shown only" = displayed in the (i) popover. Import/export copies whole records, so every field travels with a shared project. Store history is not built yet. The layout plan (`docs/plan-layout-wireframes.md`) refers to texts, captures (by index), `marketingLayer.present` and the headline, and brings its own boxes.

| Field | Read by | Class |
|---|---|---|
| composition, screenType, subtype | categories, patterns, pattern fit, ours-vs, image tags, compare/settle, recommendation prompt, (i) | needed |
| captures[].orientation, screenType, subtype, areaPercent, framing | orders, patterns, ours-vs, compare, (i) capture lines, recommendation prompt | needed (framing: (i) + prompt) |
| captures[].region | only clamped | unused today; kept (cheap; the layout plan refers to captures) |
| captures[].description | nothing | **unused** |
| captureAreaPercent | patterns (proportion), compare, title-screen mapping | needed; code can compute it from the captures |
| screenshot.description | (i), recommendation prompt, text-comparison anchor | needed |
| action, atmosphere | (i), recommendation prompt | needed (prompt input) |
| screenshot.mainColours, marketingLayer.mainColours | patterns, ours-vs, pattern-fit colour stats, (i), prompt | needed; code can measure them per layer from the boxes |
| marketingLayer.present | categories, patterns, ours-vs, pattern fit, compare/settle, (i) | needed |
| coveragePercent | (i), compare note, prompt | needed |
| masks shape, colour, location | patterns, pattern fit, ours-vs, (i), prompt | needed |
| masks and texts region | text-comparison crop | needed |
| texts text, role, colour, outline, font, size, position | terminology, image tags, patterns, prompt, (i) | needed |
| texts language | localisation (country reports) | needed |
| elements kind, what, position, pose, colours | image tags (logo/hero), patterns, prompt, (i) | needed |
| elements scale, breaksFrame | nothing | **unused** |
| elements region | only clamped | unused today; kept (cheap) |
| relationToScreen | (i) only | shown only |
| headline | patterns, terminology, A/B cards, localisation, text comparison, compare/settle, reports | needed |
| confidence | nothing | **unused** |
| notes | (i) only; required when the type is "other" | shown only |

Dominant colours are already measured by code for every image (`src/analysis/image-facts.ts`, shown as "Measured colours" in the (i) popover), but for the whole image, not per layer.

## 9. Item 5 in plain words: shorter answers (approved on condition of no accuracy loss)

**What we gain.** Output is 59% of the cost and 75% of the time of a full analysis, so every 10% shorter answer saves about 2 s and $0.009 per image. The cuts below shorten the answer by about 28% (about 500 tokens): about 6 to 7 s and about $0.025 less per new image (40 images: about 4 minutes and $1 less).

| Change | Answer saved | What you would see | Existing records |
|---|---|---|---|
| Stop asking for capture descriptions (never read) | 9.4% | nothing changes anywhere | stay valid |
| Stop asking for element scale, "breaks the frame" and confidence (never read) | 2.6% | nothing changes | stay valid |
| Code computes the capture share from the captures (already required to agree within 15 points) | 0.8% | same number, now always consistent | stay valid |
| Notes only when something is uncertain or the type is "other" (today always about 200 characters) | about 5% | the (i) popover shows a note only when there is something to say | stay valid |
| Main colours measured by code per layer instead of named by the model (this is item 6) | about 10% | colour names come from the tool's colour list ("golden yellow" may read "yellow"); hex values become exact | stay valid; colour stats are recomputed by code for all images, so old and new never mix |

**Kept as is, because cutting would lose something:** the screen description, action and mood (the recommendation prompt reads them), the element descriptions and positions, the text styling, the boxes of texts and masks (they place the text-comparison crops), the headline.

**Considered and rejected under "no accuracy loss":** shorter key names (28% of characters but only about 5 to 8% of tokens, most names are one token; risk the model fills fields less carefully); free text to fixed lists (font style, element position: "over the band's right end" says more than "bottom-right"); a length cap on the screen description (the recommendation prompt uses it).

**Cache keys.** A different answer shape changes the prompt and schema versions, which today changes every analysis key and would make all 86 existing analyses look out of date. The plan adds one rule: the lean answer is expanded by code into today's record shape, and the lean pipeline accepts today's records as valid. No existing image is re-analysed; old records keep their extra fields, which nothing reads.

## 10. Item 8 in plain words: near-duplicates across countries (approved)

**What it is.** When a game uses the same picture in two countries and only the text changes, the tool already compares only the text (the "text layer only" tier). It decides "same picture" with a picture fingerprint (perceptual hash) that tolerates at most 6 of 64 bits, and asks you about pairs between 4 and 10 bits.

**What the data says.** A fingerprint alone cannot tell "same picture, new text" from "different picture": translated headlines move it by up to 14 bits, while some different pictures are closer. No near-identical pair is a pure copy, so skipping the text step for near-duplicates would copy the English headline onto a Japanese image. That option is ruled out.

**What changes (code only, free):** a pixel check for every candidate pair (same shape, fingerprint within 14 bits) measures which pixels changed and where:

| Pixel check result | Treated as | Asked? |
|---|---|---|
| At most 0.5% of pixels changed outside the anchor's text and band boxes | same picture, new text: text comparison | no |
| 0.5% to 5% changed outside | same screen with translated in-game text: text comparison, crop also covers the changed areas | yes, side by side with the changed areas outlined (default answer: same) |
| Over 5% changed outside | different picture: full analysis | yes when the fingerprint is within 10 bits, otherwise no |

**Gain (5-country plan):** 6 full analyses become text comparisons (about $0.16 and 30 s each today, so about $1 and 3 minutes, minus the text comparisons' own cost), and 34 separate doubtful questions become one bulk confirmation plus 7 questions, the 7 being exactly the pairs with something changed outside the band. It also catches a reordered deck (our Japan #4 = US #5).

**Risk:** a non-text change inside the band area (a badge, a small character on the band) is treated as "new text". The text comparison still reads the band and reports added or removed elements, so it is seen, but not with a full analysis. A change below the pixel threshold (a tiny price tag outside the band) is not noticed by the check.

**How you stay in control:** at first the rule only suggests. The 27 pairs it calls "same picture, new text" (and the 6 images it would move to text comparison) are shown as one block you confirm with one click or review one by one; the other 7 are asked one by one as today, with the changed areas outlined. Your answers are saved per pair and always win over the rule. Only after the rule is validated on known-different pairs (including made-up ones: a badge added on the band, a tiny price change) can you switch it to automatic in Settings; even then the approval screen lists what it decided. A switch turns the rule off (fingerprint only, as today).

**Interaction with the tiers and R4:** identical-file reuse is unchanged. The planner (`tierScope` in `src/reports/anchors.ts`) gains one input, the pixel verdict. The R4 doubtful-match question (`doubtfulInPlan`, `matchCheck` in `src/reports/match-check.ts`) keeps its shape; the pixel check only removes pairs from it and adds the outline to the ones it keeps. Most of the 39 doubtful matches currently open for Japan/Korea/Taiwan would move into the one-click block.
