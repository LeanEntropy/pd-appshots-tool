# Pillars — long-term facts and directives

Evergreen only. Session-by-session notes go in `memory/YYYY-MM-DD.md`.
Update this file when a fact or directive changes; don't append history here.

## Goal (V1)
A tool that pulls competitors' Google Play screenshots per country, analyses them in depth, and recommends
exactly which screenshots Rogue Legends should use per locale.

Output per locale:
- the screenshot order;
- the exact in-game screen to capture for each position;
- a full marketing-layer spec for each position;
- translation and genre-lingo notes;
- a comparison against our current images.

## Product principle
- We are building a reusable, config-driven TOOL, not doing the research by hand.
  - It may run as a repo operated with Claude Code: deterministic scripts plus Claude Code skills, commands and agents for the AI steps. A fully standalone CLI is not required. Claude Code agents build the tool; the tool does the research.
- It must be game-agnostic: game ID, competitors, countries, charts, category and taxonomy all come from config. Rogue Legends is the first config.
- Deterministic code wherever possible. The LLM is used only where judgement is truly needed, called by the tool through a pluggable provider (Claude or OpenAI) with versioned prompts and Zod-validated output.
- Don't reinvent the wheel. Reuse existing projects and libraries wherever they fit, respecting licenses.
  - The candidates are in `reports/Game store screenshot analysis tools.md`.
  - Custom code only for the glue and the novel parts: the taxonomy, deck and consensus analysis, and the recommendations.
- Re-runnable and incremental: a content-addressed cache, snapshots over time, and user feedback fed back in.

- **Scale:**
  - The CORE check is capped at 80–100 AI-analysed images, total, including our own. It must produce good recommendations within that. If it can't, the tool is useless.
  - Expansions beyond the core are the user's choice, with no fixed cap.
  - Before processing any step, the tool MUST show the user how many images it will process, and get approval.
- **Expanding-circle workflow**, the core product design, set by the user on 2026-09-26:
  1. **Core check:** 5–8 competitors in English only (plus our own). Establish the pattern and give a first recommendation.
  2. **The tool then ASKS the user how to expand:**
     - more English competitors; and/or
     - other countries, which the user picks with checkboxes.
  3. **Each expansion is a separate, user-approved increment** within the budget.
- Competitors mostly reuse the same screenshots across countries, changing only the marketing layer (text).
  - Localisation analysis = compare the marketing layer and text against the English version of the same screenshot, found deterministically. Never re-analyse the whole image from scratch.
- **Cost tiers per image**, checked cheapest first:
  1. Identical to English (file or hash match, by code): no AI; reuse the English analysis.
  2. Same capture, different marketing layer (by code): send only the cropped band/text regions plus the English analysis, and ask for the diff. A lighter model is OK here.
  3. Different screenshot: full analysis with the strong model.
  - Also:
    - crop and resize to the model's needs;
    - analyse a whole deck in one call where possible;
    - stop the core check early once the pattern is stable;
    - translation and lingo work on text only.
  - Before each step, show the count per tier and wait for approval.
- **Plan v2 approved** (2026-09-27, `docs/plan-v2.md`), with these settings:
  - The user picks the core competitors in the tool's interface; they are not fixed in config.
  - Early-stop rule and review coverage are adjustable parameters. Initial values: early stop after ≥5 decks, when 2 decks in a row change nothing and no share moves more than 10 points; review coverage is a toggle, starting at 100% everywhere.
  - Core cap: 100 hard stop, aiming for ~85. Budget ceiling per expansion: $30, adjustable.
  - The PSD reader is psd-tools. It's optional; it gives exact facts about our current marketing layer.
  - Each game project keeps its own image database, so an identical image is never analysed twice.
- When the budget runs out, drop the lowest-priority competitor/country combinations first.
  - Cheap, deterministic steps come first: dedup across locales, and detecting identical images. Localised variants only need their text read.
  - Chart games are shown raw and not analysed unless the user picks them.
  - The cap is enforced in config as a hard stop.

## Our game
- Rogue Legends: `com.pockethaven.roguelegend` (Google Play).
- Own assets: `rogue-legends_current/` contains screenshots and a layered PSD. Read-only source material.
  - The same PSD and screenshots are used on both Google Play and the App Store. The PSD's `_APPLE STORE` name is irrelevant.
  - The "no_marketing_layer" images still contain text and bands. The user can capture any in-game screen on request.
