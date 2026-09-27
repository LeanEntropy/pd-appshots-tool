# Product proposal V2: Store Screenshot Recipe tool

Reply by number, e.g. "approve 1-20, change 21: …". The full plan is in `docs/plan-v2.md`. The v1 files are kept unchanged.

## A. What the tool is
1. A reusable, config-driven repo operated with Claude Code. For each locale it recommends:
   - the screenshot order and count;
   - the in-game screen to capture;
   - the marketing-layer spec;
   - translation notes;
   - what to change in our current images.
2. Code does everything that doesn't need judgement. AI is used only where judgement is needed, and **never without your approval of the image count and cost first.**
3. It is game-agnostic: Rogue Legend is the first config.

## B. How it works: the expanding circle
4. **Setup (no AI cost).**
   - First shows how many decks and images it will download, and the disk space, and waits for your OK.
   - Downloads our deck, the core competitors' English decks, and the top-10 grossing decks for every configured country.
   - Shows them all raw.
5. **Core check.**
   - Our deck plus 5–8 of the closest named competitors, **US English only**.
   - Capped at **80–100 AI-analysed images in total**, with a hard stop.
   - Whole decks only: the tool picks as many complete competitor decks as fit (in your priority order), shows the exact count, and won't start if fewer than 5 fit.
   - Only our live store screenshots (7) count; our local files are matched to them and kept as reference.
   - It starts with a small pilot: ours plus 2 competitors.
6. **Early stop.** When the pattern stops changing, the tool suggests stopping. You decide.
7. **First recommendation**, for US English. You rate it in the report page.
8. **The tool then asks how to expand:**
   - more English competitors;
   - countries, from a checkbox list;
   - chart games, picked from the raw view.
   You can pick more than one.
9. **Each expansion is a separate increment.** Before it runs, the tool shows:
   - how many new images it will process, split by cost level;
   - how many model passes that means, including the review model (so 85 images reads as about 170 passes);
   - anything it must add first, e.g. the English analysis of a game you picked for a country;
   - the estimated cost.
   It waits for your OK. When a budget ceiling is hit, the lowest-priority competitor/country pairs are dropped first.

## C. How it keeps cost down (checked by code, cheapest first)
10. **Identical to the English image:** no AI. The analysis is reused and the screenshot is flagged "unchanged from English" (about the screenshot, not the whole store page).
11. **Same screen with a new marketing layer:** only the cropped band and text areas are sent, plus the English analysis, and a lighter capable model returns the differences.
12. **Different screenshot:** full analysis with the strongest model.
13. Images are cropped and resized to what the model needs. A whole deck is analysed per call where possible. Translation works on text only.

## D. Models (performance first; cost tuning only after the tool proves itself)
14. Screenshot analysis: **Fable 5.1**. It was best at reading band colours in our test.
15. Marketing-layer differences: **Opus 5.5** (pending the second model test).
16. Checking the image analysis: **gpt-5.6-sol**, the most accurate GPT model in our test. GPT-6 Astra is expensive, so it is kept for special cases only and never used for document reviews.
17. Settling disagreements, translation and lingo, and per-country recommendations: **Opus 5.5**.
18. Checking the recommendations: **gpt-5.6-sol** (to be confirmed in the pilot).
19. No Sonnet for screenshots and no Haiku anywhere.

## E. What you get
20. **Local folder = source of truth.** It holds all images (full-res and optimised), all analysis data, and offline markdown reports:
    - per locale;
    - per competitor deck;
    - our assets;
    - recommendations;
    - a chart-games gallery.
    Every run is dated and can be compared with earlier runs.
21. **A private report page (claude.ai Artifact)** built from the same data. It shows:
    - recommendations, with current vs recommended side by side;
    - every analysed deck in store order;
    - a locale comparison;
    - the raw chart games;
    - statistics.
    If Artifacts aren't available, the same page is built as an offline folder.
22. **Feedback:** approve / reject / note on every recommendation and screenshot, plus comments. The next run applies them as tracked corrections.
23. **Screenshot count is a finding, not a setting.** The tool reports how many screenshots competitors use per locale, and recommends a count capped at 8, framed as "what competitors do". Google Play allows 8 phone screenshots; longer competitor decks likely mix device types, and are still analysed in full.

## F. Milestones (each shows its image count and waits for you)
24. **Setup.** Repo, config, taxonomy, a host check, and all downloads. **You:** approve the download preview, then confirm the core competitor list and its exact image count.
25. **Core pilot.** About 25 images, 100% cross-checked. It also tests the "same screen, new layer" check on hand-labelled pairs (no AI cost) and measures real costs. **You:** rate the accuracy; the taxonomy is then frozen.
26. **Core check.** About 55–65 more images (about 80–90 in total), plus the first US-English recommendation. **You:** rate it and choose expansions.
27. **Expansions.** Repeatable, each approved separately. **You:** approve each one and rate its recommendation.
28. **Final report and feedback loop.**
29. **Estimated cost:**
    - core check about **$17–28** on your Claude subscription plus about 1.5–1.8M gpt-5.6-sol tokens (provisional; recomputed from the pilot's real numbers);
    - each added country about **$4–6** (the real counts are shown before approval).

## G. Already decided (for the record)
30. Chart games are downloaded and shown raw at no AI cost, and analysed only if you pick them. This replaces the old weighting decision.
31. Chart-game locales: the countries where they chart, plus US English. *(approved)*
32. Hong Kong uses zh-TW; zh-HK is probed later. *(approved)*
33. The Philippines uses English only. *(decided)*
34. Feature graphic and video are out of V1. *(decided)*
35. The repo holds the tool only (code, configs, taxonomy, prompts). Each user's run data (images, analysis, reports) stays in their own gitignored local folder. *(decided)*
36. The core check is capped at 80–100 AI-analysed images in total, with a hard stop. *(decided)*
37. A whole deck is analysed per call where possible, with automatic fallback to one image per call. *(decided)*

## H. Decisions (all decided by the user on 2026-09-27)
- 38: **decided** — you pick and order the core competitors in the tool's interface (checkboxes in the raw deck view). The list below is only the default.
- 39: **decided** — 100 as the hard stop, aiming for about 85.
- 40: **decided** — the early-stop rule is a set of adjustable parameters, starting with the values below.
- 41: **decided** — review coverage is a toggle, starting at 100% everywhere.
- 42: **decided** — $30 per expansion, adjustable.
- 43: **decided** — psd-tools, optional.
- Also decided (item 10): each game project keeps its own image database, so an identical image is never analysed twice.

Original options, for the record:
38. Core competitors, in priority order: **Capybara Go, Mini Tales, Heroll, Dicero, Archero 2, Survivor.io, BagMaster Isekai** (7). Alternatives: Legend of Mushroom, Legend of Slime, Overgeared Hero.
39. Exact core cap within 80–100: **100 as the hard stop, aiming for about 85.**
40. Early-stop rule: **suggest stopping after at least 5 competitor decks, when the last 2 decks changed no slot's top screen type and no share moved more than 10 points.**
41. Review coverage: **100% in the core check; in expansions, every full analysis plus 25% of the layer-difference checks and anything low-confidence.**
42. Budget ceiling per expansion: **$30**, adjustable.
43. PSD reader: **psd-tools (Python, already proven on our PSD)** vs ag-psd (keeps the stack TypeScript-only).
