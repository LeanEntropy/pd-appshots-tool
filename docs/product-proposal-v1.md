# Product proposal V1: Store Screenshot Recipe tool

Reply line by line, e.g. "approve 1-12, change 13: …". Each item is one decision. Details are in `docs/plan-v1.md`.

## A. What the tool is
1. The tool is a reusable, config-driven repo that you operate with Claude Code.
   - It pulls Google Play screenshots for our game, named competitors and top-chart games, per country and language.
   - It recommends for each locale: the screenshot order, the in-game screen to capture, a full marketing-layer spec, translation notes, and what to change in our current images.
2. Deterministic code does everything that doesn't need judgement. AI is used in **5 narrow steps**, each schema-checked, cached and budget-capped.
3. Rogue Legend is the first config. Other games need a new config file, not code changes.

## B. How you use it
4a. In Claude Code: `/analyze configs/rogue-legend.json` runs the stages and pauses at checkpoints.
4b. `/publish-report`, `/import-feedback` and `/review` publish the Artifact, pull your ratings back, and run GPT cross-reviews.
4c. Every stage is also a plain `npm run <stage>` command. `npm run doctor` checks the setup.
5. The config holds:
   - our app ID;
   - competitors (by ID or name);
   - markets and languages;
   - charts and depth;
   - category (default: ours);
   - the taxonomy file and tier weights;
   - positions (default 8);
   - the model per AI step and review sampling;
   - completeness threshold and budget ceilings.

## C. What it produces
6a. **Local project folder = source of truth.** It keeps every image at full resolution plus optimised copies, and all analysis JSON (never overwritten).
6b. Offline markdown reports with inline images: per locale, per competitor deck, our own assets, and recommendations.
6c. Dated runs, each with an immutable manifest, so any past report can be regenerated and two runs can be diffed.
7a. **A private claude.ai Artifact** built from the same data. It shows:
    - recommendations with current vs recommended side by side;
    - every deck in listing order;
    - a locale comparison;
    - statistics.
7b. If Artifacts aren't available (checked at M0), the tool runs **local-only** and produces the same page as an offline HTML folder.
8a. Feedback: approve / reject / note on each recommendation and screenshot, plus general comments.
8b. The next run applies that feedback as tracked corrections. Conflicting corrections are flagged for you, not applied.

## D. Pipeline at a glance
| # | Stage | Type | Reused |
|---|---|---|---|
| 9a | Resolve IDs, pull charts, download screenshots (listing order, full-res), ingest our local files | Code | google-play-scraper (MIT) |
| 9b | Exact dedup, device class, measure plain bands and colours, optimise images | Code | sharp, sharp-phash, colorthief |
| 9c | AI step 1: per-screenshot analysis (type, layer, exact text) | Claude Sonnet | Stora-style schema pattern |
| 9d | AI step 2: cross-check of a 20% sample + low-confidence cases | GPT via Codex | — |
| 9e | Cross-locale matching by image content, localization status, slot counts | Code | franc-min |
| 9f | AI step 3: translation and genre lingo | Haiku + Sonnet | — |
| 9g | Our PSD layers and text | Code | psd-tools |
| 9h | AI step 4: recommendations per locale | Claude Opus | — |
| 9i | AI step 5: review of the recommendations | GPT via Codex | — |
| 9j | Markdown reports + Artifact page | Code | — |

## E. Taxonomy draft (full list in the plan)
10a. Screen types, 9 groups:
     - key art;
     - gameplay (battle, boss, victory, skill select, …);
     - metagame (progression, characters, gear, pets, gacha, …);
     - map/world;
     - social;
     - events/rewards;
     - shop;
     - promo;
     - other.
11a. Marketing layer: composition, bands, text (role, exact text, style), character/item callout, badges, and how the layer relates to the screen.

## F. Build vs reuse
12a. Reuse google-play-scraper (MrAdex77's fork as fallback).
12b. Reuse sharp, sharp-phash, colorthief, franc-min, zod and p-limit (all MIT or Apache).
12c. Reuse psd-tools via our proven spike script.
13a. Reject AppStoreCat: its heavy multi-runtime stack adds nothing over 12a.
13b. Use mcp-appstore only for optional ad-hoc exploration. It wraps an older version of 12a.
13c. Reject Qwen3-VL, Grounded-SAM-2 and OmniParser: GPU, overkill, or the wrong task.
13d. No classic OCR in V1. tesseract.js gets one test in the pilot.
14. Pattern reference only, no code copied: Stora, shots (no license), aso-skill (unclear license).
15. Future: rendering via store-screenshots / app-store-screenshots (MIT), analysis of feature graphic and video, and the App Store.
16. Custom code: glue, simple band measurement, the taxonomy, cross-locale matching, consensus and recommendations.

## G. Milestones (each ends with your checkpoint)
17. M0: scaffold, config, taxonomy, prompts, plus a check that Artifacts work. **You** approve the taxonomy and settings.
18. M1: download everything and publish a raw deck view. **You** prune irrelevant chart games.
19. M2: pilot on 3 games in all locales, 100% cross-checked, with real costs measured. **You** rate the accuracy, and the taxonomy is frozen.
20. M3: full analysis run within budget ceilings. **You** spot-check the disagreements.
21. M4: recommendations and the final report. **You** rate them, and the feedback feeds the next run.
22. Scale: about 1,100–1,500 unique screenshots. First run estimated at $60–100 list-price-equivalent on your Claude subscription (confirmed at M2), plus Codex. Re-runs about $5–25.

## H. Decisions needed (recommended default in bold)
23. Chart games, mostly MMO/gacha in Asia (FGO, Lineage M, NIKKE). Include them, but at **weight 1 vs direct 3 / same-audience 2, report them separately, and let you prune them at M1**.
24. Chart game locales: **the countries where they chart + US English** (or all locales).
25. Hong Kong language: **zh-TW** (zh-HK is probed at M1).
26. Philippines language: **fetch en + fil; report in en**.
27. Positions per locale: **8** (the Play phone maximum). Phone screenshots only.
28. AI runtime: **Claude via `claude -p` on your subscription + GPT via Codex CLI**. The API-key provider is designed but not built until needed.
29. PSD reader: **psd-tools (Python, already proven)** vs ag-psd (TS-only stack).
30. Feature graphic and video: **downloaded but not analysed in V1**.
31. Images are **not committed to git** (size, copyright). They stay in the project folder.