- V1 output is text and instructions for the user to review: which screen to capture and a marketing-layer spec per position.
  - Delivered as a Claude Artifact: a rich HTML page with text and images.
    - It includes ALL collected and analysed screenshots as references.
    - It has feedback built in: per-item ratings and notes in the artifact db, plus comments. That feedback feeds the next iteration.
    - The HTML is built by a deterministic generator script from the analysis JSON.
  - Local copies are first-class and the source of truth. Everything stays on disk in the project: all images, all analysis JSON, and markdown reports that reference local images by relative path. The Artifact is a published view built from the local data.
  - No image generation in V1.
  - No integration with the Unity game project.

## Scope
- Google Play only in V1. App Store deferred.
- Markets: Asia, with localized store pages per country. Taiwan represents China.
  - Default set: JP, KR, TW, HK, TH, VN, ID, PH, with US-English as the baseline.
  - HK uses zh-TW (zh-HK probed at M1). PH uses en only.
- Competitor pool:
  - the named competitors below;
  - the **top 10 grossing** games in our Play category per target country, deduplicated.

## Competitors
- Direct competitors (not very successful yet): Capybara Go, Mini Tales, Heroll.
- Same audience: Archero 2, Survivor.io (`com.dxx.firenow`), Dicero, BagMaster Isekai (`com.DoorTeam.BagMaster`), Overgeared Hero, Legend of Mushroom (parent of Capybara Go), Legend of Slime.
- Large reference games: Clash of Critters, Sword x Staff, Whoa Adventure, Path of Kings.

## Analysis requirements
- Screenshot order comes from the store data. The AI never infers it.
- Screen type uses a detailed taxonomy, e.g. title/key art, gameplay: battle, gameplay: victory, metagame: progression, metagame: character list.
- For each screenshot's marketing layer, record:
  - band colour, size and style;
  - the exact text;
  - any adjacent character or item and what it is;
  - how the layer relates to the underlying screen.
- Translation analysis: compare English and local text, capture genre terms and lingo, and flag unlocalized pages.

## Working directives
- The main session is an orchestrator only. It delegates all task work to subagents and stays available to the user.
- Right-size the model per task:
  - Haiku for mechanical work;
  - Sonnet for research, tooling and moderate analysis;
  - Opus for planning, architecture and final synthesis;
  - Codex CLI (OpenAI) for GPT-family work and cross-family reviews.
    - Exact model names: gpt-5.5, gpt-5.6-sol, gpt-5.6-luna, gpt-5.6-terra, gpt-6-astra. The catalogue is in `~/.codex/models_cache.json`.
    - Invocation: `codex exec -m <slug> -s read-only --skip-git-repo-check --ephemeral -i <img> --output-schema <schema> --json -o <out> "<prompt>"`.
    - Plan, code and document reviews: gpt-5.6-sol or gpt-5.6-terra ONLY. NEVER gpt-6-astra (user directive).
    - Screenshot review: gpt-5.6-sol (10/10 on screen type in the test). Astra only for special cases. Terra is unsuitable as a reviewer (it mislabels banded screens).
- User's model constraints (2026-09-26):
  - NO Sonnet for screenshot analysis; the user considers it the weakest Claude model.
  - Haiku only for tasks of zero importance.
  - GPT-6 Astra is very token-expensive: use it only for special or high-value tasks, e.g. image-analysis review.
- Repeating technical tasks become deterministic scripts or tools, with no LLM involved. LLM effort only where judgment is needed.
- Stack follows the global rules: TypeScript strict, Biome, 300 lines max per file.
- The analysis spec is `docs/analysis-requirements-user-2026-09-27.md` (authoritative):
  - each image analysed on 2 layers and saved immediately;
  - store order saved per game per date;
  - patterns across competitors, and ours compared against them;
  - full recommendations.
- UX rules:
  - always show live progress ("Analyzing image 5 / 80");
  - runs are resumable and never re-analyse;
  - a final report at the end;
  - an (i) icon with hover details on every analysed image.
- The tool must never make the user move or handle files. Every choice made in its UI is saved by the tool automatically (e.g. a local server with autosave).
- User-facing text (chat, pages, reports) uses plain descriptive names, never internal codes like S6, L1 or F8.
- Plan first. Only small or obvious tasks skip planning. Everything else follows this flow:
  1. Plan.
  2. Cross-family review of the plan.
  3. User approval.
  4. Implement.
  5. Cross-family review of the implementation.
- Cross-family reviews:
  - Claude's output is reviewed by a GPT-family model via Codex CLI; GPT output is reviewed by Claude.
  - Avoid same-family reviews.
  - Reviews cover plans, code, prompts/schemas and analysis outputs (e.g. screenshot classifications and the final recommendation).
  - The reviewer gets the artifact plus the requirements, and returns concrete findings. The orchestrator decides on fixes, and asks the user when there is a disagreement that matters.

## Key references
- Tool landscape research: `reports/Game store screenshot analysis tools.md`, with notes in `research_notes/`.
